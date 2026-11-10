/**
 * Arrow-key nudging — moving a selection by an exact amount without a mouse.
 *
 * Pure math, no three.js: given where the camera is looking, decide which world axis each arrow
 * moves along and by how much. The Vue layer feeds in the camera's forward vector and turns the
 * result into a `MoveParts` command (hard rule 4 — no direct spec writes).
 *
 * Arrows are camera-relative but land on world axes. A woodworking assembly is axis-aligned, so
 * moving a part diagonally because the camera happens to sit at 37° is never what was meant;
 * snapping to the nearest axis keeps "left" feeling like left after an orbit while every nudge
 * stays square to the build. World is y-up (§3.1).
 */
import type { Vec3 } from './snapping';
import { DEFAULT_NUDGE_CONFIG, type NudgeConfig } from './config';

/** Normalises −0 to 0 — signed zero is invisible in arithmetic but ugly in a stored position. */
const z0 = (n: number): number => (n === 0 ? 0 : n);

/** Which way a key moves the selection, in the viewer's terms. */
export type NudgeDirection = 'left' | 'right' | 'forward' | 'back' | 'up' | 'down';

/** How big a step: the grid, a coarse multiple of it, or the fine step. */
export type NudgeStep = 'grid' | 'coarse' | 'fine';

/** The two ground-plane axes that best match the camera's own right and forward. */
export interface ScreenAxes {
    right: Vec3;
    forward: Vec3;
}

/** Ground-plane world axis nearest the camera's forward, plus the right that goes with it. */
export function screenAxes(cameraForward: Vec3): ScreenAxes {
    const [fx, , fz] = cameraForward;
    // Looking straight down the Y axis leaves nothing to project; fall back to −Z, the direction
    // the camera starts in, so the keys keep working instead of freezing at the top of an orbit.
    const degenerate = Math.abs(fx) < 1e-6 && Math.abs(fz) < 1e-6;
    const forward: Vec3 = degenerate
        ? [0, 0, -1]
        : Math.abs(fx) >= Math.abs(fz)
          ? [Math.sign(fx), 0, 0]
          : [0, 0, Math.sign(fz)];

    // right = forward × up, with up = +Y.
    return { right: [z0(-forward[2]), 0, z0(forward[0])], forward };
}

/** Inches per press. `grid` follows the editor's snap grid so nudging and dragging agree. */
export function nudgeStep(
    step: NudgeStep,
    gridSize: number,
    config: NudgeConfig = DEFAULT_NUDGE_CONFIG,
): number {
    if (step === 'fine') {
        return config.fineStep;
    }
    // A grid of 0 means grid snap is off; nudging still needs a sane amount to move by.
    const base = gridSize > 0 ? gridSize : config.fallbackStep;

    return step === 'coarse' ? base * config.coarseMultiplier : base;
}

/**
 * The world-space translation one key press should apply. Up/down are world Y — the height of a
 * shelf is not a camera-relative idea — while the four horizontal arrows ride the snapped
 * ground-plane axes.
 */
export function nudgeDelta(direction: NudgeDirection, axes: ScreenAxes, distance: number): Vec3 {
    const scale = (v: Vec3, k: number): Vec3 => [z0(v[0] * k), z0(v[1] * k), z0(v[2] * k)];

    switch (direction) {
        case 'left':
            return scale(axes.right, -distance);
        case 'right':
            return scale(axes.right, distance);
        case 'forward':
            return scale(axes.forward, distance);
        case 'back':
            return scale(axes.forward, -distance);
        case 'up':
            return [0, distance, 0];
        case 'down':
            return [0, -distance, 0];
    }
}

/**
 * Shrinks a nudge so no part leaves the workspace. `transform.pos` is capped at ±240 by the
 * schema (WORKSPACE_POS_BOUND), and a command that would breach it throws on validation — the
 * same reason drags clamp. Returns the largest fraction of the delta that still fits, so a
 * selection already against the wall simply stops instead of failing.
 */
export function clampToWorkspace(
    delta: Vec3,
    positions: readonly (readonly number[])[],
    bound: number,
): Vec3 {
    let scale = 1;
    for (const pos of positions) {
        for (let axis = 0; axis < 3; axis += 1) {
            const step = delta[axis];
            if (step === 0) {
                continue;
            }
            const limit = step > 0 ? bound - pos[axis] : -bound - pos[axis];
            const allowed = limit / step;
            if (allowed < scale) {
                scale = Math.max(0, allowed);
            }
        }
    }

    return scale >= 1 ? delta : [z0(delta[0] * scale), z0(delta[1] * scale), z0(delta[2] * scale)];
}
