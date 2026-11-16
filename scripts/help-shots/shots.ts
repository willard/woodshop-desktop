import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../ui/public/help/', import.meta.url));
/** Pictures sit in a 672 px article column; twice that is sharp on a Retina screen. */
const MAX_WIDTH = 1344;
/** Set ONLY=name,name to take just those shots. */
const ONLY = process.env.ONLY?.split(',');

test.use({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
test.setTimeout(10 * 60_000);

type Theme = 'light' | 'dark';

/** Re-encodes a PNG screenshot as WebP, no wider than MAX_WIDTH, through a canvas in the page. */
async function save(page: Page, name: string, theme: Theme, png: Buffer): Promise<void> {
    const data = await page.evaluate(
        async ({ src, maxWidth }) => {
            const img = new Image();
            img.src = src;
            await img.decode();
            const scale = Math.min(1, maxWidth / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d')!;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/webp', 0.82);
        },
        { src: `data:image/png;base64,${png.toString('base64')}`, maxWidth: MAX_WIDTH },
    );
    writeFileSync(`${OUT}${name}-${theme}.webp`, Buffer.from(data.split(',')[1], 'base64'));
}

/** The right-hand dock (cut list, inspector, notes): the tab bar's nearest full-height ancestor. */
async function dockShot(page: Page, maxHeight = 2000): Promise<Buffer> {
    const clip = await page.getByTestId('inspector-tab').evaluate((tab) => {
        let el: HTMLElement | null = tab as HTMLElement;
        while (el && el.getBoundingClientRect().height < window.innerHeight * 0.7) el = el.parentElement;
        const r = (el ?? document.body).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    clip.height = Math.min(clip.height, maxHeight);
    return page.screenshot({ clip });
}

/** A screenshot of the box around `els`, padded, and no taller than `maxHeight` CSS pixels. */
async function around(page: Page, selectors: string[], pad = 16, maxHeight = 2000): Promise<Buffer> {
    const clip = await page.evaluate(
        ({ selectors, pad, maxHeight }) => {
            const rects = selectors.flatMap((sel) =>
                [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()),
            );
            const x = Math.max(0, Math.min(...rects.map((r) => r.left)) - pad);
            const y = Math.max(0, Math.min(...rects.map((r) => r.top)) - pad);
            const right = Math.min(window.innerWidth, Math.max(...rects.map((r) => r.right)) + pad);
            const bottom = Math.min(
                window.innerHeight,
                Math.max(...rects.map((r) => r.bottom)) + pad,
                y + maxHeight,
            );
            return { x, y, width: right - x, height: bottom - y };
        },
        { selectors, pad, maxHeight },
    );
    return page.screenshot({ clip });
}

/** A fresh library in `theme` with the sample nightstand open in the editor. */
async function openSample(page: Page, theme: Theme): Promise<void> {
    await page.goto('/?empty#/');
    await page.evaluate((t) => {
        localStorage.setItem('woodshop.theme', t);
        localStorage.setItem('woodshop.outline', '1');
        localStorage.removeItem('woodshop.inspector.closed');
    }, theme);
    await page.reload();
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('parts-count')).toHaveText('20 parts');
    await page.keyboard.press('Escape'); // the tour
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await page.waitForTimeout(2000); // holes cut, frames settled
}

async function select(page: Page, name: string): Promise<void> {
    await page
        .getByTestId('outline-row')
        .filter({ hasText: name })
        .getByRole('button', { name, exact: true })
        .first()
        .click();
}

const SHOTS: Record<string, (page: Page, theme: Theme) => Promise<Buffer>> = {
    editor: async (page) => page.screenshot(),

    'cut-list': async (page) => dockShot(page, 470),

    drawer: async (page) => {
        await page.getByTestId('open-toggle').click();
        await select(page, 'Drawer Front');
        await page.getByTestId('inspector-tab').click();
        await page.waitForTimeout(800);
        return page.screenshot();
    },

    cuts: async (page) => {
        await select(page, 'Open Shelf');
        await page.getByTestId('inspector-tab').click();
        const section = page.getByTestId('section-cuts');
        await section.scrollIntoViewIfNeeded();
        return section.screenshot();
    },

    checks: async (page) => {
        // Lift the shelf off its cleats so there is something to report.
        await select(page, 'Open Shelf');
        await page.getByTestId('inspector-tab').click();
        const y = page.locator('[data-testid^="pos-input-"]').nth(1);
        await y.fill('14');
        await y.press('Enter');
        await page.getByTestId('lint-badge').click();
        await page.waitForTimeout(800);
        return page.screenshot();
    },

    hardware: async (page) => {
        await page.getByTestId('add-menu-toggle').click();
        await page.getByTestId('add-hardware-menu').click();
        const dialog = page.getByTestId('hardware-dialog');
        await dialog.locator('[data-item="pull.bar-128mm"]').click();
        await page.waitForTimeout(500);
        // The dialog's panel, not the dimmed page behind it.
        await dialog.evaluate((d) => {
            const panel = [...d.querySelectorAll('*')].find((e) => {
                const r = e.getBoundingClientRect();
                return (
                    r.width < window.innerWidth * 0.9 &&
                    r.height > 300 &&
                    e.textContent?.includes('Add hardware')
                );
            });
            panel?.setAttribute('data-shot', 'panel');
        });
        return around(page, ['[data-shot="panel"]'], 0);
    },

    versions: async (page) => {
        await page.getByTestId('versions-toggle').click();
        await page.getByTestId('version-label').fill('Before the drawer');
        await page.getByTestId('save-version').click();
        await expect(page.getByTestId('version-row')).toHaveCount(1);
        // The panel's header, the label field and the one saved version.
        return around(page, ['[data-testid="versions"]'], 0, 200);
    },

    agents: async (page) => {
        await page.goto('/#/settings');
        await page.getByTestId('settings-group-agents').click();
        await page.waitForTimeout(300);
        await page.getByRole('heading', { name: 'AI agents (MCP)' }).evaluate((h) => {
            let card = h.parentElement;
            while (card && card.getBoundingClientRect().height < 200) card = card.parentElement;
            card?.setAttribute('data-shot', 'card');
        });
        return around(page, ['main h1', '[data-shot="card"]'], 24);
    },
};

test('take the Help Center screenshots', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
        for (const [name, shoot] of Object.entries(SHOTS)) {
            if (ONLY && !ONLY.includes(name)) continue;
            await openSample(page, theme);
            await save(page, name, theme, await shoot(page, theme));
        }
    }
});
