import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFaceOutline, buildPartGeometry } from '@/engine/geometry/partGeometry';
import { makePart } from '@/engine/commands';
import type { Op, Part } from '@/spec/types';

const T = 0.75;

function notchedPart(ops: Op[], l = 24, w = 12): Part {
    return { ...makePart({ id: 'p_shelf', name: 'Shelf', materialId: 'mat_x', size: { l, w } }), ops };
}

function outline(l: number, w: number, ops: Op[]): THREE.Vector2[] {
    const curves = ops.filter((op) => op.type === 'curve') as Extract<Op, { type: 'curve' }>[];
    const notches = ops.filter((op) => op.type === 'notch') as Extract<Op, { type: 'notch' }>[];
    return buildFaceOutline(l, w, curves, notches).getPoints(256);
}

/** The shape's polygon vertices, with the closed path's repeated start point stripped. */
function vertices(l: number, w: number, ops: Op[]): [number, number][] {
    const pts: [number, number][] = outline(l, w, ops).map((p) => [p.x, p.y]);
    while (
        pts.length > 1 &&
        Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 1e-9
    ) {
        pts.pop();
    }
    return pts;
}

function hasVertex(pts: [number, number][], x: number, y: number): boolean {
    return pts.some(([px, py]) => Math.abs(px - x) < 1e-6 && Math.abs(py - y) < 1e-6);
}

/**
 * No zero-area spikes (collinear reversals). Consecutive near-duplicates are collapsed
 * first: arc sampling legitimately lands a sample on the following line vertex (float
 * dust), exactly as existing curve outlines do — only genuine retracing is a defect.
 */
function assertCleanPolygon(raw: [number, number][]): void {
    const pts: [number, number][] = [];
    for (const p of raw) {
        const last = pts[pts.length - 1];
        if (last === undefined || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) {
            pts.push(p);
        }
    }
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const u = [p1[0] - p0[0], p1[1] - p0[1]];
        const v = [p2[0] - p1[0], p2[1] - p1[1]];
        const cross = u[0] * v[1] - u[1] * v[0];
        const dot = u[0] * v[0] + u[1] * v[1];
        // Collinear + reversing = a spike that retraces itself.
        expect(Math.abs(cross) > 1e-9 || dot > 0).toBe(true);
    }
}

// 24 × 12 blank: corners at (±12, ±6). Datum for l-edges runs from x = −12 (w0 side);
// for w-edges from y = −6 (l0 side).

