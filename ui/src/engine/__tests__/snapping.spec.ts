import { describe, it, expect } from 'vitest';
import {
    computeSnap,
    clampAnchorToWorkspace,
    aabbFromPart,
    halfExtentsOf,
    type AABB,
    type Vec3,
} from '@/engine/snapping';
import { DEFAULT_SNAP_CONFIG, WORKSPACE_POS_BOUND } from '@/engine/config';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const cfg = DEFAULT_SNAP_CONFIG;

function box(min: [number, number, number], max: [number, number, number]): AABB {
    return { min, max };
}

describe('computeSnap — face-to-face', () => {
    it('snaps a near face flush against a neighbour', () => {
        // Other occupies x[1,2], y[0,1], z[0,1].
        const other = box([1, 0, 0], [2, 1, 1]);
        // Moving half-extents 0.5; candidate centre x=0.4 → moving x[-0.1,0.9], gap 0.1 to other.min.
        const result = computeSnap([0.4, 0.5, 0.5], [0.5, 0.5, 0.5], [other], cfg);
        expect(result.center[0]).toBeCloseTo(0.5); // max (1.0) flush to other.min (1.0)
        expect(result.snaps.some((s) => s.axis === 0 && s.kind === 'face')).toBe(true);
    });

    it('does not face-snap when the parts do not overlap perpendicular', () => {
        // Other is far away in z, so bringing x flush is not a real face contact.
        const other = box([1, 0, 50], [2, 1, 51]);
        const result = computeSnap([0.4, 0.5, 0.5], [0.5, 0.5, 0.5], [other], cfg);
        // Falls back to grid (1/8"): 0.4 → 0.375.
        expect(result.center[0]).toBeCloseTo(0.375);
        expect(result.snaps).toHaveLength(0);
    });

    it('ignores neighbours beyond the face threshold', () => {
        const other = box([1, 0, 0], [2, 1, 1]);
        // Candidate centre x=-1 → moving x[-1.5,-0.5], gap 1.5 > 0.5 threshold.
        const result = computeSnap([-1, 0.5, 0.5], [0.5, 0.5, 0.5], [other], cfg);
        expect(result.snaps.some((s) => s.kind === 'face')).toBe(false);
    });
});

describe('computeSnap — even-gap detent (faceGap)', () => {
    const gapCfg = { ...DEFAULT_SNAP_CONFIG, faceGap: 0.25 };

    it('holds the configured gap off a neighbour face instead of going flush', () => {
        const other = box([1, 0, 0], [2, 1, 1]);
        // Candidate centre x=0.3 → moving max 0.8. Gap detent wants max = other.min − 0.25 = 0.75
        // (Δ0.05); flush wants max = 1.0 (Δ0.2). The gap is the smaller move, so it wins.
        const result = computeSnap([0.3, 0.5, 0.5], [0.5, 0.5, 0.5], [other], gapCfg);
        expect(result.center[0]).toBeCloseTo(0.25, 6); // centre 0.25 → max 0.75, a 0.25" gap
        expect(result.snaps.some((s) => s.axis === 0 && s.kind === 'face')).toBe(true);
    });

    it('still snaps flush when the part is pushed close (both detents coexist)', () => {
        const other = box([1, 0, 0], [2, 1, 1]);
        // Candidate centre x=0.55 → moving max 1.05; flush Δ=−0.05, gap Δ=−0.30 → flush wins.
        const result = computeSnap([0.55, 0.5, 0.5], [0.5, 0.5, 0.5], [other], gapCfg);
        expect(result.center[0]).toBeCloseTo(0.5, 6); // flush: max 1.0
    });

    it('faceGap 0 reproduces the flush-only behaviour (regression guard)', () => {
        const other = box([1, 0, 0], [2, 1, 1]);
        const flush = computeSnap([0.4, 0.5, 0.5], [0.5, 0.5, 0.5], [other], DEFAULT_SNAP_CONFIG);
        expect(flush.center[0]).toBeCloseTo(0.5, 6);
        expect(DEFAULT_SNAP_CONFIG.faceGap).toBe(0);
    });
});

