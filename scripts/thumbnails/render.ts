import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../ui/public/templates/', import.meta.url));
/** Card pictures are 16:10; twice the card's size for a sharp image on a Retina screen. */
const WIDTH = 640;
const HEIGHT = 400;
/** The editor frames a design to 60% of its view; a card wants it bigger, so crop to this share. */
const ZOOM = 0.8;
/**
 * A design much taller than it is wide fills the view's height, which a 16:10 crop of a squarer
 * view cuts into; those take a crop this share of the view's height instead.
 */
const TALL_CROP = 0.76;
/** Set ONLY=id,id to render just those templates. */
const ONLY = process.env.ONLY?.split(',');

test.use({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
test.setTimeout(10 * 60_000);

test('render every template', async ({ page }) => {
    await page.goto('/#/templates');
    await expect(page.getByTestId('template-card').first()).toBeVisible();
    const names = await page.getByTestId('use-template').allInnerTexts();
    const ids = await page.evaluate(async () => {
        const invoke = (
            window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }
        ).__TAURI_INTERNALS__.invoke;
        type Summary = { id: string; name: string; overall?: { width: number; height: number } };
        return ((await invoke('list_templates')) as Summary[]).map((t) => ({
            name: t.name,
            id: t.id,
            tall: t.overall !== undefined && t.overall.height > 1.4 * t.overall.width,
        }));
    });
    const byName = new Map(ids.map((t) => [t.name, t]));
    expect(names.length).toBeGreaterThan(0);

    for (const theme of ['light', 'dark'] as const) {
        for (const name of names) {
            const { id, tall } = byName.get(name)!;
            if (ONLY && !ONLY.includes(id)) continue;
            await page.evaluate((t) => localStorage.setItem('woodshop.theme', t), theme);
            await page.goto('/#/templates');
            await page.reload();
            await page
                .getByTestId('template-card')
                .filter({ has: page.getByRole('heading', { name, exact: true }) })
                .getByTestId('use-template')
                .click();
            await expect(page.getByTestId('parts-count')).not.toHaveText('0 parts');
            // Let holes be cut and the first frames settle.
            await page.waitForTimeout(2500);
            const data = await page.evaluate(
                ({ width, height, zoom, tallCrop }) => {
                    const source = document.querySelector(
                        '[data-testid="editor-shell"] canvas',
                    ) as HTMLCanvasElement;
                    // Centre-crop the view to 16:10, then scale it down.
                    const aspect = width / height;
                    let sw = source.width * zoom;
                    let sh = sw / aspect;
                    if (sh > source.height * zoom) {
                        sh = source.height * zoom;
                        sw = sh * aspect;
                    }
                    if (tallCrop !== null && sh < source.height * tallCrop) {
                        sh = source.height * tallCrop;
                        sw = Math.min(sh * aspect, source.width);
                        sh = sw / aspect;
                    }
                    const out = document.createElement('canvas');
                    out.width = width;
                    out.height = height;
                    const ctx = out.getContext('2d')!;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(
                        source,
                        (source.width - sw) / 2,
                        (source.height - sh) / 2,
                        sw,
                        sh,
                        0,
                        0,
                        width,
                        height,
                    );
                    return out.toDataURL('image/webp', 0.82);
                },
                { width: WIDTH, height: HEIGHT, zoom: ZOOM, tallCrop: tall ? TALL_CROP : null },
            );
            writeFileSync(`${OUT}${id}-${theme}.webp`, Buffer.from(data.split(',')[1], 'base64'));
        }
    }
});
