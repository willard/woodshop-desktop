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
    await expect(page.getByTestId('parts-count')).toHaveText('17 parts');
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
    await expect(page.getByTestId('parts-count')).toHaveText('17 parts');
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

test('the selection can be zoomed in on, with the button or F', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/#/projects/1');
    const canvas = page.getByTestId('editor-shell').locator('canvas').first();
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('view-selection')).toHaveCount(0);
    await page.getByTestId('outline').getByRole('button', { name: 'Middle Shelf', exact: true }).click();
    await page.waitForTimeout(300);
    const whole = await canvas.screenshot();
    await page.getByTestId('view-selection').click();
    await page.waitForTimeout(300);
    const close = await canvas.screenshot();
    expect(Buffer.compare(whole, close)).not.toBe(0);
    // F with nothing selected fits the whole design again.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-selection')).toHaveCount(0);
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    expect(Buffer.compare(close, await canvas.screenshot())).not.toBe(0);
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
    await expect(cards).toHaveCount(30);
    const pictures = page.getByTestId('template-thumb');
    await expect(pictures).toHaveCount(30);
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
        ['cutlist-section', 'cutlist-hardware', 'cutlist-assembly', 'cutlist-settings'].map((id) =>
            [...el.querySelectorAll('[data-testid]')].findIndex((n) => n.getAttribute('data-testid') === id),
        ),
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(order[2]).toBeLessThan(order[3]);
    const hardware = page.getByTestId('cutlist-hardware');
    await expect(hardware).not.toContainText('pocket screws');
    await page.getByTestId('cutlist-fasteners').click();
    await expect(hardware).toContainText('pocket screws');
    // The assembly order, folded until asked for: the same steps the PDF plan prints.
    await expect(page.getByTestId('assembly-step')).toHaveCount(0);
    await page.getByTestId('cutlist-assembly-toggle').click();
    await expect(page.getByTestId('assembly-step').first()).toContainText('1. Start with');
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

test('boards are laid out like sheets, with narrow parts ripped side by side', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Kitchen Cart', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    // The four 1 1/2" legs come out of one 3 1/2" board, two across.
    const maple = page.getByTestId('cutlist-boards').filter({ hasText: 'Maple 8/4' });
    await expect(maple).toContainText('Maple 8/4: 1 board of 96"');
    const board = maple.getByTestId('cutlist-board');
    await expect(board).toHaveCount(1);
    for (const leg of ['Leg FL', 'Leg FR', 'Leg BL', 'Leg BR']) {
        await expect(board.getByText(leg, { exact: true })).toBeVisible();
    }
    // The rest of that board is left full width, outlined to keep, as is the end of a rail board.
    await expect(board.getByTestId('cutlist-leftover')).toHaveCount(1);
    const rails = page.getByTestId('cutlist-boards').filter({ hasText: 'Maple 1x4' });
    await expect(rails.getByTestId('cutlist-leftover').first()).toBeAttached();
});

test('each board is bought at the shortest length on sale that its cuts fit', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Picnic Table 6ft (A-Frame)', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    // 2x6 is sold at 96" and 120": only the boards that need 120" are bought that long.
    const twoBySix = page.getByTestId('cutlist-boards').filter({ hasText: '2x6' });
    await expect(twoBySix).toContainText('9 boards (4 × 120", 5 × 96")');
    await expect(twoBySix.getByTestId('cutlist-board')).toHaveCount(9);
    await expect(page.getByTestId('cutlist-stock').filter({ hasText: '4 × 120", 5 × 96"' })).toHaveCount(1);
});

test('the sheet layouts can show the order to make the saw cuts', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Bookshelf', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    const sheet = page.getByTestId('cutlist-sheet').first();
    await expect(sheet).toBeVisible();
    // The overall size says about what the wood weighs.
    await expect(page.getByTestId('cutlist-weight')).toHaveText(/^About \d+ lb of wood$/);
    await expect(page.getByTestId('cutlist-finish')).toHaveText(
        /^Finish: \d+ sq ft, about [\d.]+ qt a coat$/,
    );
    await expect(sheet.getByTestId('cutlist-saw-cut')).toHaveCount(0);
    await page.getByTestId('cutlist-cut-order').check();
    // The first cut on a full sheet is a rip, and the cuts are numbered from 1.
    await expect(sheet.getByTestId('cutlist-saw-cut').first()).toContainText('1');
    await expect(sheet.getByTestId('cutlist-saw-cut').first().locator('title')).toHaveText(
        /^Cut 1: rip .+ off, 96" long$/,
    );
    // Under the layout, each cut with its fence setting.
    await expect(page.getByTestId('cutlist-cut-steps').first()).toContainText(/^1 Rip \S+/);
    expect(await sheet.getByTestId('cutlist-saw-cut').count()).toBeGreaterThan(2);
});

test('sheet edges can be trimmed before the parts are cut', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Bookshelf', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    const sheet = page.getByTestId('cutlist-sheet').first();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('cutlist-sheet-trim')).toHaveCount(0);
    await page.getByTestId('sheet-trim-select').selectOption({ label: '1/4"' });
    // The trimmed edges are drawn, and the cut steps start by trimming them.
    await expect(sheet.getByTestId('cutlist-sheet-trim').locator('title')).toHaveText(
        'Trimmed edges: 1/4" off each',
    );
    await page.getByTestId('cutlist-cut-order').check();
    await expect(page.getByTestId('cutlist-cut-steps').first()).toContainText(
        /^Trim 1\/4" off each edge, then:1 Rip/,
    );
    // It is a setting: another design starts with it.
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Nightstand', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    await expect(page.getByTestId('sheet-trim-select')).toHaveValue('0.25');
});