describe('computeSnap — alignment and grid', () => {
    it('aligns centres when faces are not in contact range', () => {
        // Other centre x=5; candidate centre x=5.1 (within alignThreshold 0.25), no perpendicular overlap needed.
        const other = box([4.5, 0, 0], [5.5, 1, 1]);
        const result = computeSnap([5.1, 5, 5], [0.5, 0.5, 0.5], [other], {
            ...cfg,
            faceSnap: false,
        });
        expect(result.center[0]).toBeCloseTo(5); // centre-aligned
        expect(result.snaps.some((s) => s.kind === 'align')).toBe(true);
    });

    it('snaps to the grid when nothing else is near', () => {
        const result = computeSnap([3.2, 0, 7.1], [1, 1, 1], [], cfg);
        expect(result.center[0]).toBeCloseTo(3.25); // nearest 1/8" to 3.2
        expect(result.center[2]).toBeCloseTo(7.125); // nearest 1/8" to 7.1
    });

    it('respects a disabled grid (no movement)', () => {
        const result = computeSnap([3.2, 0, 7.1], [1, 1, 1], [], { ...cfg, gridSnap: false });
        expect(result.center[0]).toBeCloseTo(3.2);
    });
});

describe('clampAnchorToWorkspace', () => {
    const zero: Vec3 = [0, 0, 0];

    it('leaves an in-bounds centre untouched', () => {
        expect(clampAnchorToWorkspace([10, 20, -30], zero, zero, 240)).toEqual([10, 20, -30]);
    });

    it('clamps a runaway centre to ±bound per axis', () => {
        // A near-horizon plane raycast can land the candidate hundreds of inches out.
        expect(clampAnchorToWorkspace([812, 0, -5000], zero, zero, 240)).toEqual([240, 0, -240]);
    });

    it('tightens the range so cohort members stay in bounds too', () => {
        // Member sits +30 in x of the anchor: anchor may go no higher than 210.
        // Member sits -12 in z of the anchor: anchor may go no lower than -228.
        const offsetMin: Vec3 = [0, 0, -12];
        const offsetMax: Vec3 = [30, 0, 0];
        const clamped = clampAnchorToWorkspace([239, 0, -239], offsetMin, offsetMax, 240);
        expect(clamped).toEqual([210, 0, -228]);
    });

    it('caps a grid snap that rounds past the boundary', () => {
        // Clamped candidate 239.97 grid-snaps (1/8") to 240.0 — allowed, but never beyond.
        const candidate = clampAnchorToWorkspace([239.97, 0, 0], zero, zero, WORKSPACE_POS_BOUND);
        const result = computeSnap(candidate, [1, 1, 1], [], cfg);
        const final = clampAnchorToWorkspace(result.center, zero, zero, WORKSPACE_POS_BOUND);
        expect(final[0]).toBeLessThanOrEqual(WORKSPACE_POS_BOUND);
        expect(final[0]).toBeCloseTo(240);
    });
});

describe('aabbFromPart', () => {
    it('accounts for rotation (record-stand side is rotated 90° about Y)', () => {
        const spec = parseSpec(recordStand);
        const side = spec.parts.find((p) => p.id === 'p_side_l')!;
        const material = spec.materials[0];
        const aabb = aabbFromPart(side, material.thickness);
        const half = halfExtentsOf(aabb);
        // Local l=19 (depth) maps to world Z after 90° Y-rotation; thickness maps to X.
        expect(half[2]).toBeCloseTo(19 / 2); // Z half ≈ 9.5
        expect(half[0]).toBeCloseTo(material.thickness / 2); // X half ≈ 0.3545
        expect(half[1]).toBeCloseTo(34 / 2); // Y (height) unchanged
    });
});
