import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import recordStand from '../ui/src/fixtures/specs/record-stand.spec.json' with { type: 'json' };

/**
 * The exported 3D plan as a person opens it: one .html file from a download folder, no server.
 * The page is filled from the exporter's own template (crates/woodshop-export/templates/
 * viewer.html) and the built viewer bundle (`npm run build:viewer`, which CI runs before this),
 * the way `woodshop-export::viewer` writes it.
 */

const bundle = (name: string): string => {
    const path = `viewer/dist/${name}`;
    if (!existsSync(path)) throw new Error(`${path} is missing: run \`npm run build:viewer\` first.`);
    return readFileSync(path, 'utf8');
};

/** JSON safe inside a <script>, as `script_safe_json` makes it. */
const scriptSafe = (value: unknown): string =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/** The template filled in one pass, as `fill` does. */
function exportedPlan(values: Record<string, string>): string {
    const template = readFileSync('crates/woodshop-export/templates/viewer.html', 'utf8');
    return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => ({ ar: '', ...values })[key] ?? whole);
}

test('an exported plan opens from a file and works offline', async ({ page }, info) => {
    const payload = {
        version: 1,
        exportedAt: '2026-11-19T12:00:00Z',
        project: { name: 'Record stand' },
        spec: recordStand,
        kerf: 0.125,
        theme: 'light',
        notes: [{ body: 'Use the good ply for the top.', pinned: true }],
        units: 'fraction',
    };
    const file = info.outputPath('Record stand.html');
    writeFileSync(
        file,
        exportedPlan({
            theme: 'light',
            title: 'Record stand',
            css: bundle('viewer.css').replace(/<\/style/g, '<\\/style'),
            payload: scriptSafe(payload),
            js: bundle('viewer.js').replace(/<\/script/g, '<\\/script'),
        }),
    );

    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    // Nothing may be fetched: the page is the whole plan.
    page.on(
        'request',
        (r) =>
            !r.url().startsWith('file:') &&
            !r.url().startsWith('blob:') &&
            !r.url().startsWith('data:') &&
            problems.push(`fetched ${r.url()}`),
    );

    await page.goto(pathToFileURL(file).href);
    await expect(page).toHaveTitle('Record stand — Woodshop plan');
    await expect(page.getByRole('heading', { name: 'Record stand', level: 1 })).toBeVisible();
    await expect(page.getByTestId('viewer-canvas')).toBeVisible();
    await expect(page.getByTestId('viewer-note')).toHaveText('★Use the good ply for the top.');

    // The cut list, read-only: no price or stock boxes.
    const totals = page.getByTestId('cutlist-totals');
    await expect(totals).toContainText('Overall');
    await expect(page.getByTestId('material-price')).toHaveCount(0);

    // Pick a part from the cut list: the Part tab shows it, its joints in shop words.
    await page
        .getByTestId('cutlist-group-row')
        .filter({ hasText: 'Left Side, Right Side' })
        .locator('xpath=..')
        .getByTestId('cutlist-group-expand')
        .click();
    await page
        .getByTestId('cutlist-row')
        .filter({ hasText: /^Left Side/ })
        .click();
    const detail = page.getByTestId('part-detail');
    await expect(detail.getByRole('heading', { name: 'Left Side' })).toBeVisible();
    await expect(detail.getByTestId('part-joint').first()).toHaveText('Middle Shelf seats in its dado');

    // Tick a piece off, and it is remembered in this browser.
    await page.getByTestId('viewer-tab-cutlist').click();
    await page.getByTestId('cutlist-cut-tick').first().check();
    await expect(page.getByTestId('cutlist-progress')).toContainText(/^\d+ of \d+ pieces cut/);
    await page.reload();
    await expect(page.getByTestId('cutlist-cut-tick').first()).toBeChecked();

    // Theme and the 3D controls.
    await page.getByTestId('viewer-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('explode').fill('1');
    await page.getByTestId('viewer-fit').click();

    // Sizes on the model.
    await page.getByTestId('viewer-sizes').click();
    await expect(page.getByTestId('size-label').first()).toBeVisible();
    await page.getByTestId('viewer-sizes').click();
    await expect(page.getByTestId('size-label')).toHaveCount(0);

    // Step through the build, as on a tablet in the shop.
    await page.getByTestId('viewer-build').click();
    const bar = page.getByTestId('build-step-bar');
    await expect(bar.getByTestId('build-step-count')).toHaveText(/^Step 1 of \d+$/);
    await expect(page.getByTestId('build-step-prev')).toBeDisabled();
    await page.getByTestId('build-step-next').click();
    await expect(bar.getByTestId('build-step-count')).toHaveText(/^Step 2 of /);
    await page.getByTestId('build-step-done').click();
    await expect(bar).toHaveCount(0);

    expect(problems).toEqual([]);
});

test('a plan from a newer Woodshop says so instead of a blank page', async ({ page }, info) => {
    const file = info.outputPath('newer.html');
    writeFileSync(
        file,
        exportedPlan({
            theme: 'dark',
            title: 'Newer',
            css: '',
            payload: scriptSafe({ version: 9, project: { name: 'Newer' }, spec: { specVersion: '99.0' } }),
            js: bundle('viewer.js').replace(/<\/script/g, '<\\/script'),
        }),
    );
    await page.goto(pathToFileURL(file).href);
    await expect(page.getByTestId('viewer-error')).toHaveText(
        'This plan was written by a newer version of Woodshop and cannot be opened here.',
    );
});

test('a plan with an AR model links to it where AR Quick Look is, and only there', async ({
    browser,
}, info) => {
    const html = readFileSync('crates/woodshop-export/templates/viewer.html', 'utf8');
    expect(html).toContain('{{ar}}');
    const link =
        '<a rel="ar" id="woodshop-ar" href="Record%20stand.usdz" style="position:fixed;left:12px;bottom:12px"><img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'10\'/%3E" width="172" height="36" alt="View in your room"></a>';
    const payload = {
        version: 1,
        exportedAt: '2026-11-23T12:00:00Z',
        project: { name: 'Record stand' },
        spec: recordStand,
        kerf: 0.125,
        theme: 'light',
        notes: [],
        units: 'fraction',
    };
    const file = info.outputPath('Record stand.html');
    writeFileSync(
        file,
        exportedPlan({
            theme: 'light',
            title: 'Record stand',
            css: bundle('viewer.css').replace(/<\/style/g, '<\\/style'),
            payload: scriptSafe(payload),
            js: bundle('viewer.js').replace(/<\/script/g, '<\\/script'),
            ar: link,
        }),
    );

    // Opened from the Files app, scripts do not run: the plain link is still there.
    const noScripts = await browser.newContext({ javaScriptEnabled: false });
    const still = await noScripts.newPage();
    await still.goto(pathToFileURL(file).href);
    await expect(still.getByRole('link', { name: 'View in your room' })).toHaveAttribute(
        'href',
        'Record%20stand.usdz',
    );
    await noScripts.close();

    // Safari on an iPhone or iPad has AR Quick Look: the link moves into the 3D controls.
    const quickLook = await browser.newContext();
    await quickLook.addInitScript(() => {
        const supports = DOMTokenList.prototype.supports;
        DOMTokenList.prototype.supports = function (token: string) {
            return token === 'ar' || supports.call(this, token);
        };
    });
    const ios = await quickLook.newPage();
    await ios.goto(pathToFileURL(file).href);
    await expect(ios.getByTestId('viewer-canvas')).toBeVisible();
    const ar = ios.getByRole('link', { name: 'View in your room' });
    await expect(ar).toHaveCount(1);
    await expect(ar).toHaveAttribute('data-testid', 'viewer-ar');
    await expect(ar).toHaveAttribute('rel', 'ar');
    await expect(ar).toHaveAttribute('href', 'Record%20stand.usdz');
    expect(await ar.evaluate((a) => [a.children.length, a.firstElementChild?.tagName])).toEqual([1, 'IMG']);
    await quickLook.close();

    // A desktop browser would only download the file, so the link goes.
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await expect(page.getByTestId('viewer-canvas')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View in your room' })).toHaveCount(0);
    await page.close();
});

/** A GLB holding one triangle, `size` inches across: the smallest model a plan can carry. */
function triangleGlb(size: number): Buffer {
    const positions = Buffer.alloc(36);
    [0, 0, 0, size, 0, 0, 0, size, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
    let json = JSON.stringify({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: 3,
                type: 'VEC3',
                min: [0, 0, 0],
                max: [size, size, 0],
            },
        ],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        buffers: [{ byteLength: 36 }],
    });
    while (json.length % 4 !== 0) json += ' ';
    const head = Buffer.alloc(12);
    head.write('glTF', 0, 'ascii');
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(12 + 8 + json.length + 8 + 36, 8);
    const chunk = (type: number, body: Buffer) => {
        const h = Buffer.alloc(8);
        h.writeUInt32LE(body.length, 0);
        h.writeUInt32LE(type, 4);
        return Buffer.concat([h, body]);
    };
    return Buffer.concat([head, chunk(0x4e4f534a, Buffer.from(json)), chunk(0x004e4942, positions)]);
}

test('a plan carries the 3D models a design imported and draws them offline', async ({ page }, info) => {
    const hash = 'ab'.repeat(32);
    const spec = {
        ...recordStand,
        specVersion: '1.22',
        models: [
            {
                id: 'm_tri',
                name: 'Triangle',
                hash,
                size: { l: 12, w: 1, h: 12 },
                bytes: 100,
                source: 'Made for the test',
                license: 'CC0',
            },
        ],
        props: [{ id: 'pr_tri', model: 'm_tri', pos: [0, 0, 30] }],
    };
    const payload = {
        version: 1,
        exportedAt: '2026-11-24T12:00:00Z',
        project: { name: 'Record stand' },
        spec,
        kerf: 0.125,
        theme: 'dark',
        notes: [],
        units: 'fraction',
        models: { [hash]: triangleGlb(12).toString('base64') },
    };
    const file = info.outputPath('With a model.html');
    writeFileSync(
        file,
        exportedPlan({
            theme: 'dark',
            title: 'Record stand',
            css: bundle('viewer.css').replace(/<\/style/g, '<\\/style'),
            payload: scriptSafe(payload),
            js: bundle('viewer.js').replace(/<\/script/g, '<\\/script'),
        }),
    );
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on(
        'request',
        (r) =>
            !r.url().startsWith('file:') &&
            !r.url().startsWith('blob:') &&
            !r.url().startsWith('data:') &&
            problems.push(`fetched ${r.url()}`),
    );
    await page.goto(pathToFileURL(file).href);
    await expect(page.getByTestId('viewer-canvas')).toBeVisible();
    // The model is credited, never listed: the cut list is the record stand's alone.
    await expect(page.getByTestId('cutlist-totals')).toContainText('Overall');
    await expect(page.getByTestId('viewer-model-credits')).toHaveText(
        '3D models shown with it, not part of the build: Triangle, from Made for the test (CC0).',
    );
    await page.waitForTimeout(500); // the model decodes after the first frame
    expect(problems).toEqual([]);
});
