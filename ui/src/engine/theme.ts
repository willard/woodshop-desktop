/**
 * Scene palette (D74). The engine is framework-agnostic and has no business reading CSS custom
 * properties off `documentElement`, so the two themes live here as data and the Vue layer hands
 * the engine whichever one is active.
 *
 * Wood tones are deliberately absent: they belong to `materials.ts` and do not change with the
 * theme — wood does not change colour when the lights come on.
 */

/** Every non-wood colour the scene draws, so a theme flip is one object swap. */
export interface ScenePalette {
    /** Canvas clear colour behind the model. */
    background: number;
    /** Ground grid: the every-foot line, then the every-inch line. */
    gridMajor: number;
    gridMinor: number;
    /** Emissive tint on a selected part, and its bounding-box helper for AI highlights. */
    selection: number;
    /**
     * Selection outline, drawn as a two-tone pair (D75). One colour cannot clear 3:1 against
     * both maple and walnut — the species span nearly the whole luminance range — so the outline
     * is a near-white core inside a near-black casing. Whichever wood or ground sits behind it,
     * one of the two always separates; the worst case across every species is 4.36:1.
     */
    selectionCore: number;
    selectionCasing: number;
    /** Drag ghost while unsnapped, and the gap dimension line. */
    ghost: number;
    /** Drag ghost once snapped, the snap guide lines, and the op placement ghost. */
    snap: number;
    /** Dimension lines: overall size, and a freeform point-to-point measurement. */
    dimensionSize: number;
    dimensionPoint: number;
    lighting: {
        /** Hemisphere sky/ground bounce, then its intensity. */
        hemiSky: number;
        hemiGround: number;
        hemiIntensity: number;
        keyColor: number;
        keyIntensity: number;
        fillColor: number;
        fillIntensity: number;
    };
}

export const DARK_SCENE: ScenePalette = {
    background: 0x1c1917,
    gridMajor: 0x5a4a38,
    gridMinor: 0x352b20,
    selection: 0xf59e0b,
    selectionCore: 0xffe6b0,
    selectionCasing: 0x140d02,
    ghost: 0xf59e0b,
    snap: 0x34d399,
    dimensionSize: 0x94a3b8,
    dimensionPoint: 0x38bdf8,
    lighting: {
        hemiSky: 0xfff2df,
        hemiGround: 0x2a2118,
        hemiIntensity: 0.85,
        keyColor: 0xffd9a0,
        keyIntensity: 1.15,
        fillColor: 0x9fb4d6,
        fillIntensity: 0.35,
    },
};

/**
 * Warm grey, not white: pure white flattens pine and maple — the two species rendered most —
 * into the background, and is its own glare source. Keeping the ground a little darker than the
 * surrounding panels preserves the dark theme's figure/ground relationship, where wood is the
 * brightest thing on screen. The accent and snap colours darken to hold contrast against it.
 */
export const LIGHT_SCENE: ScenePalette = {
    background: 0xe9e5dc,
    gridMajor: 0xa89e8c,
    gridMinor: 0xc9c1b2,
    selection: 0xb4631a,
    selectionCore: 0xffe6b0,
    selectionCasing: 0x140d02,
    ghost: 0xb4631a,
    snap: 0x0f9b6c,
    dimensionSize: 0x5b6672,
    dimensionPoint: 0x0369a1,
    lighting: {
        // A bright room bounces: the ground term lifts so undersides do not read as holes, and
        // the key eases off so a light top face does not clip to flat white.
        hemiSky: 0xffffff,
        hemiGround: 0xcfc6b4,
        hemiIntensity: 1.05,
        keyColor: 0xfff1d8,
        keyIntensity: 0.9,
        fillColor: 0xc6d2e4,
        fillIntensity: 0.45,
    },
};

/** Theme name as stored and as stamped onto `<html data-theme>`. */
export type ThemeName = 'dark' | 'light';

export function scenePalette(theme: ThemeName): ScenePalette {
    return theme === 'light' ? LIGHT_SCENE : DARK_SCENE;
}
