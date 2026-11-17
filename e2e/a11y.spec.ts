import { expect, test, type Page } from '@playwright/test';
import { CALCULATORS as calculators } from '../ui/src/calc/registry';

/**
 * Accessibility floor for every screen: each control has a name a screen reader can say, each
 * field has a label, and keyboard focus is visible. Not a full audit — the checks that catch the
 * mistakes this codebase actually makes (an icon button without aria-label, an input with only a
 * visual label beside it).
 */

const CONTROLS = [
    'button',
    'a[href]',
    'input:not([type=hidden])',
    'select',
    'textarea',
    '[role=button]',
    '[role=radio]',
    '[role=tab]',
    '[role=menuitem]',
    '[role=checkbox]',
    '[role=switch]',
].join(',');

/** Visible controls with no accessible name, as short descriptions. */
async function unnamed(page: Page): Promise<string[]> {
    return page.evaluate((selector) => {
        const visible = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const nameOf = (el: Element): string => {
            const labelledBy = el.getAttribute('aria-labelledby');
            if (labelledBy) {
                const t = labelledBy
                    .split(/\s+/)
                    .map((id) => text(document.getElementById(id)))
                    .join(' ')
                    .trim();
                if (t) return t;
            }
            const aria = el.getAttribute('aria-label')?.trim();
            if (aria) return aria;
            if (
                el instanceof HTMLInputElement ||
                el instanceof HTMLSelectElement ||
                el instanceof HTMLTextAreaElement
            ) {
                if (el.labels && el.labels.length > 0) {
                    const t = [...el.labels].map(text).join(' ').trim();
                    if (t) return t;
                }
                if (
                    el instanceof HTMLInputElement &&
                    ['button', 'submit', 'reset'].includes(el.type) &&
                    el.value
                ) {
                    return el.value;
                }
            } else {
                const t = text(el);
                if (t) return t;
                const alt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim();
                if (alt) return alt;
            }
            return el.getAttribute('title')?.trim() ?? '';
        };
        const out: string[] = [];
        for (const el of document.querySelectorAll(selector)) {
            if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
            if (nameOf(el)) continue;
            const id = el.getAttribute('data-testid') ?? el.id;
            const cls = (el.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.');
            out.push(`<${el.tagName.toLowerCase()}${id ? ` ${id}` : ''}${cls ? ` .${cls}` : ''}>`);
        }
        return out;
    }, CONTROLS);
}

const CALCULATORS = calculators.map((c) => c.id);

async function expectAllNamed(page: Page, where: string): Promise<void> {
    expect.soft(await unnamed(page), `unnamed controls on ${where}`).toEqual([]);
}

test('every control on every page has a name', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByTestId('project-row').first()).toBeVisible();
    await expectAllNamed(page, 'projects');
    await page
        .getByRole('button', { name: /^Actions for / })
        .first()
        .click();
    await expectAllNamed(page, 'project menu');
    await page.keyboard.press('Escape');

    await page.goto('/?empty#/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expectAllNamed(page, 'welcome');

    await page.goto('/#/templates');
    await expect(page.getByTestId('template-card').first()).toBeVisible();
    await expectAllNamed(page, 'templates');

    await page.goto('/#/tools');
    await expect(page.getByTestId('tools-page')).toBeVisible();
    await expectAllNamed(page, 'tools');
    for (const slug of CALCULATORS) {
        await page.goto(`/#/tools/${slug}`);
        await expect(page.getByTestId('tools-page').locator('h1')).toBeVisible();
        await expectAllNamed(page, `calculator ${slug}`);
    }

    await page.goto('/#/shopping');
    await page.getByTestId('shopping-design').first().check();
    await expect(page.getByTestId('shopping-summary')).toBeVisible();
    await expectAllNamed(page, 'shopping list');

    await page.goto('/#/help');
    await expectAllNamed(page, 'help');

    await page.goto('/#/settings');
    for (const group of ['general', 'library', 'agents', 'updates', 'diagnostics', 'about']) {
        await page.getByTestId(`settings-group-${group}`).click();
        await expectAllNamed(page, `settings, ${group}`);
    }
});

test('every control in the editor has a name', async ({ page }) => {
    await page.goto('/#/projects/1');
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
    await expectAllNamed(page, 'editor, cut list');

    await expectAllNamed(page, 'editor, parts list');
    await page
        .getByTestId('outline-row')
        .filter({ hasText: 'Top' })
        .getByRole('button', { name: 'Top', exact: true })
        .click();
    await page.getByTestId('inspector-tab').click();
    await expectAllNamed(page, 'editor, inspector');
    await page.getByTestId('ops-add-menu').click();
    await expectAllNamed(page, 'editor, add a cut menu');
    await page.keyboard.press('Escape');

    await page.getByTestId('notes-tab').click();
    await expectAllNamed(page, 'editor, notes');

    await page.getByTestId('versions-toggle').click();
    await expectAllNamed(page, 'editor, versions');
    await page.getByTestId('versions-toggle').click();

    await page.getByTestId('add-menu-toggle').click();
    await expectAllNamed(page, 'editor, add menu');
    await page.keyboard.press('Escape');

    await page.getByTestId('toolbar-overflow-toggle').click();
    await expectAllNamed(page, 'editor, more menu');
    await page.keyboard.press('Escape');

    await page.getByTestId('shortcuts-toggle').click();
    await expectAllNamed(page, 'editor, shortcuts');
});

/** Tabs `stops` times and lists every stop that draws no outline, ring or border change. */
async function unseenFocus(page: Page, stops: number): Promise<string[]> {
    const missing: string[] = [];
    for (let i = 0; i < stops; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (el === null || el === document.body) return null;
            const s = getComputedStyle(el);
            const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
            const ring = s.boxShadow !== 'none';
            // A text field shows focus by turning its border the accent colour.
            let border = false;
            if (el.matches('input, textarea, select')) {
                const focused = s.borderColor;
                el.blur();
                border = getComputedStyle(el).borderColor !== focused;
                el.focus();
            }
            return {
                shown: outline || ring || border,
                what: `${el.tagName.toLowerCase()} ${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''} outline=${s.outlineStyle}/${s.outlineWidth}`,
            };
        });
        if (info !== null && !info.shown) missing.push(String(info.what));
    }
    return missing;
}

test('keyboard focus is visible', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByTestId('project-row').first()).toBeVisible();
    expect.soft(await unseenFocus(page, 14), 'projects: focus stops with no visible focus').toEqual([]);

    await page.goto('/#/projects/1');
    await expect(page.getByTestId('parts-count')).toHaveText('6 parts');
    expect.soft(await unseenFocus(page, 60), 'editor: focus stops with no visible focus').toEqual([]);
});
