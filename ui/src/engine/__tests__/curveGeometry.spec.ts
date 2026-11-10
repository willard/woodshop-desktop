import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFaceOutline, buildPartGeometry } from '@/engine/geometry/partGeometry';
import { makePart } from '@/engine/commands';
import type { Op, Part } from '@/spec/types';

const T = 0.75;

function curvedPart(ops: Op[], l = 20, w = 36): Part {
    return { ...makePart({ id: 'p_side', name: 'Side', materialId: 'mat_x', size: { l, w } }), ops };
}

function outlinePoints(shape: THREE.Shape, divisions = 256): THREE.Vector2[] {
    return shape.getPoints(divisions);
}

function bbox(geometry: THREE.BufferGeometry): THREE.Box3 {
    geometry.computeBoundingBox();
    return geometry.boundingBox!;
}

describe('buildFaceOutline — arc (§3.1 curve, spec 1.4)', () => {
    // Headboard side board: dome the top edge (l1 at y = +w/2), corners drop by the sagitta.
    const arc: Op = { type: 'curve', edge: 'l1', kind: 'arc', height: 4 };

    it('keeps the edge midpoint and drops the corners by the sagitta', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [arc]));
        const maxY = Math.max(...points.map((p) => p.y));
        expect(maxY).toBeCloseTo(18, 3); // midpoint of l1 stays at +w/2

        // The arc's endpoints sit exactly sagitta below the edge (sampled points nearby
        // ride the arc slightly higher — the slope is steep at the corner).
        const corner = points.find((p) => Math.abs(p.x - -10) < 1e-6 && p.y > 0);
        expect(corner).toBeDefined();
        expect(corner!.y).toBeCloseTo(18 - 4, 3);
    });

    it('is symmetric about the edge midline', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [arc]));
        const at = (x: number): number =>
            Math.max(...points.filter((p) => Math.abs(p.x - x) < 0.3).map((p) => p.y));
        expect(at(-6)).toBeCloseTo(at(6), 1);
    });

    it('never bulges outside the blank rectangle', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [arc]));
        for (const p of points) {
            expect(p.x).toBeGreaterThanOrEqual(-10 - 1e-6);
            expect(p.x).toBeLessThanOrEqual(10 + 1e-6);
            expect(p.y).toBeLessThanOrEqual(18 + 1e-6);
            expect(p.y).toBeGreaterThanOrEqual(-18 - 1e-6);
        }
    });

    it('handles every edge, not just l1', () => {
        for (const edge of ['l0', 'w0', 'w1'] as const) {
            const shape = buildFaceOutline(20, 36, [{ type: 'curve', edge, kind: 'arc', height: 3 }]);
            expect(outlinePoints(shape).length).toBeGreaterThan(10);
        }
    });
});

describe('buildFaceOutline — corner round', () => {
    const round: Op = { type: 'curve', edge: 'l1', kind: 'round', radius: 5 };

    it('keeps the edge flat between the rounded corners', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [round]));
        // The straight top segment runs between the two tangency points (±5, 18).
        expect(points.some((p) => Math.abs(p.x - 5) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
        expect(points.some((p) => Math.abs(p.x + 5) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
        expect(Math.max(...points.map((p) => p.y))).toBeLessThanOrEqual(18 + 1e-6);
    });

    it('pulls the corners in along a quarter circle', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [round]));
        // The exact corner (10, 18) is cut away.
        const nearCorner = points.filter((p) => p.x > 9.9 && p.y > 17.9);
        expect(nearCorner).toHaveLength(0);
        // The 45° point of the rounding arc lies on the circle centred at (5, 13).
        const c = { x: 10 - 5, y: 18 - 5 };
        const on45 = points.find((p) => Math.abs(p.x - (c.x + 5 * Math.SQRT1_2)) < 0.2 && p.y > c.y);
        expect(on45).toBeDefined();
        if (on45 !== undefined) {
            expect(Math.hypot(on45.x - c.x, on45.y - c.y)).toBeCloseTo(5, 1);
        }
    });
});

describe('buildFaceOutline — single-corner round (spec 1.5)', () => {
    // Round only the corner l1 shares with w1 — the right end of the top edge.
    const oneCorner: Op = { type: 'curve', edge: 'l1', kind: 'round', radius: 5, corner: 'w1' };

    it('rounds the named corner and leaves the other square', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [oneCorner]));
        // Right-top corner (10, 18) is cut away…
        expect(points.filter((p) => p.x > 9.9 && p.y > 17.9)).toHaveLength(0);
        // …while the left-top corner survives exactly.
        expect(points.some((p) => Math.abs(p.x + 10) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
    });

    it('keeps the flat top running from the tangency point to the square corner', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [oneCorner]));
        expect(points.some((p) => Math.abs(p.x - 5) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
        expect(Math.max(...points.map((p) => p.y))).toBeLessThanOrEqual(18 + 1e-6);
    });
});

