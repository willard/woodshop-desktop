import { describe, it, expect } from 'vitest';
import { screenAxes, nudgeStep, nudgeDelta, clampToWorkspace } from '@/engine/nudge';
import { DEFAULT_NUDGE_CONFIG } from '@/engine/config';
import type { Vec3 } from '@/engine/snapping';

describe('screenAxes — arrows follow the camera but land on world axes', () => {
    it('matches the default view: looking down −Z puts right at +X', () => {
        const axes = screenAxes([0, -0.3, -1]);
        expect(axes.forward).toEqual([0, 0, -1]);
        expect(axes.right).toEqual([1, 0, 0]);
    });

    it('swaps the axes once the camera has orbited a quarter turn', () => {
        const axes = screenAxes([1, -0.2, 0]);
        expect(axes.forward).toEqual([1, 0, 0]);
        expect(axes.right).toEqual([0, 0, 1]);
    });

    it('flips with the camera, so "left" stays left from behind', () => {
        expect(screenAxes([0, 0, -1]).right).toEqual([1, 0, 0]);
        expect(screenAxes([0, 0, 1]).right).toEqual([-1, 0, 0]);
    });

    it('snaps a diagonal camera to the axis it is closest to — never a diagonal move', () => {
        // 40° off the Z axis: still mostly looking down −Z.
        const axes = screenAxes([-0.64, 0, -0.77]);
        expect(axes.forward).toEqual([0, 0, -1]);
        // Just past 45° it commits to the other axis instead.
        expect(screenAxes([-0.77, 0, -0.64]).forward).toEqual([-1, 0, 0]);
    });

    it('falls back to −Z looking straight down, instead of freezing', () => {
        expect(screenAxes([0, -1, 0]).forward).toEqual([0, 0, -1]);
    });

    it('always returns perpendicular unit axes', () => {
        for (const forward of [
            [0, 0, -1],
            [0, 0, 1],
            [1, 0, 0],
            [-1, 0, 0],
        ] as Vec3[]) {
            const axes = screenAxes(forward);
            const dot =
                axes.right[0] * axes.forward[0] +
                axes.right[1] * axes.forward[1] +
                axes.right[2] * axes.forward[2];
            expect(dot).toBe(0);
            expect(Math.hypot(...axes.right)).toBe(1);
        }
    });
});

describe('nudgeStep', () => {
    it('steps by the editor grid so nudging and dragging agree', () => {
        expect(nudgeStep('grid', 0.125)).toBe(0.125);
    });

    it('takes a coarse step of eight grid cells — 1" on the default grid', () => {
        expect(nudgeStep('coarse', 0.125)).toBe(1);
    });

    it('takes a fine step of 1/64" regardless of the grid', () => {
        expect(nudgeStep('fine', 0.25)).toBe(DEFAULT_NUDGE_CONFIG.fineStep);
    });

    it('still moves a sane amount when grid snap is switched off', () => {
        expect(nudgeStep('grid', 0)).toBe(DEFAULT_NUDGE_CONFIG.fallbackStep);
    });
});

describe('nudgeDelta', () => {
    const axes = screenAxes([0, 0, -1]);

    it('moves along the screen axes for the four arrows', () => {
        expect(nudgeDelta('right', axes, 0.125)).toEqual([0.125, 0, 0]);
        expect(nudgeDelta('left', axes, 0.125)).toEqual([-0.125, 0, 0]);
        expect(nudgeDelta('forward', axes, 0.125)).toEqual([0, 0, -0.125]);
        expect(nudgeDelta('back', axes, 0.125)).toEqual([0, 0, 0.125]);
    });

    it('keeps height on the world Y axis — a shelf height is not camera-relative', () => {
        const orbited = screenAxes([1, 0, 0]);
        expect(nudgeDelta('up', orbited, 0.5)).toEqual([0, 0.5, 0]);
        expect(nudgeDelta('down', orbited, 0.5)).toEqual([0, -0.5, 0]);
    });
});

describe('clampToWorkspace', () => {
    it('passes a nudge through untouched when everything stays in bounds', () => {
        const delta: Vec3 = [0.125, 0, 0];
        expect(clampToWorkspace(delta, [[0, 0, 0]], 240)).toBe(delta);
    });

    it('stops dead at the wall instead of failing validation', () => {
        expect(clampToWorkspace([0.125, 0, 0], [[240, 0, 0]], 240)).toEqual([0, 0, 0]);
        expect(clampToWorkspace([0, -0.125, 0], [[0, -240, 0]], 240)).toEqual([0, 0, 0]);
    });

    it('shortens the step to exactly the distance left', () => {
        expect(clampToWorkspace([1, 0, 0], [[239.5, 0, 0]], 240)).toEqual([0.5, 0, 0]);
    });

    it('holds the whole selection together — the nearest part sets the limit', () => {
        // Moving both would push the second past the bound, so both stop short by the same amount.
        const clamped = clampToWorkspace(
            [1, 0, 0],
            [
                [0, 0, 0],
                [239.75, 0, 0],
            ],
            240,
        );
        expect(clamped).toEqual([0.25, 0, 0]);
    });

    it('lets a part at the wall move away from it', () => {
        expect(clampToWorkspace([-1, 0, 0], [[240, 0, 0]], 240)).toEqual([-1, 0, 0]);
    });
});
