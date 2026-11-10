/**
 * Undo coverage for the movable commands (build-plan Phase 1d: "Vitest on every command pair").
 * These three shipped without any — they are reachable from the Inspector, so an undo that did
 * not restore exactly what was there was a live bug nobody could have caught.
 */
import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { MakeMovable, DissolveMovable, UpdateMovable, AddMovable } from '@/engine/commands';
import { parseSpec } from '@/spec';
import type { Movable } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

/** A door built from parts the fixture already has, so nothing else has to change. */
function door(overrides: Partial<Movable> = {}): Movable {
    return {
        id: 'mv_door',
        kind: 'door',
        partIds: ['p_back'],
        panelPartId: 'p_back',
        hingeEdge: 'l0',
        style: 'overlay',
        ...overrides,
    } as Movable;
}

function movables(d: EditorDocument): Movable[] {
    return d.spec.movables ?? [];
}

describe('MakeMovable', () => {
    it('declares existing parts a door, and undo takes it back off', () => {
        const d = doc();
        const before = d.spec;

        d.execute(new MakeMovable(door()));
        expect(movables(d).map((m) => m.id)).toEqual(['mv_door']);
        // A movable is an annotation (§3.3): the parts themselves must not move or change.
        expect(d.spec.parts).toEqual(before.parts);

        d.undo();
        expect(movables(d)).toEqual([]);
        expect(d.spec.parts).toEqual(before.parts);
    });

    it('refuses a part that does not exist', () => {
        const d = doc();
        d.execute(new MakeMovable(door({ partIds: ['p_ghost'], panelPartId: 'p_ghost' })));
        expect(movables(d)).toEqual([]);
    });

    it('refuses a part already claimed by another movable', () => {
        const d = doc();
        d.execute(new MakeMovable(door()));
        d.execute(new MakeMovable(door({ id: 'mv_second' })));

        expect(movables(d).map((m) => m.id)).toEqual(['mv_door']);
    });

    it('refuses an anchor that is not one of its own parts', () => {
        const d = doc();
        // The panel defines the hinge frame, so it has to be a member (schema says so too).
        d.execute(new MakeMovable(door({ partIds: ['p_back'], panelPartId: 'p_shelf_1' })));
        expect(movables(d)).toEqual([]);
    });

    it('undoes a refused command without disturbing anything', () => {
        const d = doc();
        const before = d.spec;
        d.execute(new MakeMovable(door({ partIds: ['p_ghost'], panelPartId: 'p_ghost' })));
        d.undo();
        expect(d.spec).toEqual(before);
    });
});

describe('DissolveMovable', () => {
    it('removes the annotation but keeps every part', () => {
        const d = doc();
        d.execute(new MakeMovable(door()));
        const parts = d.spec.parts;

        d.execute(new DissolveMovable('mv_door'));
        expect(movables(d)).toEqual([]);
        expect(d.spec.parts).toEqual(parts);
    });

    it('restores the movable at its original position, not on the end', () => {
        const d = doc();
        d.execute(new MakeMovable(door({ id: 'mv_a' })));
        d.execute(new MakeMovable(door({ id: 'mv_b', partIds: ['p_shelf_1'], panelPartId: 'p_shelf_1' })));

        d.execute(new DissolveMovable('mv_a'));
        expect(movables(d).map((m) => m.id)).toEqual(['mv_b']);

        d.undo();
        // Order is the thing worth asserting: a naive undo would append and give ['mv_b','mv_a'].
        expect(movables(d).map((m) => m.id)).toEqual(['mv_a', 'mv_b']);
    });

    it('is a no-op on an unknown id, and undoing it changes nothing', () => {
        const d = doc();
        d.execute(new MakeMovable(door()));
        const before = d.spec;

        d.execute(new DissolveMovable('mv_missing'));
        expect(d.spec).toEqual(before);
        d.undo();
        expect(d.spec).toEqual(before);
    });
});

describe('UpdateMovable', () => {
    it('patches only the named movable and undo restores the previous value', () => {
        const d = doc();
        d.execute(new MakeMovable(door()));

        d.execute(new UpdateMovable('mv_door', { style: 'inset' }));
        expect(movables(d)[0].style).toBe('inset');
        expect(movables(d)[0].hingeEdge).toBe('l0');

        d.undo();
        expect(movables(d)[0].style).toBe('overlay');
    });

    it('restores the whole movable, not just the patched keys', () => {
        const d = doc();
        d.execute(new MakeMovable(door()));
        const before = movables(d)[0];

        d.execute(new UpdateMovable('mv_door', { style: 'inset', hingeEdge: 'l1' } as Partial<Movable>));
        d.undo();

        expect(movables(d)[0]).toEqual(before);
    });

    it('leaves other movables alone', () => {
        const d = doc();
        d.execute(new MakeMovable(door({ id: 'mv_a' })));
        d.execute(new MakeMovable(door({ id: 'mv_b', partIds: ['p_shelf_1'], panelPartId: 'p_shelf_1' })));

        d.execute(new UpdateMovable('mv_a', { style: 'inset' }));
        expect(movables(d).find((m) => m.id === 'mv_b')!.style).toBe('overlay');
    });

    it('is a no-op on an unknown id', () => {
        const d = doc();
        d.execute(new MakeMovable(door()));
        const before = d.spec;

        d.execute(new UpdateMovable('mv_missing', { style: 'inset' }));
        expect(d.spec).toEqual(before);
        d.undo();
        expect(d.spec).toEqual(before);
    });
});

describe('AddMovable', () => {
    it('adds parts, joints and the annotation as one undo step', () => {
        const d = doc();
        const before = d.spec;
        const panel = { ...before.parts.find((p) => p.id === 'p_shelf_1')!, id: 'p_door_panel', ops: [] };

        d.execute(
            new AddMovable({
                parts: [panel],
                joints: [
                    {
                        id: 'j_door',
                        type: 'screw',
                        hostPartId: 'p_side_l',
                        insertPartId: 'p_door_panel',
                    },
                ],
                movable: door({ id: 'mv_added', partIds: ['p_door_panel'], panelPartId: 'p_door_panel' }),
            }),
        );

        expect(d.spec.parts).toHaveLength(before.parts.length + 1);
        expect(movables(d).map((m) => m.id)).toEqual(['mv_added']);

        // One press, not eleven — the whole assembly comes back out together.
        d.undo();
        expect(d.spec.parts).toEqual(before.parts);
        expect(d.spec.joints).toEqual(before.joints);
        expect(movables(d)).toEqual([]);
    });
});
