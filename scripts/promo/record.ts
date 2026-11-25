import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import script from './script.json' with { type: 'json' };

/**
 * Records the raw material for the promo video: each app scene as a run of screencast frames, the
 * caption and end cards as transparent PNGs, and the Dresser's build and colour swatches films.
 * `compose.mjs` cuts them together. Run both with `npm run promo`.
 */
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
/** Set ONLY=scene,scene to record just those. */
const ONLY = process.env.ONLY?.split(',');
const DRESSER = 'Three-Drawer Dresser';

// Narrower than a desktop, so the app's text stays readable on a phone.
test.use({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
test.setTimeout(15 * 60_000);

/** Records what `act` does as JPEG frames with their times, for ffmpeg's concat demuxer. */
async function record(page: Page, name: string, act: () => Promise<void>): Promise<void> {
    const dir = `${OUT}${name}/`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const frames: { file: string; time: number }[] = [];
    cdp.on('Page.screencastFrame', (f) => {
        const file = `${String(frames.length).padStart(5, '0')}.jpg`;
        writeFileSync(dir + file, Buffer.from(f.data, 'base64'));
        frames.push({ file, time: f.metadata.timestamp ?? Date.now() / 1000 });
        void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 92,
        everyNthFrame: 1,
    });
    await act();
    await page.waitForTimeout(300);
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
    // The screencast sends a frame only when the page changes: hold each until the next.
    const end = frames.at(-1)!.time + 0.3;
    const lines = frames.flatMap((f, i) => [
        `file '${f.file}'`,
        `duration ${((frames[i + 1]?.time ?? end) - f.time).toFixed(4)}`,
    ]);
    lines.push(`file '${frames.at(-1)!.file}'`);
    writeFileSync(`${dir}frames.txt`, lines.join('\n') + '\n');
}

/** Drags from `from` to `to` over `ms`, eased, timed by the clock so the screencast sees it smooth. */
async function glide(page: Page, from: [number, number], to: [number, number], ms: number): Promise<void> {
    await page.mouse.move(...from);
    await page.mouse.down();
    const start = Date.now();
    for (let t = 0; t < 1;) {
        t = Math.min(1, (Date.now() - start) / ms);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await page.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
    }
    await page.mouse.up();
}

/** Scrolls whatever is under the mouse by `px` over `ms`, timed by the clock. */
async function scroll(page: Page, px: number, ms: number): Promise<void> {
    const start = Date.now();
    let done = 0;
    for (let t = 0; t < 1;) {
        t = Math.min(1, (Date.now() - start) / ms);
        const want = Math.round(px * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
        if (want > done) await page.mouse.wheel(0, want - done);
        done = want;
        await page.waitForTimeout(16);
    }
}

async function fresh(page: Page): Promise<void> {
    await page.goto('/?empty#/');
    await page.evaluate(() => {
        localStorage.setItem('woodshop.theme', 'dark');
        localStorage.setItem('woodshop.outline', '0');
    });
    await page.reload();
}

async function openDresser(page: Page): Promise<void> {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: DRESSER, exact: true }) })
        .getByTestId('use-template')
        .click();
    await expect(page.getByTestId('parts-count')).toBeVisible();
    if (await page.getByTestId('tour').isVisible()) await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
}

/** The middle of the 3D view, in CSS pixels. */
async function viewCentre(page: Page): Promise<[number, number]> {
    const box = (await page.locator('canvas').first().boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2];
}

