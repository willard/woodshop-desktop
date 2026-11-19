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
    return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
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
