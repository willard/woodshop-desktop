import { expect, test } from '@playwright/test';

// Every page load starts a fresh mock library seeded with one project, "Record stand" (#1).

test('the library lists projects and opens one in the editor', async ({ page }) => {
    await page.goto('/#/');
    const row = page.getByTestId('project-row').filter({ hasText: 'Record stand' });
    await expect(row).toBeVisible();
    await row.getByTestId('open-project').click();

    await expect(page).toHaveURL(/#\/projects\/1$/);
    await expect(page.getByTestId('editor-shell').locator('canvas').first()).toBeVisible();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect(page.getByTestId('lint-badge')).toBeVisible();
});

test('a template becomes a new project', async ({ page }) => {
    await page.goto('/#/templates');
    const card = page.getByTestId('template-card').filter({ hasText: 'Bookshelf' });
    await card.getByTestId('use-template').click();

    await expect(page).toHaveURL(/#\/projects\/\d+$/);
    await expect(page.getByTestId('parts-count')).not.toHaveText('0 parts');
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await expect(page.getByTestId('project-row')).toHaveCount(2);
});

test('edits autosave, and undo is itself an edit', async ({ page }) => {
    await page.goto('/#/projects/1');
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('Board', { exact: true }).click();
    await expect(page.getByTestId('parts-count')).toHaveText('7 parts');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await expect(page.getByTestId('properties')).toBeVisible();

    await page.getByTestId('undo').click();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
});

test('the cut list totals the design', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    const totals = page.getByTestId('cutlist-totals');
    await expect(totals).toContainText('Board feet');
    await expect(page.getByTestId('cutlist-hardware')).toContainText('pocket screws');
    await expect(page.getByTestId('cutlist-section').first()).toBeVisible();
    for (const id of ['cutlist-export-pdf', 'cutlist-export-html', 'cutlist-export-csv']) {
        await expect(page.getByTestId(id)).toBeVisible();
    }
});

test('notes are kept with the project', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('notes-tab').click();
    await page.getByTestId('note-input').fill('Use the good ply for the top.');
    await page.getByTestId('note-add').click();
    await expect(page.getByTestId('note-row')).toHaveCount(1);
    await expect(page.getByTestId('note-row')).toContainText('Use the good ply for the top.');
});

test('a saved version can be restored', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('versions-toggle').click();
    await page.getByTestId('version-label').fill('Before the extra board');
    await page.getByTestId('save-version').click();
    await expect(page.getByTestId('version-row')).toHaveCount(1);
    await page.getByTestId('versions').getByRole('button', { name: /Close/ }).click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('Board', { exact: true }).click();
    await expect(page.getByTestId('parts-count')).toHaveText('7 parts');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');

    await page.getByTestId('versions-toggle').click();
    const row = page.getByTestId('version-row').filter({ hasText: 'Before the extra board' });
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
});

test('theme toggles between light and dark', async ({ page }) => {
    await page.goto('/#/');
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByTestId('theme-toggle').click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
});

test('a calculator works offline', async ({ page }) => {
    await page.goto('/#/tools');
    await expect(page.getByTestId('tools-page')).toBeVisible();
    await page.getByTestId('tools-filter').fill('sag');
    await page.getByRole('button', { name: 'Shelf sag' }).click();
    await expect(page.getByTestId('sg-verdict')).toBeVisible();
});

test('settings show how to connect an MCP client', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByText('claude mcp add woodshop', { exact: false })).toBeVisible();
});

test('when parts cannot be dragged, the editor says why and how to fix it', async ({ page }) => {
    await page.goto('/#/projects/1');
    const blocked = page.getByTestId('drag-blocked');
    await expect(blocked).toHaveCount(0);

    await page.getByTestId('mode-toggle').click();
    await expect(blocked).toContainText('View mode');
    await blocked.getByRole('button').click();
    await expect(blocked).toHaveCount(0);
    await expect(page.getByTestId('mode-toggle')).toHaveText('Edit');

    await page.getByTestId('explode-toggle').click();
    await expect(blocked).toContainText('Exploded view');
    await blocked.getByRole('button').click();
    await expect(blocked).toHaveCount(0);
});

test('a group becomes a project of its own', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    // A cut list row for identical parts selects all of them: here the top and bottom.
    await page.getByTestId('cutlist-group-row').filter({ hasText: 'Top, Bottom' }).click();
    await page.getByTestId('inspector-tab').click();
    await expect(page.getByTestId('multi-panel')).toBeVisible();
    await expect(page.getByTestId('multi-new-project')).toHaveText('New project from 2 parts');

    await page.getByTestId('multi-group').click();
    await page.getByTestId('group-new-project').click();

    await expect(page).not.toHaveURL(/#\/projects\/1$/);
    await expect(page.getByTestId('parts-count')).toHaveText('2 parts');
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await expect(page.getByTestId('project-row')).toHaveCount(2);
    await expect(page.getByTestId('project-row').filter({ hasText: 'Record stand' })).toHaveCount(1);
});

test('hardware from the catalog mounts on a part and joins the hardware list', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-group-row').filter({ hasText: 'Back Panel' }).click();
    await page.getByTestId('inspector-tab').click();

    await page.getByTestId('add-hardware').click();
    const dialog = page.getByTestId('hardware-dialog');
    await dialog.getByTestId('hardware-search').fill('96 mm');
    await dialog.locator('[data-item="pull.bar-96mm"]').click();
    await dialog.getByTestId('hardware-add').click();

    const row = page.getByTestId('hardware-row');
    await expect(row).toContainText('Bar pull, 96 mm centers');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');

    // It can be moved, and it shows up in what to buy.
    await row.getByTestId('hardware-x').fill('4 1/2');
    await row.getByTestId('hardware-x').blur();
    await expect(row.getByTestId('hardware-x')).toHaveValue('4 1/2');
    await page.getByTestId('cutlist-toggle').click();
    await expect(page.getByTestId('cutlist-hardware')).toContainText('bar pulls, 96 mm centers');

    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('cutlist-hardware')).not.toContainText('bar pulls');
});

test('hardware is placed by clicking on the model', async ({ page }) => {
    await page.goto('/#/projects/1');
    const canvas = page.getByTestId('editor-shell').locator('canvas').first();
    await expect(canvas).toBeVisible();

    await page.getByTestId('add-menu-toggle').click();
    await page.getByTestId('add-hardware-menu').click();
    await page.locator('[data-item="knob.round-1-1-4"]').click();
    await page.getByTestId('hardware-place').click();

    // Placement mode: a chip says what is being placed and how to turn it.
    const chip = page.getByTestId('placement-chip');
    await expect(chip).toContainText('Placing Round knob');
    await page.getByTestId('placement-turn').click();

    // Click the middle of the model twice, a little apart: two knobs, still in placement mode.
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await page.mouse.move(cx + 12, cy + 30);
    await page.mouse.click(cx + 12, cy + 30);
    await expect(chip).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(chip).toHaveCount(0);

    await page.getByTestId('cutlist-toggle').click();
    const row = page
        .getByTestId('cutlist-hardware')
        .locator('div', { hasText: '1 1/4" round cabinet knobs' })
        .last();
    await expect(row).toContainText('×2');

    // Each placement is its own undo step.
    await page.getByTestId('undo').click();
    await expect(row).toContainText('×1');
});