test('board ends can be trimmed before the parts are cut', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Kitchen Cart', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    const legs = page.getByTestId('cutlist-boards').filter({ hasText: '8/4' });
    await expect(legs.getByTestId('cutlist-board')).toBeVisible();
    await page.getByTestId('board-trim-select').selectOption({ label: '1"' });
    // Both trimmed ends are marked, and the cut steps start by trimming them.
    await expect(legs.getByTestId('cutlist-board-trim')).toHaveCount(2);
    await page.getByTestId('cutlist-cut-order').check();
    await expect(legs.getByTestId('cutlist-cut-steps')).toContainText(
        /^Trim 1" off each end, then:1 Crosscut/,
    );
});

test('boards show their cut order too: crosscut to length, then ripped', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Kitchen Cart', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-cut-order').check();
    // The legs come from one 8/4 board: crosscut in two, then each length ripped.
    const legs = page.getByTestId('cutlist-boards').filter({ hasText: '8/4' });
    await expect(legs.getByTestId('cutlist-cut-steps')).toContainText(/^1 Crosscut .*Rip 1 1\/2"/);
    expect(await legs.getByTestId('cutlist-saw-cut').count()).toBeGreaterThan(2);
});

test('lumber is sold in lengths and a width, and priced by the board foot or by the board', async ({
    page,
}) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Entry Bench', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    const oneByFour = page.getByTestId('material-row').filter({ has: page.getByLabel('Price Pine 1x4 by') });
    await expect(oneByFour.getByTestId('stock-lengths')).toHaveValue('96');
    await expect(oneByFour.getByTestId('stock-width')).toHaveValue('3 1/2');

    // Priced as the store does, $5.25 a board: 1.75 board feet, so $3 a board foot.
    const price = oneByFour.getByTestId('material-price');
    await oneByFour.getByLabel('Price Pine 1x4 by').selectOption({ label: '/96" board' });
    await expect(price).toHaveAccessibleName('Price per 96" board of Pine 1x4');
    await price.fill('5.25');
    await price.blur();
    await oneByFour.getByLabel('Price Pine 1x4 by').selectOption({ label: '/bd ft' });
    await expect(price).toHaveValue('3');

    // The 1x12 by the board foot, and the design has a cost.
    const oneByTwelve = page.getByLabel('Price per board foot of Pine 1x12');
    await oneByTwelve.fill('4');
    await oneByTwelve.blur();
    await expect(page.getByTestId('cutlist-totals')).toContainText('Est. cost$');

    // Sold in 8' and 10' boards, typed in any order: listed shortest first, and the per-board
    // price is still for the shortest.
    const lengths = oneByFour.getByTestId('stock-lengths');
    await lengths.fill('120, 96');
    await lengths.blur();
    await expect(lengths).toHaveValue('96, 120');
    await oneByFour.getByLabel('Price Pine 1x4 by').selectOption({ label: '/96" board' });
    await expect(price).toHaveValue('5.25');
    // A length that is not one is refused, and the box goes back.
    await lengths.fill('96, lots');
    await lengths.blur();
    await expect(lengths).toHaveValue('96, 120');

    // A 1x6 instead: the boards are wider, and the same price per board is less per board foot.
    const width = oneByFour.getByTestId('stock-width');
    await width.fill('5 1/2');
    await width.blur();
    await expect(width).toHaveValue('5 1/2');
    await expect(price).toHaveValue('8.25');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(width).toHaveValue('3 1/2');
});

test('a material takes the thickness the stock really measures, and its dados follow', async ({ page }) => {
    await page.goto('/#/projects/1');
    await expect(page.getByTestId('lint-badge')).toContainText('Buildable');
    await page.getByTestId('cutlist-toggle').click();
    const thickness = page.getByTestId('material-thickness');
    const was = await thickness.inputValue();

    // The "18 mm" Baltic birch is really 23/32": the shelf's two dados widen with it.
    await thickness.fill('23/32');
    await thickness.blur();
    await expect(thickness).toHaveValue('23/32');
    await expect(page.getByText('2 joints resized to 23/32" to fit the new thickness.')).toBeVisible();
    await expect(page.getByTestId('lint-badge')).toContainText('Buildable');

    // Not a thickness: refused, and the box goes back.
    await thickness.fill('thick');
    await thickness.blur();
    await expect(thickness).toHaveValue('23/32');

    // One undo puts the thickness and both dados back.
    await page.getByTestId('undo').click();
    await expect(thickness).toHaveValue(was);
});

test('the cut list words the joinery, with each tool setup set once', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Record Stand 38" (Dado Build)', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-joinery-toggle').click();
    await expect(page.getByTestId('joinery-setup').first()).toHaveText(
        /^Dado stack 3\/4" wide, 3\/8" deep · \d+ cuts: .*Left Side Panel/,
    );
    await expect(page.getByTestId('joinery-part').first()).toContainText(
        /Dado 3\/4" wide × 3\/8" deep in the front face/,
    );
});

