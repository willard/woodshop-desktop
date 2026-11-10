import { describe, it, expect } from 'vitest';
import { detectDadoJoints, mergeJoints } from '@/engine/joints';
import { EditorDocument } from '@/engine/EditorDocument';
import { AddOp } from '@/engine/commands';
import { parseSpec, type Spec } from '@/spec';
import type { Joint } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function key(j: Joint): string {
    return `${j.hostPartId}->${j.insertPartId}@${j.opRef}`;
}

describe('detectDadoJoints', () => {
    it('rediscovers the record-stand shelf-in-dado joints (and only those)', () => {
        const detected = detectDadoJoints(parseSpec(recordStand));
        const keys = detected.map(key).sort();
        expect(keys).toEqual(['p_side_l->p_shelf_1@0', 'p_side_r->p_shelf_1@0']);
    });

    it('does not seat a part whose thickness differs from the dado width', () => {
        const spec = parseSpec(recordStand) as Spec;
        // Fatten the shelf's material so it no longer fits the 0.709" dado.
        spec.materials[0].thickness = 1.5;
        expect(detectDadoJoints(spec)).toEqual([]);
    });

    it('does not seat a full-width neighbour that merely overlaps the channel', () => {
        // The back panel spans the sides' dado height but is not a thin edge in the channel.
        const detected = detectDadoJoints(parseSpec(recordStand));
        expect(detected.some((j) => j.insertPartId === 'p_back')).toBe(false);
    });

    it('finds the joint for a manually added dado that a mate already sits in', () => {
        // Strip the fixture's joints, then re-add the left dado by command (the Inspector
        // "Add dado" flow): detection alone must rediscover the seated shelf.
        const base = parseSpec(recordStand) as Spec;
        const stripped: Spec = {
            ...base,
            joints: [],
            parts: base.parts.map((p) => (p.id === 'p_side_l' ? { ...p, ops: [] } : p)),
        };
        const d = new EditorDocument(parseSpec(stripped));
        expect(detectDadoJoints(d.spec).some((j) => j.hostPartId === 'p_side_l')).toBe(false);

        d.execute(
            new AddOp('p_side_l', {
                type: 'dado',
                face: 'front',
                axis: 'l',
                offset: 17,
                width: 0.709,
                depth: 0.25,
            }),
        );
        const detected = detectDadoJoints(d.spec);
        expect(detected.map((j) => `${j.hostPartId}->${j.insertPartId}@${j.opRef}`)).toContain(
            'p_side_l->p_shelf_1@0',
        );
    });
});

describe('mergeJoints', () => {
    it('adds new joints without duplicating existing ones', () => {
        const existing: Joint[] = [
            { type: 'dado', hostPartId: 'p_side_l', insertPartId: 'p_shelf_1', opRef: 0 },
        ];
        const detected: Joint[] = [
            { type: 'dado', hostPartId: 'p_side_l', insertPartId: 'p_shelf_1', opRef: 0 },
            { type: 'dado', hostPartId: 'p_side_r', insertPartId: 'p_shelf_1', opRef: 0 },
        ];
        expect(mergeJoints(existing, detected)).toHaveLength(2);
    });
});
