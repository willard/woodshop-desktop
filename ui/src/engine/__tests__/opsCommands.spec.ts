import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { AddOp, RemoveOp } from '@/engine/commands';
import { parseSpec } from '@/spec';
import type { Spec, Op } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const dado: Op = { type: 'dado', face: 'front', axis: 'l', offset: 10, width: 0.75, depth: 0.25 };
const hole: Op = { type: 'hole', face: 'front', x: 2, y: 2, diameter: 0.25, purpose: 'shelfPin' };

function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

/**
 * record-stand with a hole op prepended to p_side_l, so its dado sits at index 1 and the
 * p_side_l joint's opRef points at 1 — the shape RemoveOp's reindexing has to preserve.
 */
function multiOpDoc(): EditorDocument {
    const base = parseSpec(recordStand);
    const spec: Spec = {
        ...base,
        parts: base.parts.map((p) => (p.id === 'p_side_l' ? { ...p, ops: [hole, ...(p.ops ?? [])] } : p)),
        joints: (base.joints ?? []).map((j) => (j.hostPartId === 'p_side_l' ? { ...j, opRef: 1 } : j)),
    };
    return new EditorDocument(parseSpec(spec));
}

function partOf(d: EditorDocument, id: string) {
    return d.spec.parts.find((p) => p.id === id)!;
}

describe('AddOp', () => {
    it('appends the op, marks the part locked, and undoes exactly', () => {
        const d = doc();
        const before = JSON.stringify(partOf(d, 'p_top'));

        const opsBefore = (partOf(d, 'p_top').ops ?? []).length;
        d.execute(new AddOp('p_top', dado));
        const edited = partOf(d, 'p_top');
        expect(edited.ops).toHaveLength(opsBefore + 1);
        expect(edited.ops?.at(-1)).toEqual(dado);
        expect(edited.locked).toBe(true);

        d.undo();
        expect(JSON.stringify(partOf(d, 'p_top'))).toBe(before);
    });

    it('redo reproduces the identical spec', () => {
        const d = doc();
        d.execute(new AddOp('p_top', hole));
        const after = JSON.stringify(d.spec);
        d.undo();
        d.redo();
        expect(JSON.stringify(d.spec)).toBe(after);
    });

    it('is a no-op for an unknown part id', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new AddOp('p_ghost', dado));
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('is op-agnostic: an ease op appends, locks, and undoes like any other', () => {
        const d = doc();
        const before = d.spec.parts.find((p) => p.id === 'p_top')!.ops?.length ?? 0;
        d.execute(new AddOp('p_top', { type: 'ease', edge: 'l1', profile: 'roundover', radius: 0.25 }));
        const edited = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(edited.ops?.length).toBe(before + 1);
        expect(edited.ops?.at(-1)?.type).toBe('ease');
        expect(edited.locked).toBe(true);
        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.ops?.length ?? 0).toBe(before);
    });

    it('is op-agnostic: a notch op appends, locks, and undoes like any other', () => {
        const d = doc();
        const before = JSON.stringify(partOf(d, 'p_top'));
        d.execute(new AddOp('p_top', { type: 'notch', edge: 'l1', from: 0, to: 3.5, depth: 1.5 }));
        const edited = partOf(d, 'p_top');
        expect(edited.ops?.at(-1)?.type).toBe('notch');
        expect(edited.locked).toBe(true);
        d.undo();
        expect(JSON.stringify(partOf(d, 'p_top'))).toBe(before);
    });

    it('rejects an invalid op payload and leaves the spec intact', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        const bad = { ...dado, width: -1 } as Op;
        expect(() => d.execute(new AddOp('p_top', bad))).toThrow();
        expect(JSON.stringify(d.spec)).toBe(before);
        expect(d.canUndo).toBe(false);
    });
});

describe('RemoveOp', () => {
    it('removes the op at the index and marks the part locked', () => {
        const d = doc();
        d.execute(new RemoveOp('p_side_l', 0));
        const edited = partOf(d, 'p_side_l');
        expect(edited.ops).toHaveLength(0);
        expect(edited.locked).toBe(true);
    });

    it('drops joints whose opRef pointed at the removed op', () => {
        const d = doc();
        expect(d.spec.joints?.some((j) => j.hostPartId === 'p_side_l')).toBe(true);

        d.execute(new RemoveOp('p_side_l', 0));
        expect(d.spec.joints?.some((j) => j.hostPartId === 'p_side_l')).toBe(false);
        // The other side's joint is untouched.
        expect(d.spec.joints?.some((j) => j.hostPartId === 'p_side_r')).toBe(true);
    });

    it('decrements opRefs that pointed past the removed op', () => {
        const d = multiOpDoc();
        // Removing the hole at index 0 shifts the dado to index 0; the joint must follow.
        d.execute(new RemoveOp('p_side_l', 0));
        const joint = d.spec.joints?.find((j) => j.hostPartId === 'p_side_l');
        expect(joint?.opRef).toBe(0);
        expect(partOf(d, 'p_side_l').ops?.[0].type).toBe('dado');
        // And the document still lints without op.out-of-range joint errors.
        expect(d.lint().filter((i) => i.code === 'joint.op-missing')).toEqual([]);
    });

    it('undo restores the op, the joints, opRefs, and locked exactly', () => {
        const d = multiOpDoc();
        const before = JSON.stringify(d.spec);

        d.execute(new RemoveOp('p_side_l', 1)); // the dado the joint references
        expect(d.spec.joints?.some((j) => j.hostPartId === 'p_side_l')).toBe(false);

        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('undo → redo is byte-deterministic', () => {
        const d = multiOpDoc();
        d.execute(new RemoveOp('p_side_l', 0));
        const after = JSON.stringify(d.spec);
        d.undo();
        d.redo();
        expect(JSON.stringify(d.spec)).toBe(after);
    });

    it('is a no-op for an out-of-range index or unknown part', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new RemoveOp('p_side_l', 5));
        d.execute(new RemoveOp('p_ghost', 0));
        expect(JSON.stringify(d.spec)).toBe(before);
    });
});