test('parts are ticked off as they are cut, and stay ticked', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Bookshelf', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('cutlist-toggle').click();
    await expect(page.getByTestId('cutlist-progress')).toHaveCount(0);
    // The two sides are one row: ticking it marks both pieces cut.
    await page.getByRole('checkbox', { name: 'Left Side, Right Side cut' }).check();
    await expect(page.getByTestId('cutlist-progress')).toContainText('2 of 8 pieces cut');
    // Closed and opened again, the ticks are still there.
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-toggle').click();
    await expect(page.getByRole('checkbox', { name: 'Left Side, Right Side cut' })).toBeChecked();
    await page.getByTestId('cutlist-progress-clear').click();
    await expect(page.getByTestId('cutlist-progress')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Left Side, Right Side cut' })).not.toBeChecked();
});

test('parts export as DXF for a CNC, labels and the assembly as glTF', async ({ page }) => {
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
    await page.getByTestId('export-labels').click();
    // A sheet with its first four labels used: start at the fifth.
    const labels = page.getByTestId('labels-dialog');
    await expect(labels.getByTestId('labels-summary')).toHaveText('8 labels, starting at label 1: 1 sheet');
    await labels.getByTestId('labels-start').nth(4).click();
    await expect(labels.getByTestId('labels-summary')).toHaveText('8 labels, starting at label 5: 1 sheet');
    await labels.getByTestId('labels-start').nth(25).click();
    await expect(labels.getByTestId('labels-summary')).toContainText('2 sheets');
    await labels.getByTestId('labels-start').nth(4).click();
    await labels.getByTestId('labels-print').click();
    await expect(page.getByText('Part labels saved.')).toBeVisible();
    expect((await written())['/mock/exports/Wall Cabinet.pdf']).toBe(
        'labels for Wall Cabinet in fraction from label 5',
    );

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

    // STL for a slicer: binary, in millimetres, standing on +Z.
    await page.getByTestId('toolbar-overflow-toggle').click();
    await page.getByTestId('export-stl').click();
    await expect(page.getByText('STL model saved.')).toBeVisible();
    const stl = await page.evaluate(() => {
        const bytes = (window as unknown as { __binary: { bytes: Uint8Array } }).__binary.bytes;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const triangles = view.getUint32(80, true);
        let low = Infinity;
        let high = -Infinity;
        for (let t = 0; t < triangles; t++) {
            for (let v = 0; v < 3; v++) {
                const z = view.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true);
                low = Math.min(low, z);
                high = Math.max(high, z);
            }
        }
        return { size: bytes.byteLength, triangles, height: high - low };
    });
    expect(stl.size).toBe(84 + 50 * stl.triangles);
    expect(stl.triangles).toBeGreaterThan(100);
    // The cabinet is 30" tall: 762 mm up the Z axis.
    expect(stl.height).toBeCloseTo(762, 0);

    await page.getByTestId('toolbar-overflow-toggle').click();
    await page.getByTestId('export-obj').click();
    await expect(page.getByText('OBJ model saved.')).toBeVisible();
    const obj = (await written())['/mock/exports/Wall Cabinet.obj'];
    expect(obj).toContain('o Left Side');
    expect(obj.split('\n').filter((l) => l.startsWith('v ')).length).toBeGreaterThan(100);
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
    await page.getByTestId('settings-group-agents').click();
    await expect(page.getByText('claude mcp add woodshop', { exact: false })).toBeVisible();
});