/** `*words*` in amber, the rest as is, HTML-escaped. */
function marked(text: string): string {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return esc.replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

const CARD_CSS = `
    * { margin: 0; box-sizing: border-box; }
    html, body { width: 1080px; height: 1920px; background: transparent; }
    body { font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif; color: #f4efe6; }
    em { font-style: normal; color: #f5a524; }
    .caption { position: absolute; left: 64px; right: 64px; top: 210px; height: 250px;
        display: flex; align-items: center; justify-content: center; text-align: center;
        font-size: 78px; font-weight: 800; line-height: 1.08; letter-spacing: -1.5px;
        text-shadow: 0 4px 24px rgba(0,0,0,.55); }
    .caption.bottom { top: 1480px; }
    .end { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
        justify-content: center; text-align: center; gap: 26px; padding: 0 80px 120px; }
    .end img { width: 300px; height: 300px; margin-bottom: 18px; }
    .end h1 { font-size: 132px; font-weight: 800; letter-spacing: -3px; }
    .end p { font-size: 48px; font-weight: 600; color: #d9d0c1; line-height: 1.25; }
    .end .link { margin-top: 40px; font-size: 40px; font-weight: 600; color: #f5a524;
        border: 3px solid #f5a52466; border-radius: 999px; padding: 18px 42px; }`;

const SCENES: Record<string, (page: Page) => Promise<void>> = {
    templates: async (page) => {
        await page.goto('/#/templates');
        await expect(page.getByTestId('template-card').first()).toBeVisible();
        await page.waitForTimeout(1200); // pictures in
        await record(page, 'templates', async () => {
            await page.waitForTimeout(600);
            await page.mouse.move(500, 500);
            await scroll(page, 900, 1600);
            await page.waitForTimeout(300);
            const card = page
                .getByTestId('template-card')
                .filter({ has: page.getByRole('heading', { name: DRESSER, exact: true }) });
            await card.scrollIntoViewIfNeeded();
            await card.hover();
            await page.waitForTimeout(500);
            await card.getByTestId('use-template').click();
            await expect(page.getByTestId('parts-count')).toBeVisible();
            if (await page.getByTestId('tour').isVisible()) await page.keyboard.press('Escape');
            await page.waitForTimeout(1800);
        });
    },

    editor: async (page) => {
        await openDresser(page);
        const [x, y] = await viewCentre(page);
        await record(page, 'editor', async () => {
            await page.waitForTimeout(400);
            // Off the end of the narrow toolbar: press it without scrolling the toolbar.
            await page.getByTestId('open-toggle').evaluate((b: HTMLElement) => b.click());
            await page.waitForTimeout(900);
            // Drags start on the empty floor, so they turn the view rather than move a part.
            await glide(page, [x - 280, y + 200], [x - 20, y + 170], 2600);
            await page.waitForTimeout(1200);
        });
    },

    checks: async (page) => {
        await openDresser(page);
        // Pick the top in the parts list, then put the list away again.
        await page.getByTestId('outline-toggle').click();
        await page
            .getByTestId('outline-row')
            .filter({ hasText: 'Top' })
            .getByRole('button', { name: 'Top', exact: true })
            .first()
            .click();
        await page.getByTestId('outline-toggle').click();
        await page.getByTestId('inspector-tab').click();
        await page.waitForTimeout(800);
        const y = page.locator('[data-testid^="pos-input-"]').nth(1);
        await record(page, 'checks', async () => {
            await page.waitForTimeout(400);
            await y.fill('38');
            await y.press('Enter');
            await page.waitForTimeout(600);
            await page.getByTestId('lint-badge').click();
            await page.waitForTimeout(1800);
            await y.fill('32.375');
            await y.press('Enter');
            await page.waitForTimeout(1500);
        });
    },

    cutlist: async (page) => {
        await openDresser(page);
        await page.getByTestId('cutlist-toggle').click();
        await page.waitForTimeout(1000);
        const order = page.getByTestId('cutlist-cut-order');
        // Start at the sheet layouts.
        await order.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(600);
        await record(page, 'cutlist', async () => {
            await page.waitForTimeout(700);
            await order.check();
            await page.waitForTimeout(900);
            await order.hover();
            await scroll(page, 260, 1800);
            await page.waitForTimeout(2200);
        });
    },

    cards: async (page) => {
        await page.setViewportSize({ width: 1080, height: 1920 });
        const icon = readFileSync(fileURLToPath(new URL('../../src-tauri/icons/icon.png', import.meta.url)));
        const shoot = async (name: string, body: string) => {
            await page.setContent(`<style>${CARD_CSS}</style>${body}`);
            await page.evaluate(() => document.fonts.ready);
            writeFileSync(`${OUT}${name}.png`, await page.screenshot({ omitBackground: true, scale: 'css' }));
        };
        for (const [i, shot] of script.shots.entries()) {
            if (!shot.title) continue;
            const at = 'at' in shot && shot.at === 'bottom' ? ' bottom' : '';
            await shoot(`caption-${i}`, `<div class="caption${at}"><div>${marked(shot.title)}</div></div>`);
        }
        const end = script.end;
        await shoot(
            'end',
            `<div class="end"><img src="data:image/png;base64,${icon.toString('base64')}">` +
                `<h1>${marked(end.name)}</h1>${end.lines.map((l) => `<p>${marked(l)}</p>`).join('')}` +
                `<div class="link">${marked(end.link)}</div></div>`,
        );
    },

    films: async (page) => {
        await openDresser(page);
        const id = Number(page.url().match(/projects\/(\d+)/)![1]);
        for (const preset of ['build', 'swatches'] as const) {
            const base64 = await page.evaluate(
                async ({ id, preset }) => {
                    const { renderAssemblyFilm } = await import('/src/video/assemblyFilm.ts');
                    const { api } = await import('/src/app/api.ts');
                    const project = await api.getProject(id);
                    const bytes = await renderAssemblyFilm(project.draft, {
                        width: 1080,
                        height: 1920,
                        seconds: 30,
                        theme: 'dark',
                        preset,
                        // Painted finishes a dresser is often given, for a calm run of colours.
                        paints:
                            preset === 'swatches'
                                ? [
                                      '#2f4a3a',
                                      '#e9e2d3',
                                      '#3b4a5c',
                                      '#b5654a',
                                      '#1f1f22',
                                      '#8a9a7b',
                                      '#c9b48a',
                                  ]
                                : undefined,
                        title: project.name,
                        subtitle: '',
                    });
                    let s = '';
                    for (let i = 0; i < bytes.length; i += 0x8000) {
                        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                    }
                    return btoa(s);
                },
                { id, preset },
            );
            writeFileSync(`${OUT}film-${preset}.mp4`, Buffer.from(base64, 'base64'));
        }
    },
};

test('record the promo video scenes', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    for (const [name, scene] of Object.entries(SCENES)) {
        if (ONLY && !ONLY.includes(name)) continue;
        await fresh(page);
        await scene(page);
    }
});