describe('buildFaceOutline — ramp (spec 1.5)', () => {
    // Headboard one-sided sweep: top edge stays full height on the left (w0 side) and
    // drops 8" toward the right (low = w1).
    const ramp: Op = { type: 'curve', edge: 'l1', kind: 'ramp', height: 8, low: 'w1' };

    it('keeps the high corner and drops the low corner by the height', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [ramp]));
        expect(points.some((p) => Math.abs(p.x + 10) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
        expect(points.some((p) => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.y - 10) < 1e-3)).toBe(true);
        expect(points.filter((p) => p.x > 9.9 && p.y > 17.9)).toHaveLength(0);
    });

    it('leaves the high corner tangent to the original edge (flat start)', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [ramp]));
        // r = (chord² + h²) / 2h = (400 + 64) / 16 = 29 → at 1/2" in, the drop is ≈ 0.004".
        const nearHigh = points.filter((p) => p.x > -9.6 && p.x < -9.4 && p.y > 0);
        expect(nearHigh.length).toBeGreaterThan(0);
        expect(Math.max(...nearHigh.map((p) => p.y))).toBeGreaterThan(17.95);
    });

    it('descends monotonically toward the low side and stays inside the blank', () => {
        const points = outlinePoints(buildFaceOutline(20, 36, [ramp]));
        const top = points.filter((p) => p.y > 5).sort((a, b) => a.x - b.x);
        for (let i = 1; i < top.length; i += 1) {
            expect(top[i].y).toBeLessThanOrEqual(top[i - 1].y + 1e-6);
        }
        expect(Math.max(...points.map((p) => p.y))).toBeLessThanOrEqual(18 + 1e-6);
        expect(Math.max(...points.map((p) => p.x))).toBeLessThanOrEqual(10 + 1e-6);
    });

    it('mirrors when the low end is the other side', () => {
        const mirrored: Op = { type: 'curve', edge: 'l1', kind: 'ramp', height: 8, low: 'w0' };
        const points = outlinePoints(buildFaceOutline(20, 36, [mirrored]));
        expect(points.some((p) => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
        expect(points.some((p) => Math.abs(p.x + 10) < 1e-6 && Math.abs(p.y - 10) < 1e-3)).toBe(true);
    });

    it('works on w-edges too', () => {
        const side: Op = { type: 'curve', edge: 'w1', kind: 'ramp', height: 4, low: 'l0' };
        const points = outlinePoints(buildFaceOutline(20, 36, [side]));
        // High corner of w1 is the one it shares with l1: (10, 18).
        expect(points.some((p) => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.y - 18) < 1e-6)).toBe(true);
        // Low corner (shared with l0) pulls in by 4: (6, -18).
        expect(points.some((p) => Math.abs(p.x - 6) < 1e-3 && Math.abs(p.y + 18) < 1e-6)).toBe(true);
    });
});

describe('buildPartGeometry — curved parts', () => {
    it('extrudes through the full thickness with the blank bounding box', () => {
        const geometry = buildPartGeometry(
            curvedPart([{ type: 'curve', edge: 'l1', kind: 'arc', height: 4 }]),
            T,
        );
        const box = bbox(geometry);
        expect(box.max.z).toBeCloseTo(T / 2, 4);
        expect(box.min.z).toBeCloseTo(-T / 2, 4);
        expect(box.max.x).toBeCloseTo(10, 4);
        expect(box.max.y).toBeCloseTo(18, 4);
        expect(box.min.y).toBeCloseTo(-18, 4);
    });

    it('extrudes a curved part with a channel as a full-thickness blank (the CSG pass cuts it)', () => {
        const withDado = curvedPart([
            { type: 'curve', edge: 'l1', kind: 'arc', height: 4 },
            { type: 'dado', face: 'front', axis: 'l', offset: 10, width: 0.75, depth: 0.25 },
        ]);
        const geometry = buildPartGeometry(withDado, T);
        // The builder itself never slabs a shaped part: full thickness everywhere, and the dado is
        // subtracted from this blank by the worker instead (D72, covered in channelCsg.spec.ts).
        const box = bbox(geometry);
        expect(box.max.z - box.min.z).toBeCloseTo(T, 4);
    });

    it('still tapers a miter on an un-curved edge of a curved part', () => {
        const geometry = buildPartGeometry(
            curvedPart([
                { type: 'curve', edge: 'l1', kind: 'arc', height: 4 },
                { type: 'miter', edge: 'w0', angle: 45 },
            ]),
            T,
        );
        // Edge-plane semantics: back vertices that sat on the w0 plane recede by t·tan(45°).
        // (Arc samples near the top corner are inboard of the plane and stay — v1 artifact.)
        const pos = geometry.getAttribute('position');
        let minXBackStraight = Infinity;
        let frontAtEdge = false;
        for (let i = 0; i < pos.count; i += 1) {
            const y = pos.getY(i);
            if (pos.getZ(i) < -T / 2 + 1e-4 && y < 13) {
                minXBackStraight = Math.min(minXBackStraight, pos.getX(i));
            }
            if (pos.getZ(i) > T / 2 - 1e-4 && pos.getX(i) < -10 + 1e-4) {
                frontAtEdge = true;
            }
        }
        expect(minXBackStraight).toBeGreaterThanOrEqual(-10 + T - 0.01);
        expect(frontAtEdge).toBe(true); // the front face still reaches the full length
    });

    it('square parts keep taking the box fast path', () => {
        const geometry = buildPartGeometry(curvedPart([]), T);
        expect(geometry.getAttribute('position').count).toBe(24); // BoxGeometry signature
    });
});