test('settings say what licence Woodshop is under and list the open-source licenses', async ({ page }) => {
    await page.goto('/#/settings');
    await page.getByTestId('settings-group-about').click();
    await expect(page.getByText('GNU General Public License, version 3 or later')).toBeVisible();
    await page.getByTestId('about-notices').click();
    const dialog = page.getByTestId('notices');
    await expect(dialog).toBeVisible();
    // Release builds ship the notices file; a checkout without it says how to make it.
    await expect(dialog.getByText(/Woodshop — third-party software notices|npm run notices/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
});

test('the parts list selects, hides, locks and renames parts, and folds away', async ({ page }) => {
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

    // Lock it, so agents leave it alone: the Inspector shows the lock, and it unlocks there.
    const lock = top.getByTestId('outline-lock');
    await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    await top.getByRole('button', { name: 'Top', exact: true }).click();
    const inspectorLock = page.getByTestId('part-lock');
    await expect(inspectorLock).toHaveText('locked');
    await inspectorLock.click();
    await expect(inspectorLock).toHaveAttribute('aria-pressed', 'false');
    await expect(lock).toHaveAttribute('aria-pressed', 'false');

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

test('a cut is changed in place from its own form, and undo puts it back', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('outline').getByRole('button', { name: 'Left Side', exact: true }).click();
    const cuts = page.getByTestId('section-cuts');
    const row = cuts.getByTestId('ops-row');
    await expect(row).toHaveCount(1);
    const before = await row.innerText();

    await page.getByTestId('ops-edit-0').click();
    await expect(row).toHaveAttribute('data-editing', 'true');
    await expect(page.getByTestId('ops-add-menu')).toHaveText('Changing: Dado or groove');
    await expect(page.getByTestId('dado-place')).toBeHidden();
    await page.getByTestId('dado-width').fill('1/2');
    await page.getByTestId('dado-submit').click();

    await expect(row).toHaveCount(1);
    await expect(row).toContainText('1/2" wide');
    await expect(row).not.toHaveAttribute('data-editing', 'true');
    await expect(page.getByTestId('ops-add-menu')).toHaveText('+ Add a cut');

    await page.getByTestId('undo').click();
    await expect(row).toHaveText(before);
});

test('a rabbet is added from the cut menu and changed in place', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('outline').getByRole('button', { name: 'Top', exact: true }).click();
    const rows = page.getByTestId('section-cuts').getByTestId('ops-row');
    const before = await rows.count();

    await page.getByTestId('ops-add-menu').click();
    await page.getByTestId('ops-add-rabbet').click();
    await page.getByTestId('rabbet-width').fill('1/4');
    await page.getByTestId('rabbet-depth').fill('3/8');
    await page.getByTestId('rabbet-submit').click();
    await expect(rows).toHaveCount(before + 1);
    await expect(rows.last()).toContainText('Rabbet 1/4" wide × 3/8" deep along the top edge');

    await page.getByTestId(`ops-edit-${before}`).click();
    await expect(page.getByTestId('rabbet-depth')).toHaveValue('3/8');
    await page.getByTestId('rabbet-depth').fill('1/4');
    await page.getByTestId('rabbet-submit').click();
    await expect(rows.last()).toContainText('Rabbet 1/4" wide × 1/4" deep');
});

test('the assembly video renders as an MP4 to post', async ({ page }) => {
    // CI draws WebGL and encodes H.264 in software: a 15 s film takes about 25 s there.
    test.setTimeout(150_000);
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-export-video').click();
    const dialog = page.getByTestId('video-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('video-shape').selectOption('square');
    await page.getByTestId('video-length').selectOption('short');
    // A browser without an H.264 encoder says so instead of offering to save.
    const make = page.getByTestId('video-make');
    await expect(make.or(page.getByTestId('video-unsupported'))).toBeVisible();
    await expect(async () => {
        const unsupported = await page.getByTestId('video-unsupported').isVisible();
        expect(unsupported || (await make.isEnabled())).toBe(true);
    }).toPass();
    if (await page.getByTestId('video-unsupported').isVisible()) {
        await expect(make).toBeDisabled();
        test.skip(true, 'This browser cannot encode H.264.');
    }
    await make.click();
    await expect(dialog).toBeHidden({ timeout: 120_000 });
    await expect(page.getByText('Assembly video saved.')).toBeVisible();
    const file = await page.evaluate(
        () => (window as unknown as { __binary: { size: number; head: number[] } }).__binary,
    );
    // An MP4 opens with its "ftyp" box.
    expect(String.fromCharCode(...file.head.slice(4, 8))).toBe('ftyp');
    expect(file.size).toBeGreaterThan(100_000);
});

test('the 3D view steps through the build, one step at a time', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-assembly-toggle').click();
    const steps = page.getByTestId('assembly-step');
    const second = (await steps.nth(1).innerText())
        .split('\n')[0]
        .replace(/^2\. /, '')
        .replace(/Show$/, '')
        .trim();
    await steps.nth(1).getByTestId('assembly-step-show').click();
    const bar = page.getByTestId('build-step-bar');
    await expect(bar.getByTestId('build-step-count')).toHaveText(`Step 2 of ${await steps.count()}`);
    await expect(bar.getByTestId('build-step-heading')).toHaveText(second);
    await page.getByTestId('build-step-prev').click();
    await expect(bar.getByTestId('build-step-count')).toHaveText(/^Step 1 of /);
    await page.getByTestId('build-step-done').click();
    await expect(bar).toHaveCount(0);
});

test('your own build steps replace the suggested order, and reset back', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-assembly-toggle').click();
    const steps = page.getByTestId('assembly-step');
    const suggested = await steps.count();
    await page.getByTestId('build-steps-edit').click();

    const editor = page.getByTestId('build-step-edit');
    await editor.first().getByTestId('build-step-heading-input').fill('Glue the base');
    await editor.first().getByTestId('build-step-heading-input').press('Enter');
    await editor.first().getByTestId('build-step-note-input').fill('Check it for square.');
    await editor.first().getByTestId('build-step-note-input').press('Enter');
    // The second step's parts join the first.
    await editor.nth(1).getByTestId('build-step-remove').click();
    await expect(editor).toHaveCount(suggested - 1);
    await page.getByTestId('build-steps-done').click();

    await expect(steps).toHaveCount(suggested - 1);
    await expect(steps.first()).toContainText('1. Glue the base');
    await expect(steps.first()).toContainText('Check it for square.');
    await expect(page.getByText('Your own order.')).toBeVisible();

    await page.getByTestId('build-steps-edit').click();
    await page.getByTestId('build-steps-reset').click();
    await expect(steps).toHaveCount(suggested);
    await expect(page.getByText('The order Woodshop suggests.')).toBeVisible();
});

test('the PDF plan gets a picture of each assembly step', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-assembly-toggle').click();
    await expect(page.getByTestId('assembly-step').first()).toBeVisible();
    const steps = await page.getByTestId('assembly-step').count();
    await page.getByTestId('cutlist-export-pdf').click();
    await expect(page.getByText('PDF plan saved.')).toBeVisible();
    const written = await page.evaluate(
        () => (window as unknown as { __written: Record<string, string> }).__written,
    );
    const plan = Object.entries(written).find(([path]) => path.endsWith('.pdf'))![1];
    expect(steps).toBeGreaterThan(0);
    expect(plan).toMatch(new RegExp(`with ${steps} step pictures$`));
});

