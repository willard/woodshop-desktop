import { describe, it, expect } from 'vitest';
import { detectPocketScrewJoints, mergeJoints } from '@/engine/joints';
import { EditorDocument } from '@/engine/EditorDocument';
import { AddOp } from '@/engine/commands';
import { parseSpec, type Spec } from '@/spec';
import type { Joint, Op } from '@/spec/types';

/**
 * Two 3/4" boards butted into an L. The horizontal shelf (rot [90,0,0], length along world
 * X) meets a vertical side (rot [0,90,0]) whose inner face sits at x = 12; the shelf's w1
 * edge is at world x = 12, so pocket holes on w1 screw into the side.
 */
function lJoint(): Spec {
    return parseSpec({
        specVersion: '1.7',
        units: 'in',
        name: 'Pocket L',
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

const pocketOp = (edge: 'l0' | 'l1' | 'w0' | 'w1', count = 3): Op => ({ type: 'pocketHoles', edge, count });
const key = (j: Joint): string => `${j.hostPartId}->${j.insertPartId}@${j.opRef}`;

describe('detectPocketScrewJoints', () => {
    it('records a pocketScrew joint when the pocketed edge abuts another part', () => {
        const base = lJoint();
        const spec: Spec = {
            ...base,
            parts: base.parts.map((p) => (p.id === 'p_shelf' ? { ...p, ops: [pocketOp('w1')] } : p)),
        };
        const detected = detectPocketScrewJoints(spec);
        expect(detected.map(key)).toEqual(['p_shelf->p_side@0']);
        expect(detected[0].type).toBe('pocketScrew');
    });

    it('does not record a joint when the pocketed edge faces open air', () => {
        const base = lJoint();
        // Pockets on w0 (x = −12) — the far edge, touching nothing.
        const spec: Spec = {
            ...base,
            parts: base.parts.map((p) => (p.id === 'p_shelf' ? { ...p, ops: [pocketOp('w0')] } : p)),
        };
        expect(detectPocketScrewJoints(spec)).toEqual([]);
    });

    it('finds the joint after the Inspector adds the pocket op by command', () => {
        const doc = new EditorDocument(lJoint());
        expect(detectPocketScrewJoints(doc.spec)).toEqual([]);
        doc.execute(new AddOp('p_shelf', pocketOp('w1')));
        expect(detectPocketScrewJoints(doc.spec).map(key)).toEqual(['p_shelf->p_side@0']);
    });

    it('mergeJoints keeps a pocketScrew joint distinct from a dado on the same pair', () => {
        const existing: Joint[] = [{ type: 'dado', hostPartId: 'p_shelf', insertPartId: 'p_side', opRef: 0 }];
        const detected: Joint[] = [
            { type: 'pocketScrew', hostPartId: 'p_shelf', insertPartId: 'p_side', opRef: 0 },
        ];
        expect(mergeJoints(existing, detected)).toHaveLength(2);
    });
});
