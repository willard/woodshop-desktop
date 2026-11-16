import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Text colours against every surface, in both themes, read from the CSS itself: WCAG AA asks
 * 4.5:1 for normal-size text. `faint` carries real text (card details, hints), so it is held to
 * the same bar as `muted`.
 */
const css = readFileSync(resolve(process.cwd(), 'ui/src/app.css'), 'utf8');

function tokens(block: string): Record<string, string> {
    return Object.fromEntries(
        [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
    );
}

function block(selector: string): Record<string, string> {
    const start = css.indexOf(selector);
    expect(start, selector).toBeGreaterThan(-1);
    return tokens(css.slice(start, css.indexOf('}', start)));
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function luminance(c: number[]): number {
    const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: number[], b: number[]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
const over = (fg: number[], bg: number[], alpha: number) => fg.map((f, i) => f * alpha + bg[i] * (1 - alpha));

const themes = {
    dark: block(':root {'),
    light: block(":root[data-theme='light'] {"),
};

describe.each(Object.entries(themes))('%s theme text contrast', (_name, t) => {
    const surfaces = ['surface-0', 'surface-1', 'surface-2', 'surface-3'];

    it.each(['fg-strong', 'muted', 'faint', 'accent'])('%s clears AA on every surface', (tone) => {
        for (const surface of surfaces) {
            expect(contrast(rgb(t[tone]), rgb(t[surface])), `${tone} on ${surface}`).toBeGreaterThanOrEqual(
                4.5,
            );
        }
    });

    it('the lightest alpha text the UI uses (fg/65) clears AA too', () => {
        for (const surface of surfaces) {
            const text = over(rgb(t.fg), rgb(t[surface]), 0.65);
            expect(contrast(text, rgb(t[surface])), surface).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps muted the stronger of the two secondary tones', () => {
        for (const surface of surfaces) {
            expect(contrast(rgb(t.muted), rgb(t[surface]))).toBeGreaterThan(
                contrast(rgb(t.faint), rgb(t[surface])),
            );
        }
    });
});

it('the system light theme matches the chosen light theme', () => {
    const system = block(":root:not([data-theme='dark']) {");
    expect(system).toEqual(themes.light);
});