test('Sizes labels each part with its cut size, each size once, never overlapping', async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Bookshelf', exact: true }) })
        .getByTestId('use-template')
        .click();
    await expect(page.getByTestId('parts-count')).toHaveText('8 parts');
    await page.getByTestId('view-sizes').click();
    const labels = page.getByTestId('size-label');
    await expect(labels.first()).toBeVisible();
    const texts = await labels.allInnerTexts();
    // The three shelves share one size, so it is said once.
    expect(texts.filter((t) => t === '30 1/2" × 10 1/2"')).toHaveLength(1);
    expect(new Set(texts).size).toBe(texts.length);
    await page.screenshot({
        path: '/private/tmp/claude-501/-Users-willardmacay-devlocal-woodshop-rust/8c9be911-f9e9-44ff-aebd-21bb86f32a8d/scratchpad/sizes.png',
    });

    // Turn the view a few ways: the labels never cover one another.
    for (const view of ['front', 'side', 'top', 'three-quarter']) {
        await page.getByTestId(`view-${view}`).click();
        await page.waitForTimeout(600);
        const boxes = await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const [a, b] = [boxes[i], boxes[j]];
                const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                expect(overlap, `${view}: labels ${i} and ${j} overlap`).toBe(false);
            }
        }
    }
    await page.getByTestId('view-sizes').click();
    await expect(labels).toHaveCount(0);
});

test('quick build makes a sound design from a few sizes', async ({ page }) => {
    await page.goto('/#/');
    await page.getByTestId('quick-build-open').click();
    const dialog = page.getByTestId('quick-build');
    await expect(page.getByTestId('quick-build-summary')).toHaveText('7 parts, from the front');
    await page.getByTestId('quick-build-shelves').fill('3');
    await expect(page.getByTestId('quick-build-summary')).toHaveText('8 parts, from the front');
    // Too big for a sheet: it says which panel, and will not make it.
    await page.getByTestId('quick-build-width').fill('96');
    await page.getByTestId('quick-build-height').fill('72');
    await expect(page.getByTestId('quick-build-problem')).toContainText('The back would be');
    await expect(page.getByTestId('quick-build-create')).toBeDisabled();

    await page.getByTestId('quick-build-kind').selectOption('table');
    await page.getByTestId('quick-build-name').fill('Hall table');
    await expect(page.getByTestId('quick-build-summary')).toHaveText('9 parts, from the front');
    await dialog.screenshot({
        path: '/private/tmp/claude-501/-Users-willardmacay-devlocal-woodshop-rust/8c9be911-f9e9-44ff-aebd-21bb86f32a8d/scratchpad/quickbuild.png',
    });
    await page.getByTestId('quick-build-create').click();
    await expect(page).toHaveURL(/#\/projects\/\d+$/);
    await expect(page.getByTestId('parts-count')).toHaveText('9 parts');
    await expect(page.getByTestId('lint-badge')).toContainText('Buildable');
});

test('the Drawing view shows the piece with its sizes, from each side', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('view-drawing').click();
    const svg = page.getByTestId('drawing-svg').locator('svg');
    await expect(svg).toHaveAttribute('data-view', 'front');
    // The overall height, and the openings above and below the middle shelf.
    await expect(svg.locator('text', { hasText: '34"' })).toHaveCount(1);
    await expect(svg.locator('[data-dimension="vertical"]')).toHaveCount(3);
    await page.getByTestId('drawing-side').click();
    await expect(svg).toHaveAttribute('data-view', 'side');
    await page.getByTestId('drawing-top').click();
    await expect(svg).toHaveAttribute('data-view', 'top');
    await page.getByTestId('drawing-close').click();
    await expect(page.getByTestId('drawing-overlay')).toHaveCount(0);
});

test('without a video encoder, the video dialog says so', async ({ page }) => {
    await page.addInitScript(() => {
        delete (window as unknown as { VideoEncoder?: unknown }).VideoEncoder;
    });
    await page.goto('/#/projects/1');
    await page.getByTestId('cutlist-toggle').click();
    await page.getByTestId('cutlist-export-video').click();
    await expect(page.getByTestId('video-unsupported')).toBeVisible();
    await expect(page.getByTestId('video-make')).toBeDisabled();
    await page.getByTestId('video-cancel').click();
    await expect(page.getByTestId('video-dialog')).toBeHidden();
});

test('an end is cut at an angle, and the form says the angle', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('outline').getByRole('button', { name: 'Top', exact: true }).click();
    const rows = page.getByTestId('section-cuts').getByTestId('ops-row');
    const before = await rows.count();

    await page.getByTestId('ops-add-menu').click();
    await page.getByTestId('ops-add-curve').click();
    await page.getByTestId('curve-kind').selectOption('taper');
    await page.getByTestId('curve-edge').selectOption('w1');
    await expect(page.getByTestId('taper-angle')).toContainText('the tangent of the angle');
    // The top is 19" deep: a corner moved in 5 1/2" across it is a cut 16.1° off square.
    await page.getByTestId('curve-size').fill('5 1/2');
    await expect(page.getByTestId('taper-angle')).toHaveText('Cuts 16.1° off square.');
    await page.getByTestId('curve-submit').click();
    await expect(rows).toHaveCount(before + 1);
    await expect(rows.last()).toContainText('The right end is cut at an angle, 5 1/2" shorter along the');
});

