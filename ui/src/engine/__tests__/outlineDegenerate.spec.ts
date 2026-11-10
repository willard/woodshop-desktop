import { describe, it, expect } from 'vitest';
import { buildOutline, isFiniteArc } from '@/engine/geometry/partOutline';
import { buildPartGeometry } from '@/engine/geometry/partGeometry';
import { lintSpec } from '@/spec/linter';
import { parseSpec } from '@/spec';
import type { CurveOp } from '@/engine/geometry/partOutline';
import type { Part } from '@/spec/types';

/**
 * Opposing arcs deep enough to meet.
 *
 * w0 and w1 each pull both of their corners inward by 10" across a 20" length, so all four corners
 * land on the part's centreline in pairs — and the l1 arc is then asked for a circle through three
 * points that are really two. `d` (twice the triangle's signed area) is 0, and dividing by it used
 * to hand three.js a NaN centre: the part silently left the scene, along with a bounding sphere the
 * culler, the raycaster and the measure tool all depend on.
 */
const OPPOSED: CurveOp[] = [
    { type: 'curve', edge: 'w0', kind: 'arc', height: 10 },
    { type: 'curve', edge: 'w1', kind: 'arc', height: 10 },
    { type: 'curve', edge: 'l1', kind: 'arc', height: 4 },
];

describe('buildOutline — collapsed outlines stay finite', () => {
    it('emits no non-finite number for opposing arcs that consume the span', () => {
        const outline = buildOutline(20, 36, OPPOSED);

        for (const segment of outline.segments) {
            expect(isFiniteArc(segment)).toBe(true);
            const numbers =
                segment.kind === 'line'
                    ? [segment.x, segment.y]
                    : [segment.cx, segment.cy, segment.r, segment.a0, segment.a1];
            expect(numbers.every(Number.isFinite)).toBe(true);
        }
    });

    it('falls back to a straight edge — three collinear points are a line', () => {
        // The l1 edge has collapsed to a point, so it must contribute lines, never an arc.
        const outline = buildOutline(20, 36, OPPOSED);
        expect(outline.segments.some((s) => s.kind === 'arc' && !Number.isFinite(s.r))).toBe(false);
    });
});

describe('buildPartGeometry — the mesh survives it', () => {
    it('keeps a finite bounding box and sphere', () => {
        const part: Part = {
            id: 'p_a',
            name: 'A',
            materialId: 'mat_a',
            size: { l: 20, w: 36 },
            grainAxis: 'l',
            transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
            qty: 1,
            locked: false,
            ops: OPPOSED,
        };

        const geometry = buildPartGeometry(part, 0.75);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        expect(geometry.boundingBox!.min.toArray().every(Number.isFinite)).toBe(true);
        expect(geometry.boundingBox!.max.toArray().every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(geometry.boundingSphere!.radius)).toBe(true);
    });
});

describe('lintSpec — op.curve-opposed catches it before geometry', () => {
    it('errors when two arcs consume the span between them', () => {
        const spec = parseSpec({
            specVersion: '1.15',
            units: 'in',
            name: 'opposed',
            materials: [
                {
                    id: 'mat_a',
                    type: 'sheet',
                    name: 'Ply',
                    thickness: 0.75,
                    sheetSize: { l: 60, w: 60 },
                    grain: true,
                },
            ],
            parts: [
                {
                    id: 'p_a',
                    name: 'A',
                    materialId: 'mat_a',
                    size: { l: 20, w: 36 },
                    grainAxis: 'l',
                    transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
                    qty: 1,
                    ops: OPPOSED,
                },
            ],
            joints: [],
        });

        const issue = lintSpec(spec).find((i) => i.code === 'op.curve-opposed');
        expect(issue?.severity).toBe('error');
        expect(issue?.partId).toBe('p_a');
    });

    it('leaves opposing arcs that still leave material alone', () => {
        const spec = parseSpec({
            specVersion: '1.15',
            units: 'in',
            name: 'shallow',
            materials: [
                {
                    id: 'mat_a',
                    type: 'sheet',
                    name: 'Ply',
                    thickness: 0.75,
                    sheetSize: { l: 60, w: 60 },
                    grain: true,
                },
            ],
            parts: [
                {
                    id: 'p_a',
                    name: 'A',
                    materialId: 'mat_a',
                    size: { l: 20, w: 36 },
                    grainAxis: 'l',
                    transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
                    qty: 1,
                    ops: [
                        { type: 'curve', edge: 'w0', kind: 'arc', height: 4 },
                        { type: 'curve', edge: 'w1', kind: 'arc', height: 4 },
                    ],
                },
            ],
            joints: [],
        });

        expect(lintSpec(spec).some((i) => i.code === 'op.curve-opposed')).toBe(false);
    });
});