describe('buildFaceOutline — notch (§3.1, spec 1.7)', () => {
    it('cuts a corner notch as an L-shaped detour (shelf around a leg)', () => {
        // Notch the l1 (top) edge from the low (w0) corner: from 0 → 3.5, depth 1.5.
        const pts = vertices(24, 12, [{ type: 'notch', edge: 'l1', from: 0, to: 3.5, depth: 1.5 }]);
        expect(hasVertex(pts, -12 + 3.5, 6)).toBe(true); // notch wall meets the edge
        expect(hasVertex(pts, -12 + 3.5, 6 - 1.5)).toBe(true); // inner corner
        expect(hasVertex(pts, -12, 6 - 1.5)).toBe(true); // floor meets w0 edge
        expect(hasVertex(pts, -12, 6)).toBe(false); // the blank corner is GONE
        assertCleanPolygon(pts);
    });

    it('cuts a mid-edge notch as a 4-point detour', () => {
        const pts = vertices(24, 12, [{ type: 'notch', edge: 'l1', from: 8, to: 12, depth: 2 }]);
        expect(hasVertex(pts, -12 + 8, 6)).toBe(true);
        expect(hasVertex(pts, -12 + 8, 4)).toBe(true);
        expect(hasVertex(pts, -12 + 12, 4)).toBe(true);
        expect(hasVertex(pts, -12 + 12, 6)).toBe(true);
        expect(hasVertex(pts, -12, 6)).toBe(true); // untouched corners stay
        expect(hasVertex(pts, 12, 6)).toBe(true);
        assertCleanPolygon(pts);
    });

    it('handles the walk-reversed edges (l1 high corner, w0) with correct datum mapping', () => {
        // l1 high-corner notch: to == chord ⇒ corner at x = +12 goes away.
        const top = vertices(24, 12, [{ type: 'notch', edge: 'l1', from: 20, to: 24, depth: 1 }]);
        expect(hasVertex(top, 12, 6)).toBe(false);
        expect(hasVertex(top, -12 + 20, 6)).toBe(true);
        expect(hasVertex(top, 12, 5)).toBe(true);
        assertCleanPolygon(top);

        // w0 (left) edge, low corner (l0 side, y = −6): from 0 → 2, depth 1.5 into +x.
        const left = vertices(24, 12, [{ type: 'notch', edge: 'w0', from: 0, to: 2, depth: 1.5 }]);
        expect(hasVertex(left, -12, -6)).toBe(false);
        expect(hasVertex(left, -12, -6 + 2)).toBe(true);
        expect(hasVertex(left, -12 + 1.5, -6 + 2)).toBe(true);
        expect(hasVertex(left, -12 + 1.5, -6)).toBe(true);
        assertCleanPolygon(left);
    });

    it('covers each of the four edges', () => {
        for (const edge of ['l0', 'l1', 'w0', 'w1'] as const) {
            const pts = vertices(24, 12, [{ type: 'notch', edge, from: 4, to: 7, depth: 1 }]);
            assertCleanPolygon(pts);
            expect(pts.length).toBeGreaterThanOrEqual(8); // rect + detour
        }
    });

    it('merges overlapping notches on one edge, keeping the deeper floor', () => {
        const pts = vertices(24, 12, [
            { type: 'notch', edge: 'l1', from: 2, to: 8, depth: 1 },
            { type: 'notch', edge: 'l1', from: 6, to: 10, depth: 2 },
        ]);
        // One merged detour 2 → 10 at depth 2.
        expect(hasVertex(pts, -12 + 2, 6)).toBe(true);
        expect(hasVertex(pts, -12 + 2, 4)).toBe(true);
        expect(hasVertex(pts, -12 + 10, 4)).toBe(true);
        expect(hasVertex(pts, -12 + 10, 6)).toBe(true);
        // No wall remnants from the shallower notch.
        expect(hasVertex(pts, -12 + 8, 5)).toBe(false);
        assertCleanPolygon(pts);
    });

    it('lets a same-edge round win over the notch (rounds are curves; D34 consistency)', () => {
        const pts = vertices(24, 12, [
            { type: 'notch', edge: 'l1', from: 8, to: 12, depth: 2 },
            { type: 'curve', edge: 'l1', kind: 'round', radius: 2 },
        ]);
        // The lint warn promises "the notch is skipped on that edge" for ANY curve kind.
        expect(hasVertex(pts, -12 + 8, 4)).toBe(false);
        assertCleanPolygon(pts);
    });

    it('zeroes an adjacent-edge round aimed at a corner the notch consumes', () => {
        // Round on w0 targets both its corners; the notch on l1 eats their shared corner
        // (−12, 6), so that corner's radius must drop to zero — no dangling quarter-arc.
        const pts = vertices(24, 12, [
            { type: 'notch', edge: 'l1', from: 0, to: 3.5, depth: 1.5 },
            { type: 'curve', edge: 'w0', kind: 'round', radius: 1, corner: 'l1' },
        ]);
        expect(hasVertex(pts, -12, 6 - 1.5)).toBe(true); // notch floor meets w0 cleanly
        assertCleanPolygon(pts);
    });

    it('skips a notch whose edge also carries a curve (curve wins, matches the lint warn)', () => {
        const withCurve = vertices(24, 12, [
            { type: 'curve', edge: 'l1', kind: 'arc', height: 3 },
            { type: 'notch', edge: 'l1', from: 0, to: 4, depth: 2 },
        ]);
        // No notch wall vertex anywhere.
        expect(hasVertex(withCurve, -12 + 4, 4)).toBe(false);
    });

    it('composes with an arc on a different edge, clamping to the displaced corner', () => {
        // Arc on w0 pulls l1's low corner inward along x by the sagitta (3). A corner
        // notch on l1 must clamp its interval to start at the effective corner.
        const pts = vertices(24, 12, [
            { type: 'curve', edge: 'w0', kind: 'arc', height: 3 },
            { type: 'notch', edge: 'l1', from: 0, to: 6, depth: 1.5 },
        ]);
        assertCleanPolygon(pts);
        // The notch wall at datum 6 still exists…
        expect(hasVertex(pts, -12 + 6, 6)).toBe(true);
        // …and nothing pokes left of the arc-displaced corner (x = −12 + 3).
        const topRun = pts.filter(([, y]) => Math.abs(y - 4.5) < 1e-6);
        for (const [x] of topRun) {
            expect(x).toBeGreaterThanOrEqual(-12 + 3 - 1e-6);
        }
    });

    it('degenerates a full-edge notch into an inset edge', () => {
        const pts = vertices(24, 12, [{ type: 'notch', edge: 'l1', from: 0, to: 24, depth: 2 }]);
        expect(hasVertex(pts, -12, 6)).toBe(false);
        expect(hasVertex(pts, 12, 6)).toBe(false);
        expect(hasVertex(pts, -12, 4)).toBe(true);
        expect(hasVertex(pts, 12, 4)).toBe(true);
        assertCleanPolygon(pts);
    });

    it('keeps the extruded solid inside the blank and mesh-closed', () => {
        const part = notchedPart([{ type: 'notch', edge: 'l1', from: 0, to: 3.5, depth: 1.5 }]);
        const geometry = buildPartGeometry(part, T);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(box.max.x - box.min.x).toBeCloseTo(24, 4);
        expect(box.max.y - box.min.y).toBeCloseTo(12, 4);
        expect(box.max.z - box.min.z).toBeCloseTo(T, 4);
        expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    });

    it('still applies a miter on an un-notched edge', () => {
        const part = notchedPart([
            { type: 'notch', edge: 'l1', from: 0, to: 3.5, depth: 1.5 },
            { type: 'miter', edge: 'w1', angle: 45 },
        ]);
        const geometry = buildPartGeometry(part, T);
        // The miter recedes back-face verts at x = +12 by t·tan(45°) = 0.75.
        const pos = geometry.getAttribute('position');
        let receded = false;
        for (let i = 0; i < pos.count; i += 1) {
            if (pos.getZ(i) < -T / 2 + 1e-6 && Math.abs(pos.getX(i) - (12 - T)) < 1e-4) {
                receded = true;
            }
        }
        expect(receded).toBe(true);
    });
});