test('shelf-pin holes are added as one run, changed and removed', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('outline').getByRole('button', { name: 'Left Side', exact: true }).click();
    const rows = page.getByTestId('section-cuts').getByTestId('ops-row');
    const before = await rows.count();

    await page.getByTestId('ops-add-menu').click();
    await page.getByTestId('ops-add-pins').click();
    // A case side: drilled on the face looking in, up its height, on the 32 mm system.
    await expect(page.getByTestId('pins-axis')).toHaveValue('w');
    await expect(page.getByTestId('pins-spacing')).toHaveValue('32 mm');
    await page.getByTestId('pins-submit').click();
    await expect(rows).toHaveCount(before + 1);
    await expect(rows.last()).toContainText('Shelf-pin holes ×34');

    await page.getByTestId('pins-edit').click();
    await expect(page.getByTestId('pins-spacing')).toHaveValue('32 mm');
    await page.getByTestId('pins-spacing').fill('2');
    await page.getByTestId('pins-submit').click();
    await expect(rows.last()).toContainText('Shelf-pin holes ×22');

    await page.getByTestId('pins-delete').click();
    await expect(rows).toHaveCount(before);
    await page.getByTestId('undo').click();
    await expect(rows.last()).toContainText('Shelf-pin holes ×22');

    // The same rows for hinge plates and slides: only the column by the front edge.
    await page.getByTestId('ops-add-menu').click();
    await page.getByTestId('ops-add-pins').click();
    await page.getByTestId('pins-purpose').selectOption('hardware');
    await expect(page.getByTestId('pins-columns')).toHaveValue('low');
    await expect(page.getByTestId('pins-columns').locator('option:checked')).toContainText('(front)');
    await page.getByTestId('pins-submit').click();
    await expect(rows).toHaveCount(before + 2);
    await expect(rows.last()).toContainText('Hardware holes ×17');
});

test("a drawer's pull takes a finish, and the hardware list says so", async ({ page }) => {
    await page.goto('/#/templates');
    await page
        .getByTestId('template-card')
        .filter({ has: page.getByRole('heading', { name: 'Nightstand', exact: true }) })
        .getByTestId('use-template')
        .click();
    await page.getByTestId('outline').getByRole('button', { name: 'Drawer Front', exact: true }).click();
    await expect(page.getByTestId('movable-finish')).toHaveValue('');
    await page.getByTestId('movable-finish').selectOption('black');
    await page.getByTestId('cutlist-toggle').click();
    await expect(page.getByTestId('cutlist-hardware')).toContainText('matte black');
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('cutlist-hardware')).not.toContainText('matte black');
});

test('a mirrored copy of the left side is the right side', async ({ page }) => {
    await page.goto('/#/projects/1');
    const outline = page.getByTestId('outline');
    const right = outline.getByRole('button', { name: 'Right Side', exact: true });
    await right.click();
    await page.getByTestId('delete').click();
    await expect(right).toHaveCount(0);

    await outline.getByRole('button', { name: 'Left Side', exact: true }).click();
    await page.getByTestId('mirror-0').click();
    // Selected, named for its side, standing where the right side stood, turned the other way.
    await expect(right).toHaveCount(1);
    await expect(page.getByTestId('pos-input-0')).toHaveValue('18 5/8');
    await expect(page.getByTestId('rot-input-1')).toHaveValue('-90');
    await expect(page.getByTestId('lint-badge')).toContainText('Buildable');

    await page.getByTestId('undo').click();
    await expect(right).toHaveCount(0);
});

test('copies of a part are made in a row, then spaced evenly', async ({ page }) => {
    await page.goto('/#/projects/1');
    const outline = page.getByTestId('outline');
    await outline.getByRole('button', { name: 'Middle Shelf', exact: true }).click();
    await page.getByTestId('copies-toggle').click();
    await page.getByTestId('copies-count').fill('2');
    await page.getByTestId('copies-gap').fill('1');
    await page.getByTestId('copies-submit').click();
    await expect(page.getByTestId('parts-count')).toHaveText('8 parts');
    await expect(outline.getByRole('button', { name: 'Middle Shelf 3', exact: true })).toBeVisible();

    // Bottom, the three shelves and the top, spread evenly up and down.
    for (const name of ['Bottom', 'Middle Shelf', 'Middle Shelf 2', 'Middle Shelf 3', 'Top']) {
        await outline
            .getByRole('button', { name, exact: true })
            .click({ modifiers: name === 'Bottom' ? [] : ['Shift'] });
    }
    await expect(page.getByTestId('multi-panel')).toContainText('5 parts selected');
    await page.getByTestId('space-evenly-1').click();

    // Same stock throughout, so equal gaps means equal steps between the parts' heights.
    const inches = (t: string) =>
        t
            .trim()
            .split(/\s+/)
            .reduce(
                (sum, w) =>
                    sum + (w.includes('/') ? Number(w.split('/')[0]) / Number(w.split('/')[1]) : Number(w)),
                0,
            );
    const heights: number[] = [];
    for (const name of ['Bottom', 'Middle Shelf', 'Middle Shelf 2', 'Middle Shelf 3', 'Top']) {
        await outline.getByRole('button', { name, exact: true }).click();
        await page.getByTestId('inspector-tab').click();
        heights.push(inches(await page.getByTestId('pos-input-1').inputValue()));
    }
    heights.sort((a, b) => a - b);
    const steps = heights.slice(1).map((h, i) => h - heights[i]);
    for (const step of steps) expect(Math.abs(step - steps[0])).toBeLessThan(1 / 16 + 1e-6);

    // One undo puts the spacing back, another removes the copies.
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
});

