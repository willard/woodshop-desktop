import { describe, it, expect } from 'vitest';
import { planDowels, touchingParts } from '@/engine/dowels';
import { AddDowelJoint } from '@/engine/commands';
import { EditorDocument } from '@/engine/EditorDocument';
import { parseSpec, type Spec } from '@/spec';

/**
 * Edge-to-face butt: a horizontal shelf (rot [90,0,0]) meets a vertical side (rot [0,90,0])
 * whose inner face is at x = 12, coincident with the shelf's w1 end. The side's thickness
 * axis is world X — it is the face that carries the dowels; the shelf presents an edge.
 */
function lJoint(): Spec {
    return parseSpec({
        specVersion: '1.7',
        units: 'in',
        name: 'Dowel L',
        materials: [
            { id: 'mat', type: 'sheet', name: 'Ply 3/4', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
        ],
        parts: [
            {
                id: 'p_shelf',
                name: 'Shelf',
                materialId: 'mat',
                size: { l: 24, w: 8 },
                transform: { pos: [0, 6, 0], rot: [90, 0, 0] },
            },
            {
                id: 'p_side',
                name: 'Side',
                materialId: 'mat',
                size: { l: 8, w: 12 },
                transform: { pos: [12.375, 6, 0], rot: [0, 90, 0] },
            },
        ],
    }) as Spec;
}

/** Two face-to-face laminated boards (a thick top glued from two 3/4" sheets). */
function laminate(): Spec {
    return parseSpec({
        specVersion: '1.7',
        units: 'in',
        name: 'Laminate',
        materials: [
            { id: 'mat', type: 'sheet', name: 'Ply 3/4', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
        ],
        parts: [
            {
                id: 'p_lower',
                name: 'Lower',
                materialId: 'mat',
                size: { l: 24, w: 12 },
                transform: { pos: [0, 0, 0], rot: [90, 0, 0] },
            },
            {
                id: 'p_upper',
                name: 'Upper',
                materialId: 'mat',
                size: { l: 24, w: 12 },
                transform: { pos: [0, 0.75, 0], rot: [90, 0, 0] },
            },
        ],
    }) as Spec;
}

describe('planDowels', () => {
    it('puts dowels on the face part (the side), not the shelf edge', () => {
        const plan = planDowels(lJoint(), 'p_shelf', 'p_side');
        expect('error' in plan).toBe(false);
        if ('error' in plan) {
            return;
        }
        expect(plan.partId).toBe('p_side');
        expect(plan.matePartId).toBe('p_shelf');
        expect(plan.holes.length).toBeGreaterThanOrEqual(2);
        for (const hole of plan.holes) {
            expect(hole.purpose).toBe('dowel');
            expect(hole.diameter).toBeCloseTo(0.375, 5);
            // Blind: 3/4" stock, 1/8" reveal → 5/8" deep.
            expect(hole.depth).toBeCloseTo(0.625, 5);
            // Within the side's face bounds (l = 8, w = 12).
            expect(hole.x).toBeGreaterThanOrEqual(0);
            expect(hole.x).toBeLessThanOrEqual(8);
            expect(hole.y).toBeGreaterThanOrEqual(0);
            expect(hole.y).toBeLessThanOrEqual(12);
        }
    });

    it('spaces multiple dowels along the longer contact side', () => {
        const plan = planDowels(lJoint(), 'p_shelf', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        // Contact run is the 8" depth → floor(6/8)+1 clamped to ≥2 = 2 dowels.
        expect(plan.holes).toHaveLength(2);
        const spread = Math.max(...plan.holes.map((h) => h.x)) - Math.min(...plan.holes.map((h) => h.x));
        expect(spread).toBeGreaterThan(0);
    });

    it('handles a face-to-face laminate (preferred part receives the holes)', () => {
        const plan = planDowels(laminate(), 'p_upper', 'p_lower');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        expect(plan.partId).toBe('p_upper');
        expect(plan.holes.length).toBeGreaterThanOrEqual(2);
    });

    it('refuses parts that do not touch', () => {
        const spec = lJoint();
        spec.parts[1].transform.pos = [20, 6, 0]; // slide the side away
        const plan = planDowels(spec, 'p_shelf', 'p_side');
        expect('error' in plan && /touch/i.test(plan.error)).toBe(true);
    });

    it('refuses overlapping parts', () => {
        const spec = lJoint();
        spec.parts[1].transform.pos = [8, 6, 0]; // shove the side into the shelf
        const plan = planDowels(spec, 'p_shelf', 'p_side');
        expect('error' in plan && /overlap/i.test(plan.error)).toBe(true);
    });
});

describe('AddDowelJoint command', () => {
    it('appends the holes and records the dowel joint atomically, and undoes cleanly', () => {
        const doc = new EditorDocument(lJoint());
        const plan = planDowels(doc.spec, 'p_shelf', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        const before = structuredClone(doc.spec);
        doc.execute(new AddDowelJoint(plan.partId, plan.matePartId, plan.holes));

        const side = doc.spec.parts.find((p) => p.id === 'p_side');
        expect(side?.ops).toHaveLength(plan.holes.length);
        expect(side?.locked).toBe(true);
        const joints = doc.spec.joints ?? [];
        expect(joints).toContainEqual({
            type: 'dowel',
            hostPartId: 'p_side',
            insertPartId: 'p_shelf',
            opRef: 0,
        });

        doc.undo();
        expect(doc.spec).toEqual(before);
    });
});

describe('touchingParts', () => {
    it('lists the abutting mate', () => {
        expect(touchingParts(lJoint(), 'p_shelf').map((t) => t.partId)).toEqual(['p_side']);
    });

    it('excludes parts that are apart', () => {
        const spec = lJoint();
        spec.parts[1].transform.pos = [30, 6, 0];
        expect(touchingParts(spec, 'p_shelf')).toEqual([]);
    });
});
