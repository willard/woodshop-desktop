import { describe, it, expect } from 'vitest';
import { DARK_SCENE, LIGHT_SCENE, scenePalette, type ScenePalette } from '../theme';
import { SPECIES_TONES } from '../materials';

/** Perceived lightness of a packed 0xRRGGBB, for the ordering assertions below. */
function luminance(hex: number): number {
    const channels = [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff].map((c) => c / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('scene palettes', () => {
    it('maps theme names onto palettes', () => {
        expect(scenePalette('dark')).toBe(DARK_SCENE);
        expect(scenePalette('light')).toBe(LIGHT_SCENE);
    });

    it('defines the same keys in both themes', () => {
        expect(Object.keys(LIGHT_SCENE).sort()).toEqual(Object.keys(DARK_SCENE).sort());
        expect(Object.keys(LIGHT_SCENE.lighting).sort()).toEqual(Object.keys(DARK_SCENE.lighting).sort());
    });

    it('actually inverts the ground', () => {
        expect(luminance(LIGHT_SCENE.background)).toBeGreaterThan(luminance(DARK_SCENE.background));
    });

    it('keeps the light viewport off pure white', () => {
        // Pure white flattens pine and maple into the background and is its own glare source.
        expect(luminance(LIGHT_SCENE.background)).toBeLessThan(luminance(0xffffff) * 0.85);
    });

    it.each([
        ['dark', DARK_SCENE],
        ['light', LIGHT_SCENE],
    ] as [string, ScenePalette][])('keeps the %s grid visible but behind the parts', (_n, p) => {
        // The grid must separate from the ground it is drawn on, and the major lines must read
        // stronger than the minor ones, in the same direction as the background.
        const ground = luminance(p.background);
        expect(Math.abs(luminance(p.gridMajor) - ground)).toBeGreaterThan(0.01);
        const majorGap = Math.abs(luminance(p.gridMajor) - ground);
        const minorGap = Math.abs(luminance(p.gridMinor) - ground);
        expect(majorGap).toBeGreaterThan(minorGap);
    });

    it.each([
        ['dark', DARK_SCENE],
        ['light', LIGHT_SCENE],
    ] as [string, ScenePalette][])('separates %s overlays from the ground', (_n, p) => {
        const ground = luminance(p.background);
        for (const key of ['selection', 'ghost', 'snap', 'dimensionSize', 'dimensionPoint'] as const) {
            expect(Math.abs(luminance(p[key]) - ground)).toBeGreaterThan(0.03);
        }
    });

    it.each([
        ['dark', DARK_SCENE],
        ['light', LIGHT_SCENE],
    ] as [string, ScenePalette][])(
        'gives the %s selection outline 3:1 against every species and the ground',
        (_n, p) => {
            // The point of the two-tone outline: no single colour clears 3:1 against both maple
            // and walnut, which span nearly the whole luminance range. For each surface, at least
            // one of core/casing must separate — that is what makes selection legible on any part.
            const surfaces = [...Object.values(SPECIES_TONES), p.background];
            for (const surface of surfaces) {
                const best = Math.max(
                    contrast(p.selectionCore, surface),
                    contrast(p.selectionCasing, surface),
                );
                expect(best, `surface 0x${surface.toString(16)}`).toBeGreaterThanOrEqual(3);
            }
        },
    );

    it('keeps the two outline tones far apart, so the casing reads against the core', () => {
        for (const p of [DARK_SCENE, LIGHT_SCENE]) {
            expect(contrast(p.selectionCore, p.selectionCasing)).toBeGreaterThanOrEqual(3);
        }
    });

    it('keeps every wood species distinguishable from the light ground', () => {
        // The reason the light viewport is warm grey rather than white (D74): wood has to stay
        // the brightest thing on screen, the way it is in the dark theme.
        const ground = luminance(LIGHT_SCENE.background);
        for (const [species, tone] of Object.entries(SPECIES_TONES)) {
            expect(Math.abs(luminance(tone) - ground), species).toBeGreaterThan(0.03);
        }
    });
});
