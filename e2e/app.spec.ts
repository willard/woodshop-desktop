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

test('a first run offers the sample and walks through the tour', async ({ page }) => {
    await page.goto('/?empty#/');
    const welcome = page.getByTestId('welcome');
    await expect(welcome).toContainText('Welcome to Woodshop');
    await welcome.getByTestId('open-sample').click();

    await expect(page).toHaveURL(/#\/projects\/\d+$/);
    await expect(page.getByTestId('parts-count')).toHaveText('20 parts');
    const tour = page.getByTestId('tour');
    await expect(page.getByTestId('tour-progress')).toHaveText('Step 1 of 5');
    for (const title of ['Select a part', 'Move it', 'The cut list']) {
        await tour.getByTestId('tour-next').click();
        await expect(page.getByTestId('tour-title')).toHaveText(title);
    }
    // A step about a control rings it.
    await expect(page.getByTestId('tour-ring')).toBeVisible();
    await tour.getByTestId('tour-back').click();
    await expect(page.getByTestId('tour-ring')).toHaveCount(0);
    await tour.getByTestId('tour-next').click();
    await tour.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-title')).toHaveText('Take it to the shop');
    await tour.getByTestId('tour-next').click();
    await expect(tour).toHaveCount(0);

    // Re-run from Help: it reopens the same sample instead of making another.
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await page.getByRole('link', { name: 'Help' }).click();
    await page.getByTestId('start-tour').click();
    await expect(page.getByTestId('tour')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await expect(page.getByTestId('project-row')).toHaveCount(1);

    // Opening a project normally never starts the tour.
    await page.getByTestId('project-row').getByTestId('open-project').click();
    await expect(page.getByTestId('parts-count')).toHaveText('20 parts');
    await expect(page.getByTestId('tour')).toHaveCount(0);
});

test('the view buttons look from the front, side and top, and fit the design', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/#/projects/1');
    const canvas = page.getByTestId('editor-shell').locator('canvas').first();
    await expect(canvas).toBeVisible();
    const before = await canvas.screenshot();
    for (const view of ['front', 'side', 'top', 'three-quarter', 'fit']) {
        await page.getByTestId(`view-${view}`).click();
    }
    await page.getByTestId('view-front').click();
    await page.waitForTimeout(300);
    // The front view is a different picture from the three-quarter one a design opens in.
    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
    expect(errors).toEqual([]);
});

test('moving between screens never shows a blank window', async ({ page }) => {
    // Make the next pages' code slow to arrive, the way a cold start is.
    const slow = async (route: import('@playwright/test').Route) => {
        await new Promise((r) => setTimeout(r, 700));
        await route.continue();
    };
    await page.route(/\/pages\/(HelpPage|EditorPage)\.tsx/, slow);
    await page.goto('/#/');
    const row = page.getByTestId('project-row').first();
    await expect(row).toBeVisible();

    // Help: the nav bar and the project list stay up until Help can draw.
    await page.getByRole('link', { name: 'Help' }).click();
    await page.waitForTimeout(250);
    await expect(row).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();

    // The editor: the list stays until the editor opens drawn, never on "Opening…".
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByTestId('project-row').first().getByTestId('open-project').click();
    await page.waitForTimeout(250);
    await expect(page.getByTestId('project-row').first()).toBeVisible();
    await expect(page.getByText('Opening…')).toHaveCount(0);
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
});

test('a project card opens the project, and its menu renames, duplicates and trashes it', async ({
    page,
}) => {
    await page.goto('/#/');
    const cards = page.getByTestId('project-row');
    await expect(cards).toHaveCount(1);
    // A card by its exact name: copies share the original's name as a prefix.
    const menu = (name: string) =>
        page
            .getByRole('button', { name: `Actions for ${name}`, exact: true })
            .first()
            .click();

    // Rename from the menu.
    await menu('Record stand');
    await page.getByTestId('project-menu').getByRole('button', { name: 'Rename' }).click();
    await page.getByTestId('rename-input').fill('Hi-fi stand');
    await page.getByTestId('rename-input').press('Enter');
    await expect(cards.first()).toContainText('Hi-fi stand');

    // Duplicate it up past a screenful: search and sort appear.
    await expect(page.getByTestId('project-tools')).toHaveCount(0);
    for (let i = 0; i < 12; i++) {
        await menu('Hi-fi stand');
        await page.getByTestId('project-menu').getByRole('button', { name: 'Duplicate' }).click();
        await expect(cards).toHaveCount(i + 2);
    }
    await expect(page.getByTestId('project-tools')).toBeVisible();
    await page.getByTestId('project-search').fill('(copy)');
    await expect(cards).toHaveCount(12);
    await page.getByTestId('project-search').fill('nothing like this');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No project matches.')).toBeVisible();
    await page.getByTestId('project-search').fill('');

    // Trash one: it says so, and the trash has it.
    await menu('Hi-fi stand (copy)');
    await page.getByTestId('project-trash').click();
    await expect(page.getByText(/Moved “Hi-fi stand \(copy\)” to the trash/)).toBeVisible();
    await expect(cards).toHaveCount(12);

    // The card itself opens the project.
    await page.getByRole('link', { name: /^Hi-fi stand 6 parts/ }).click();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
});

test('a template becomes a new project', async ({ page }) => {
    await page.goto('/#/templates');
    // Every card has its picture, a description for a customer, and the size and stock to buy.
    const cards = page.getByTestId('template-card');
    await expect(cards).toHaveCount(25);
    const pictures = page.getByTestId('template-thumb');
    await expect(pictures).toHaveCount(25);
    for (const img of await pictures.all()) {
        await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(640);
    }
    const card = cards.filter({ has: page.getByRole('heading', { name: 'Bookshelf', exact: true }) });
    await expect(card).toContainText('A tall, open five-bay bookshelf');
    await expect(card.getByTestId('template-facts')).toHaveText('32" × 11 1/4" × 72" · 2 sheets');
    // The two record stands are told apart.
    await expect(cards.filter({ hasText: 'Simple Record Stand' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Dado Build' })).toHaveCount(1);
    await card.getByTestId('use-template').click();

    await expect(page).toHaveURL(/#\/projects\/\d+$/);
    await expect(page.getByTestId('parts-count')).not.toHaveText('0 parts');
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await expect(page.getByTestId('project-row')).toHaveCount(2);
});

test('leaving the editor and coming back shows the latest edits', async ({ page }) => {
    const reopen = async () => {
        await page.getByRole('link', { name: 'Settings' }).click();
        await expect(page).toHaveURL(/#\/settings$/);
        await page.getByRole('link', { name: 'Projects' }).click();
        await page
            .getByTestId('project-row')
            .filter({ hasText: 'Record stand' })
            .getByTestId('open-project')
            .click();
    };
    await page.goto('/#/projects/1');
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');

    // Saved, then away to Settings and back into the project.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('add-board').click();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await reopen();
    await expect(page.getByTestId('parts-count')).toHaveText('7 parts');

    // Leaving before the autosave fires: the edit still comes back, and nothing conflicts.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('add-board').click();
    await expect(page.getByTestId('parts-count')).toHaveText('8 parts');
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await reopen();
    await expect(page.getByTestId('parts-count')).toHaveText('8 parts');
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
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
    // Parts to cut come first; hardware after them, its screws folded into one line.
    const panel = page.getByTestId('cutlist');
    const order = await panel.evaluate((el) =>
        ['cutlist-section', 'cutlist-hardware', 'cutlist-settings'].map((id) =>
            [...el.querySelectorAll('[data-testid]')].findIndex((n) => n.getAttribute('data-testid') === id),
        ),
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    const hardware = page.getByTestId('cutlist-hardware');
    await expect(hardware).not.toContainText('pocket screws');
    await page.getByTestId('cutlist-fasteners').click();
    await expect(hardware).toContainText('pocket screws');
    // A design with prices shows its cost.
    await expect(totals).toContainText('$');

    // One without prices says how to get one, and takes you there.
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Wall Cabinet', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-add-prices').click();
    await expect(page.getByTestId('material-price').first()).toBeFocused();
    await expect(page.getByTestId('cutlist-section').first()).toBeVisible();
    for (const id of ['cutlist-export-pdf', 'cutlist-export-html', 'cutlist-export-csv']) {
        await expect(page.getByTestId(id)).toBeVisible();
    }
});

test('parts export as DXF for a CNC, and the assembly as glTF', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Wall Cabinet', exact: true }) })
        .getByTestId('use-template')
        .click();
    await expect(page.getByTestId('parts-count')).toHaveText('8 parts');
    const written = () =>
        page.evaluate(() => (window as unknown as { __written?: Record<string, string> }).__written ?? {});

    await page.getByTestId('toolbar-overflow-toggle').click();
    await page.getByTestId('export-dxf').click();
    await expect(page.getByText('DXF saved.')).toBeVisible();
    const dxf = (await written())['/mock/exports/Wall Cabinet.dxf'];
    expect(dxf).toContain('AC1009');
    // One closed outline per part, and the doors' hinge cups on their own layer, drilled from
    // the back: 35 mm across, 12 mm deep.
    expect(dxf.match(/\nCUT_OUTSIDE\n66\n/g)).toHaveLength(8);
    const cups = dxf.split('\n0\nCIRCLE\n').slice(1);
    expect(cups).toHaveLength(4);
    for (const cup of cups) {
        expect(cup).toMatch(/^8\nHOLE_0\.4724_BACK\n/);
        expect(cup).toMatch(/\n40\n0\.689(\n|$)/); // the catalog's 1.378" cup
    }

    await page.getByTestId('toolbar-overflow-toggle').click();
    await page.getByTestId('export-gltf').click();
    await expect(page.getByText('3D model saved.')).toBeVisible();
    const gltf = JSON.parse((await written())['/mock/exports/Wall Cabinet.gltf']) as {
        asset: { version: string };
        nodes: { name?: string; matrix?: number[] }[];
        meshes: unknown[];
    };
    expect(gltf.asset.version).toBe('2.0');
    const names = gltf.nodes.map((n) => n.name);
    for (const part of ['Left Side', 'Back', 'Left Door', 'Right Door']) expect(names).toContain(part);
    // Inches to metres on the root; every node has a name a 3D app can show.
    const root = gltf.nodes.find((n) => n.name === 'Wall Cabinet')!;
    expect([root.matrix![0], root.matrix![5], root.matrix![10]]).toEqual([0.0254, 0.0254, 0.0254]);
    expect(names.filter((n) => n === undefined)).toEqual([]);
    expect(gltf.meshes.length).toBeGreaterThan(8); // the parts and their hardware
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

test('settings say what licence Woodshop is under and list the open-source licenses', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByText('GNU General Public License, version 3 or later')).toBeVisible();
    await page.getByTestId('about-notices').click();
    const dialog = page.getByTestId('notices');
    await expect(dialog).toBeVisible();
    // Release builds ship the notices file; a checkout without it says how to make it.
    await expect(dialog.getByText(/Woodshop — third-party software notices|npm run notices/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
});

test('the parts list selects, hides and renames parts, and folds away', async ({ page }) => {
    await page.goto('/#/projects/1');
    const outline = page.getByTestId('outline');
    await expect(outline).toBeVisible();
    const rows = outline.getByTestId('outline-row');
    await expect(rows).toHaveCount(6);

    // Select from the list: the inspector follows.
    const top = rows.filter({ hasText: 'Top' });
    await top.getByRole('button', { name: 'Top', exact: true }).click();
    await expect(top).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('properties')).toBeVisible();

    // Hide and show it again.
    await top.getByTestId('outline-eye').click();
    await expect(top).toHaveAttribute('data-hidden', 'true');
    await expect(page.getByTestId('hidden-chip')).toBeVisible();
    await top.getByTestId('outline-eye').click();
    await expect(top).not.toHaveAttribute('data-hidden', 'true');

    // Rename by double-click: one undoable edit.
    await top.getByRole('button', { name: 'Top', exact: true }).dblclick();
    await page.getByTestId('outline-rename').fill('Lid');
    await page.getByTestId('outline-rename').press('Enter');
    await expect(rows.filter({ hasText: 'Lid' })).toHaveCount(1);
    await page.getByTestId('undo').click();
    await expect(rows.filter({ hasText: 'Top' })).toHaveCount(1);

    // P folds it away, and the choice is remembered.
    await page
        .locator('canvas')
        .first()
        .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('p');
    await expect(outline).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('parts-count')).toBeVisible();
    await expect(outline).toHaveCount(0);
    await page.getByTestId('outline-toggle').click();
    await expect(outline).toBeVisible();
});

test('? lists the shortcuts, and the tool keys work', async ({ page }) => {
    await page.goto('/#/projects/1');
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
    await page.getByTestId('shortcuts-toggle').click();
    const list = page.getByTestId('shortcuts');
    await expect(list).toContainText('Explode the view');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');

    await page.keyboard.press('e');
    await expect(page.getByTestId('explode-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('e');
    await expect(page.getByTestId('explode-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('m');
    await expect(page.getByTestId('measure-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('m');
    await page.keyboard.press('v');
    await expect(page.getByTestId('mode-view')).toHaveAttribute('aria-checked', 'true');
});

test('the inspector adds a cut from one menu, says it in plain words, and remembers folded sections', async ({
    page,
}) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('outline').getByRole('button', { name: 'Top', exact: true }).click();
    const cuts = page.getByTestId('section-cuts');
    await expect(cuts).toContainText('Cuts & fasteners');
    const before = await cuts.getByTestId('ops-row').count();

    await page.getByTestId('ops-add-menu').click();
    await page.getByTestId('ops-add-hole').click();
    await page.getByTestId('hole-x').fill('2');
    await page.getByTestId('hole-y').fill('3');
    await page.getByTestId('hole-diameter').fill('1/4');
    await page.getByTestId('hole-submit').click();
    await expect(cuts.getByTestId('ops-row')).toHaveCount(before + 1);
    await expect(cuts.getByTestId('ops-row').last()).toContainText('Hole ⌀ 1/4"');
    await expect(cuts.getByTestId('ops-row').last()).toContainText('2" from the left end, 3" up');

    // Rotation says what it does.
    await expect(page.getByTestId('rot-90-1')).toHaveText('Turn 90°');

    // Fold Orientation away; it stays folded.
    await page.getByTestId('section-toggle-orientation').click();
    await expect(page.getByTestId('rot-90-1')).toHaveCount(0);
    await page.reload();
    await page.getByTestId('outline').getByRole('button', { name: 'Top', exact: true }).click();
    await expect(page.getByTestId('section-orientation')).toBeVisible();
    await expect(page.getByTestId('rot-90-1')).toHaveCount(0);
});

test('when parts cannot be dragged, the editor says why and how to fix it', async ({ page }) => {
    await page.goto('/#/projects/1');
    const blocked = page.getByTestId('drag-blocked');
    await expect(blocked).toHaveCount(0);

    await page.getByTestId('mode-view').click();
    await expect(page.getByTestId('mode-view')).toHaveAttribute('aria-checked', 'true');
    await expect(blocked).toContainText('View mode');
    await blocked.getByRole('button').click();
    await expect(blocked).toHaveCount(0);
    await expect(page.getByTestId('mode-edit')).toHaveAttribute('aria-checked', 'true');

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

test('clicking hardware in the 3D view selects it in the inspector', async ({ page }) => {
    await page.goto('/#/projects/1');
    const canvas = page.getByTestId('editor-shell').locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Put a knob exactly where we will click.
    await page.getByTestId('add-menu-toggle').click();
    await page.getByTestId('add-hardware-menu').click();
    await page.locator('[data-item="knob.round-1-1-2"]').click();
    await page.getByTestId('hardware-place').click();
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await page.keyboard.press('Escape');

    // Click empty space first, so nothing is selected, then click the knob.
    await page.mouse.click(box.x + 20, box.y + 20);
    await page.mouse.click(cx, cy);

    const row = page.locator('[data-testid="hardware-row"][data-selected]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Round knob 1 1/2"');
    await expect(page.getByTestId('properties')).toBeVisible();
});

test('hardware can be dragged along its face, and the drag is one undo step', async ({ page }) => {
    await page.goto('/#/projects/1');
    const canvas = page.getByTestId('editor-shell').locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.getByTestId('add-menu-toggle').click();
    await page.getByTestId('add-hardware-menu').click();
    await page.locator('[data-item="knob.round-1-1-2"]').click();
    await page.getByTestId('hardware-place').click();
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await page.keyboard.press('Escape');
    // Select it (and its part), so the inspector shows where it sits.
    await page.mouse.click(cx, cy);

    const row = page.locator('[data-testid="hardware-row"][data-selected]');
    await expect(row).toBeVisible();
    const x = row.getByTestId('hardware-x');
    const y = row.getByTestId('hardware-y');
    const before = [await x.inputValue(), await y.inputValue()];

    // Press on the knob and drag it: a label follows, the part itself stays put.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy + 10, { steps: 4 });
    await page.mouse.move(cx + 40, cy + 20, { steps: 4 });
    await expect(page.getByTestId('hardware-drag-label')).toBeVisible();
    await expect(page.getByTestId('drag-label')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByTestId('hardware-drag-label')).toHaveCount(0);

    await expect.poll(async () => [await x.inputValue(), await y.inputValue()]).not.toEqual(before);

    await page.getByTestId('undo').click();
    await expect(x).toHaveValue(before[0]);
    await expect(y).toHaveValue(before[1]);

    // Escape mid-drag puts the knob back and records nothing.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 20, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(x).toHaveValue(before[0]);
    await expect(y).toHaveValue(before[1]);
});

test('working in millimetres, a design never shows an inch', async ({ page }) => {
    await page.goto('/#/settings');
    await page.getByTestId('units-metric').click();

    // A new blank project starts on metric stock.
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByPlaceholder('New project name').fill('Metric box');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/#\/projects\/\d+$/);

    await page.getByTestId('cutlist-toggle').click();
    const cutlist = page.getByTestId('cutlist');
    await expect(cutlist).toContainText('Birch Plywood 18 mm');
    await expect(cutlist).toContainText('2440 × 1220 mm');

    // The inspector reads and takes millimetres; a named unit still works.
    await page.getByTestId('cutlist-group-row').filter({ hasText: 'Base' }).click();
    await page.getByTestId('inspector-tab').click();
    await expect(page.getByText('Length (mm)')).toBeVisible();
    const length = page.getByTestId('length');
    await length.fill('450');
    await length.press('Enter');
    await expect(length).toHaveValue('450');
    const width = page.getByTestId('width');
    await width.fill('12 in');
    await width.press('Enter');
    await expect(width).toHaveValue('305');

    // Nothing on screen is in inches.
    await page.getByTestId('cutlist-toggle').click();
    await expect(cutlist).toContainText('450 × 305 × 18 mm');
    await expect(page.locator('body')).not.toContainText('"');
});

test('in millimetres, hardware is named the way a metric shop sells it', async ({ page }) => {
    await page.goto('/#/settings');
    await page.getByTestId('units-metric').click();
    await page.getByRole('link', { name: 'Templates' }).click();
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Toy Chest', exact: true }) })
        .getByTestId('use-template')
        .click();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');

    await page.getByTestId('cutlist-toggle').click();
    const hardware = page.getByTestId('cutlist-hardware');
    await expect(hardware).toContainText('75 mm butt hinges');
    await expect(hardware).toContainText('100 mm chest handles');
    await page.getByTestId('cutlist-fasteners').click();
    await expect(hardware).toContainText('wood screws');

    // The catalog, too: every item by its metric name, and not an inch mark anywhere.
    await page.getByTestId('add-menu-toggle').click();
    await page.getByTestId('add-hardware-menu').click();
    await expect(page.locator('[data-item="knob.round-1-1-4"]')).toContainText('Round knob 32 mm');
    await expect(page.locator('[data-item="pull.bar-3in"]')).toContainText('Bar pull, 76 mm centers');
    await expect(page.locator('body')).not.toContainText('"');
});

test('a project comes back out of a backup', async ({ page }) => {
    await page.goto('/#/settings');
    await page.getByTestId('backup-now').click();
    await expect(page.getByTestId('backup-row')).toHaveCount(1);

    // Lose the project, then get it back from the backup.
    await page.getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByTestId('project-row')).toHaveCount(1);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByTestId('backup-open').click();
    const project = page.getByTestId('backup-project').filter({ hasText: 'Record stand' });
    await expect(project).toContainText('6 parts');
    await project.getByTestId('backup-restore').click();

    await expect(page).toHaveURL(/#\/projects\/\d+$/);
    await expect(page.getByText('Record stand (restored)')).toBeVisible();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
});

test('a door on concealed hinges gets its cups bored in the 3D view', async ({ page }) => {
    // The cut happens in a worker and the hinge sits over the hole, so watch what is asked of it.
    await page.addInitScript(() => {
        const sent: unknown[] = [];
        (window as unknown as { __csgHoles: unknown[] }).__csgHoles = sent;
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
            const holes = (message as { holes?: unknown[] } | null)?.holes;
            if (Array.isArray(holes)) sent.push(...holes);
            return (post as (...args: unknown[]) => void).call(this, message, ...rest);
        };
    });
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: /Dado Build/ }) })
        .getByTestId('use-template')
        .click();
    await expect(page.getByTestId('parts-count')).not.toHaveText('0 parts');

    // Two hinges on the door: two 35 mm cups, 12 mm deep, in its back face (however many times
    // the scene is rebuilt).
    type Sent = { face: string; x: number; y: number; diameter: number; depth?: number };
    await expect
        .poll(() =>
            page.evaluate(() => {
                const cups = (window as unknown as { __csgHoles: Sent[] }).__csgHoles.filter(
                    (h) => h.face === 'back' && Math.abs(h.diameter - 35 / 25.4) < 0.001,
                );
                return [
                    ...new Set(
                        cups.map(
                            (h) =>
                                `${h.x.toFixed(2)},${h.y.toFixed(2)} @${Math.round((h.depth ?? 0) * 25.4)}mm`,
                        ),
                    ),
                ].length;
            }),
        )
        .toBe(2);
});
