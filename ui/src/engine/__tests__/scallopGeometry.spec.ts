import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFaceOutline } from '@/engine/geometry/partGeometry';
import { buildOutline } from '@/engine/geometry/partOutline';
import type { Op } from '@/spec/types';
import type { CurveOp, NotchOp } from '@/engine/geometry/partOutline';

/**
 * Partial-span arcs (§3.1, spec 1.14) — the "scallop".
 *
 * This is the modelling gap the MCP usability report called the real blocker: the reference object
 * needed a swooping bottom edge WITH a cradle notch cut into it, and until 1.14 a curve claimed the
 * whole edge, so the notch was silently skipped and the design had to ship as a stepped
 * approximation. The conflict is per-RUN now, not per-edge.
 */

const L = 24;
const W = 12;

function points(ops: Op[]): [number, number][] {
    const curves = ops.filter((op) => op.type === 'curve') as CurveOp[];
    const notches = ops.filter((op) => op.type === 'notch') as NotchOp[];
    const pts: [number, number][] = buildFaceOutline(L, W, curves, notches)
        .getPoints(512)
        .map((p: THREE.Vector2): [number, number] => [p.x, p.y]);
    return pts;
}

function hasVertex(pts: [number, number][], x: number, y: number, tol = 1e-6): boolean {
    return pts.some(([px, py]) => Math.abs(px - x) < tol && Math.abs(py - y) < tol);
}

/**
 * How far inward the l0 edge has been cut over a stretch of x. Inward from l0 is +y (the edge sits
 * at y = -w/2), so the deepest point of a dip is the LARGEST y the outline reaches there.
 */
function dipOnL0(pts: [number, number][], x0: number, x1: number): number {
    return Math.max(...pts.filter(([x]) => x > x0 && x < x1).map(([, y]) => y));
}

describe('buildOutline — a scallop leaves the edge straight outside its run', () => {
    // l0 sits at y = -w/2 = -6; the datum runs from x = -12 (0) to x = +12 (24).
    const scallop: Op = { type: 'curve', edge: 'l0', kind: 'arc', from: 8, to: 16, height: 2 };

    it('keeps both corners of the edge where they were', () => {
        const pts = points([scallop]);
        expect(hasVertex(pts, -L / 2, -W / 2)).toBe(true);
        expect(hasVertex(pts, L / 2, -W / 2)).toBe(true);
    });

    it('dips exactly `height` at the middle of the run and nowhere else', () => {
        const pts = points([scallop]);
        // Datum 12 is x = 0 — the middle of an 8"–16" run.
        expect(dipOnL0(pts, -1, 1)).toBeCloseTo(-W / 2 + 2, 9);
    });

    it('starts and ends the dip on the original edge line', () => {
        // Datum 8 and 16 are x = -4 and x = +4. Both sit at full width, so the edge either side of
        // the run is a straight line from the corner — which is what lets a notch live there.
        const pts = points([scallop]);
        expect(hasVertex(pts, -4, -W / 2)).toBe(true);
        expect(hasVertex(pts, 4, -W / 2)).toBe(true);
    });

    it('is a dome, not a scallop, when from and to are both omitted', () => {
        // A dome moves the corners inward instead; a scallop never does.
        const dome: Op = { type: 'curve', edge: 'l0', kind: 'arc', height: 2 };
        const pts = points([dome]);
        expect(hasVertex(pts, -L / 2, -W / 2)).toBe(false);
        expect(hasVertex(pts, -L / 2, -W / 2 + 2)).toBe(true);
    });
});

describe('buildOutline — scallops and notches compose per run', () => {
    it('cuts BOTH when their runs only abut', () => {
        const pts = points([
            { type: 'curve', edge: 'l0', kind: 'arc', from: 6, to: 20, height: 2 },
            { type: 'notch', edge: 'l0', from: 0, to: 6, depth: 3 },
        ]);

        // The notch's inner corner, 3" up from the edge at datum 6 (x = -6).
        expect(hasVertex(pts, -6, -W / 2 + 3)).toBe(true);
        // And the scallop still dips 2" at the middle of 6–20 (datum 13, x = 1).
        expect(dipOnL0(pts, 0.5, 1.5)).toBeCloseTo(-W / 2 + 2, 9);
    });

    it('drops the notch where the runs genuinely overlap — the curve wins', () => {
        const pts = points([
            { type: 'curve', edge: 'l0', kind: 'arc', from: 2, to: 10, height: 2 },
            { type: 'notch', edge: 'l0', from: 6, to: 12, depth: 3 },
        ]);

        expect(hasVertex(pts, -6, -W / 2 + 3)).toBe(false);
    });

    it('still lets a whole-edge dome consume the edge outright', () => {
        const pts = points([
            { type: 'curve', edge: 'l0', kind: 'arc', height: 2 },
            { type: 'notch', edge: 'l0', from: 0, to: 6, depth: 3 },
        ]);

        expect(hasVertex(pts, -6, -W / 2 + 3)).toBe(false);
    });

    it('leaves a notch on a different edge alone', () => {
        const pts = points([
            { type: 'curve', edge: 'l0', kind: 'arc', from: 6, to: 20, height: 2 },
            { type: 'notch', edge: 'l1', from: 0, to: 6, depth: 3 },
        ]);

        // l1 sits at y = +6; the notch bites 3" down from it.
        expect(hasVertex(pts, -6, W / 2 - 3)).toBe(true);
    });
});

describe('buildOutline — scallop geometry stays sane at the limits', () => {
    it('is a clean semicircle at the deepest a scallop may go (height = half the run)', () => {
        const outline = buildOutline(L, W, [
            { type: 'curve', edge: 'l0', kind: 'arc', from: 8, to: 16, height: 4 } as CurveOp,
        ]);
        const arc = outline.segments.find((s) => s.kind === 'arc');

        expect(arc).toBeDefined();
        // r = h/2 + c²/(8h) = 2 + 64/32 = 4, and the centre lands on the edge line itself.
        expect(arc!.kind === 'arc' && arc!.r).toBeCloseTo(4, 9);
        expect(arc!.kind === 'arc' && arc!.cy).toBeCloseTo(-W / 2, 9);
    });

    it('emits only finite numbers', () => {
        const outline = buildOutline(L, W, [
            { type: 'curve', edge: 'l0', kind: 'arc', from: 8, to: 16, height: 2 } as CurveOp,
            { type: 'curve', edge: 'w1', kind: 'arc', from: 2, to: 10, height: 1 } as CurveOp,
        ]);

        for (const segment of outline.segments) {
            const numbers =
                segment.kind === 'line'
                    ? [segment.x, segment.y]
                    : [segment.cx, segment.cy, segment.r, segment.a0, segment.a1];
            expect(numbers.every(Number.isFinite)).toBe(true);
        }
    });
});