test('banded edges add edge banding to the cut list', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('outline').getByRole('button', { name: 'Top', exact: true }).click();
    await page.getByTestId('inspector-tab').click();
    await page.getByTestId('edge-band-l1').click();
    await expect(page.getByTestId('edge-band-l1')).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('cutlist-toggle').click();
    const line = page.getByTestId('hardware-line').filter({ hasText: 'edge banding' });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('Feet of');

    await page.getByTestId('undo').click();
    await expect(page.getByTestId('hardware-line').filter({ hasText: 'edge banding' })).toHaveCount(0);
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
    await page.getByTestId('settings-group-library').click();
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

test('the design assistant is set up in Settings and answers in the editor', async ({ page }) => {
    await page.goto('/#/projects/1');
    await page.getByTestId('assistant-tab').click();
    // No key yet: the tab says where to set it up.
    await page.getByTestId('assistant-setup').getByRole('link').click();
    await expect(page).toHaveURL(/#\/settings$/);
    const settings = page.getByTestId('assistant-settings');
    await expect(settings.getByTestId('assistant-model')).toHaveValue('claude-opus-5-5');
    await expect(page.getByTestId('assistant-key-status')).toContainText('No key saved yet');
    await settings.getByTestId('assistant-key').fill('sk-ant-test');
    await settings.getByTestId('assistant-key-save').click();
    await expect(page.getByTestId('assistant-key-status')).toContainText('saved in your system keychain');
    // The key field empties: the key never comes back to the page.
    await expect(settings.getByTestId('assistant-key')).toHaveValue('');

    await page.goto('/#/projects/1');
    await page.getByTestId('assistant-tab').click();
    const panel = page.getByTestId('assistant-panel');
    await panel.getByTestId('assistant-input').fill('How many parts?');
    await panel.getByTestId('assistant-input').press('Enter');
    await expect(panel.getByTestId('assistant-message-you')).toHaveText('How many parts?');
    await expect(panel.getByTestId('assistant-message-assistant')).toContainText('has 6 parts');
    await expect(panel.getByTestId('assistant-actions')).toContainText('get design');

    // A message can take a picture of the 3D view along.
    await panel.getByTestId('assistant-view-toggle').click();
    await expect(panel.getByTestId('assistant-view-toggle')).toHaveAttribute('aria-pressed', 'true');
    await panel.getByTestId('assistant-input').fill('How does it look?');
    await panel.getByTestId('assistant-send').click();
    await expect(panel.getByTestId('assistant-message-you').last()).toContainText(
        'with a picture of the 3D view',
    );
    await expect(panel.getByTestId('assistant-message-assistant').last()).toContainText('I can see the view');
    await panel.getByTestId('assistant-view-toggle').click();

    // A long turn can be stopped.
    await panel.getByTestId('assistant-input').fill('wait for a long time');
    await panel.getByTestId('assistant-send').click();
    await panel.getByTestId('assistant-stop').click();
    await expect(panel.getByTestId('assistant-message-assistant').last()).toHaveText('Stopped.');
    await expect(panel.getByTestId('assistant-send')).toBeVisible();

    // The chat is still there after leaving the design and coming back.
    await page.goto('/#/');
    await page.goto('/#/projects/1');
    await page.getByTestId('assistant-tab').click();
    await expect(panel.getByTestId('assistant-message-you').first()).toHaveText('How many parts?');
    await expect(panel.getByTestId('assistant-message-assistant')).toHaveCount(3);
    // New chat forgets it for good.
    await panel.getByRole('button', { name: 'New chat' }).click();
    await expect(panel.getByTestId('assistant-message-you')).toHaveCount(0);
    await page.goto('/#/');
    await page.goto('/#/projects/1');
    await page.getByTestId('assistant-tab').click();
    await expect(panel).toContainText('Ask about this design');
    await expect(panel.getByTestId('assistant-message-you')).toHaveCount(0);
});

test('a change the assistant made is undone from its reply', async ({ page }) => {
    await page.goto('/#/settings');
    await page.getByTestId('settings-group-agents').click();
    await page.getByTestId('assistant-settings').getByTestId('assistant-key').fill('sk-ant-test');
    await page.getByTestId('assistant-settings').getByTestId('assistant-key-save').click();
    await expect(page.getByTestId('assistant-key-status')).toContainText('saved in your system keychain');
    await page.goto('/#/projects/1');
    const totals = page.getByTestId('cutlist-totals');
    const before = await totals.innerText();
    await page.getByTestId('assistant-tab').click();
    const panel = page.getByTestId('assistant-panel');
    await panel.getByTestId('assistant-input').fill('longer, please');
    await panel.getByTestId('assistant-input').press('Enter');
    await expect(panel.getByTestId('assistant-message-assistant')).toContainText('an inch longer');
    await page.getByTestId('cutlist-toggle').click();
    await expect.poll(() => totals.innerText()).not.toBe(before);

    await page.getByTestId('assistant-tab').click();
    await panel.getByTestId('assistant-undo').click();
    await expect(panel.getByTestId('assistant-undone')).toBeVisible();
    await expect(panel.getByTestId('assistant-undo')).toHaveCount(0);
    await page.getByTestId('cutlist-toggle').click();
    await expect.poll(() => totals.innerText()).toBe(before);
    // The restore is a version too, so the undo can itself be undone.
    await page.getByTestId('versions-toggle').click();
    await expect(page.getByTestId('version-row').first()).toContainText('Before restore');
});

test('a shopping list buys shared material once for several designs', async ({ page }) => {
    await page.goto('/#/');
    const cards = page.getByTestId('project-row');
    await cards.first().getByTestId('project-menu-toggle').click();
    await page.getByTestId('project-menu').getByRole('button', { name: 'Duplicate' }).click();
    await expect(cards).toHaveCount(2);

    await page.getByTestId('shopping-link').click();
    const list = page.getByTestId('shopping-list');
    await expect(list).toContainText('Pick one or more designs');
    const designs = page.getByTestId('shopping-design');
    await designs.nth(0).check();
    await expect(page.getByTestId('shopping-summary')).toHaveText(
        '1 design: 3 sheets, 22.9 board feet, about $285.00.',
    );
    await designs.nth(1).check();
    // Two record stands share the Baltic birch: fewer sheets than 3 + 3, the screws doubled.
    const summary = page.getByTestId('shopping-summary');
    await expect(summary).toContainText('2 designs:');
    await expect(summary).toContainText('45.7 board feet');
    const sheets = Number((await summary.innerText()).match(/(\d+) sheets/)![1]);
    expect(sheets).toBeLessThan(6);
    await expect(page.getByTestId('shopping-saving')).toContainText(`saves ${6 - sheets} sheet`);
    await expect(list.getByTestId('shopping-row').filter({ hasText: 'pocket screws' })).toContainText('24');
    // And the finish for both, a coat at a time.
    await expect(list.getByTestId('shopping-finish')).toHaveText(/^Finish\d+ sq ft, about [\d.]+ qt a coat$/);

    // The choice is remembered, and the list saves as CSV.
    await page.getByRole('link', { name: '← Your projects' }).click();
    await page.getByTestId('shopping-link').click();
    await expect(page.getByTestId('shopping-summary')).toContainText('2 designs:');
    await page.getByTestId('shopping-csv').click();
    await expect(page.getByText('Shopping list saved.')).toBeVisible();
    const csv = await page.evaluate(
        () =>
            (window as unknown as { __written: Record<string, string> }).__written[
                '/mock/exports/Shopping list.csv'
            ],
    );
    expect(csv).toContain(`Baltic Birch 18mm,${sheets},`);
    expect(csv).toMatch(/pocket screws",?24,/);
    expect(csv).toMatch(/\r\nFinish,,"\d+ sq ft, about [\d.]+ qt a coat",\r\n/);
});

test('pieces on hand are cut from before anything is bought', async ({ page }) => {
    await page.goto('/#/projects/1');
    const totals = page.getByTestId('cutlist-totals');
    await expect(totals).toContainText('$285.00');
    const onHand = page.getByTestId('on-hand');
    await expect(onHand.getByTestId('on-hand-piece')).toHaveCount(0);

    // A big piece of the Baltic birch left from another job: it takes the back panel and more.
    await onHand.getByTestId('on-hand-length').fill('60');
    await onHand.getByTestId('on-hand-width').fill('40');
    await onHand.getByTestId('on-hand-add').click();
    await expect(onHand.getByTestId('on-hand-piece')).toHaveText(/Baltic Birch 18mm, 60" × 40"\s*used here/);
    await expect(page.getByTestId('cutlist-on-hand-sheet')).toHaveCount(1);
    await expect(page.getByTestId('cutlist-on-hand-sheet')).toContainText('On hand, 60" × 40"');
    // One sheet fewer to buy, and its price off the estimate.
    await expect(totals).toContainText('$190.00');
    await expect(page.getByText('Baltic Birch 18mm: 2 sheets + 1 piece on hand')).toBeVisible();

    // A width is needed for sheet goods.
    await onHand.getByTestId('on-hand-length').fill('20');
    await expect(onHand.getByTestId('on-hand-add')).toBeDisabled();

    // Leftovers worth keeping are outlined on the layouts.
    await expect(page.getByTestId('cutlist-leftover').first()).toBeAttached();

    // After cutting: the used piece comes off the list and the leftovers go on it, for next time.
    const keep = onHand.getByTestId('on-hand-keep');
    const kept = Number((await keep.innerText()).match(/Keep the (\d+) leftovers/)![1]);
    expect(kept).toBeGreaterThan(0);
    await keep.click();
    await expect(onHand.getByTestId('on-hand-piece')).toHaveCount(kept);
    await expect(onHand.getByTestId('on-hand-piece').filter({ hasText: '60" × 40"' })).toHaveCount(0);
});

test('hardware takes prices from one price list, and the estimate and CSV include them', async ({ page }) => {
    await page.goto('/#/projects/1');
    await expect(page.getByTestId('cutlist-totals')).toContainText('$285.00');
    const hardware = page.getByTestId('cutlist-hardware');
    await hardware.getByTestId('hardware-prices-toggle').click();
    // The fasteners open so every line can be priced: pocket screws first.
    const price = hardware.getByTestId('hardware-price').first();
    await price.fill('0.10');
    await price.blur();
    await hardware.getByTestId('hardware-prices-toggle').click();
    await expect(hardware.getByTestId('hardware-cost').first()).toHaveText('$1.20'); // 12 screws
    // The price box shows the saved price when prices are opened again.
    await hardware.getByTestId('hardware-prices-toggle').click();
    await expect(hardware.getByTestId('hardware-price').first()).toHaveValue('0.1');
    await hardware.getByTestId('hardware-prices-toggle').click();
    await expect(page.getByTestId('cutlist-totals')).toContainText('$286.20');

    await page.getByTestId('cutlist-export-csv').click();
    await expect(page.getByText('Cut list saved.')).toBeVisible();
    const files = await page.evaluate(
        () => (window as unknown as { __written?: Record<string, string> }).__written ?? {},
    );
    const csv = Object.entries(files).find(([path]) => path.endsWith('.csv'))![1];
    expect(csv).toContain('Hardware,Qty,Price each,Cost');
    expect(csv).toMatch(/pocket screws",12,0\.10,1\.20/);
    expect(csv).toContain('Hardware total,,,1.20');
});
