import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../ui/public/templates/', import.meta.url));
/** Card pictures are 16:10; twice the card's size for a sharp image on a Retina screen. */
const WIDTH = 640;
const HEIGHT = 400;
/** The editor frames a design to 60% of its view; a card wants it bigger, so crop to this share. */
const ZOOM = 0.8;

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
        return ((await invoke('list_templates')) as { id: string; name: string }[]).map((t) => [
            t.name,
            t.id,
        ]);
    });
    const idOf = new Map(ids as [string, string][]);
    expect(names.length).toBeGreaterThan(0);

    for (const theme of ['light', 'dark'] as const) {
        for (const name of names) {
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
                ({ width, height, zoom }) => {
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
                { width: WIDTH, height: HEIGHT, zoom: ZOOM },
            );
            const id = idOf.get(name)!;
            writeFileSync(`${OUT}${id}-${theme}.webp`, Buffer.from(data.split(',')[1], 'base64'));
        }
    }
});
