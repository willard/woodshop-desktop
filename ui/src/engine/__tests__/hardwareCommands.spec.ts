import { describe, it, expect } from 'vitest';
import {
    AddHardware,
    DuplicateGroup,
    DuplicatePart,
    GroupParts,
    RemoveHardware,
    RemovePart,
    RemoveParts,
    UpdateHardware,
    uniqueHardwareId,
} from '@/engine';
import { extractParts } from '@/engine/extract';
import { parseSpec, safeParseSpec } from '@/spec';
import type { HardwareMount, Spec } from '@/spec';

const pull = (id: string, partId: string): HardwareMount => ({
    id,
    item: 'pull.bar-96mm',
    partId,
    side: 'front',
    x: 6,
    y: 10,
    rot: 90,
});

function spec(hardware: HardwareMount[] = []): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'T',
        materials: [
            { id: 'm_ply', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
        ],
        parts: ['p_a', 'p_b', 'p_c'].map((id, i) => ({
            id,
            name: id,
            materialId: 'm_ply',
            size: { l: 12, w: 20 },
            transform: { pos: [i * 14, 10, 0] },
        })),
        hardware,
    });
}

describe('hardware commands', () => {
    it('adds, edits and removes a mount, each undoable', () => {
        const start = spec();
        const add = new AddHardware(pull('hw_1', 'p_a'));
        const added = add.do(start);
        expect(added.hardware).toHaveLength(1);
        expect(safeParseSpec(added).success).toBe(true);

        const edit = new UpdateHardware('hw_1', { side: 'back', x: 2 });
        const edited = edit.do(added);
        expect(edited.hardware![0]).toMatchObject({ side: 'back', x: 2, y: 10 });
        expect(edit.undo(edited)).toEqual(added);
        // An edit that changes nothing leaves the spec object alone (no undo entry, no save).
        expect(new UpdateHardware('hw_1', { x: 6 }).do(added)).toBe(added);

        const remove = new RemoveHardware('hw_1');
        const removed = remove.do(added);
        expect(removed.hardware).toEqual([]);
        expect(remove.undo(removed)).toEqual(added);
        expect(add.undo(added)).toEqual(start);
    });

    it('mints ids that do not collide', () => {
        const s = spec([pull('hw_pull_bar_96mm', 'p_a')]);
        expect(uniqueHardwareId(s, 'pull.bar-96mm')).toBe('hw_pull_bar_96mm_2');
        expect(uniqueHardwareId(spec(), 'caster.locking-3in')).toBe('hw_caster_locking_3in');
        expect(uniqueHardwareId(spec(), 'caster.locking-3in')).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
    });
});

describe('hardware follows its part', () => {
    const start = spec([pull('hw_a', 'p_a'), pull('hw_b', 'p_b'), pull('hw_a2', 'p_a')]);

    it('goes when the part is deleted and comes back in place on undo', () => {
        const one = new RemovePart('p_a');
        const after = one.do(start);
        expect(after.hardware!.map((h) => h.id)).toEqual(['hw_b']);
        expect(one.undo(after)).toEqual(start);

        const many = new RemoveParts(['p_a', 'p_b']);
        const none = many.do(start);
        expect(none.hardware).toEqual([]);
        expect(many.undo(none)).toEqual(start);
    });

    it('is copied when the part is duplicated', () => {
        const dup = new DuplicatePart('p_a', 'p_a_copy');
        const after = dup.do(start);
        const copies = after.hardware!.filter((h) => h.partId === 'p_a_copy');
        expect(copies).toHaveLength(2);
        expect(new Set(after.hardware!.map((h) => h.id)).size).toBe(5);
        expect(copies[0]).toMatchObject({ item: 'pull.bar-96mm', side: 'front', x: 6, y: 10, rot: 90 });
        expect(safeParseSpec(after).success).toBe(true);
        expect(dup.undo(after)).toEqual(start);
    });

    it('is copied with a duplicated group', () => {
        const grouped = new GroupParts('g_ab', ['p_a', 'p_b']).do(start);
        const dup = new DuplicateGroup('g_ab');
        const after = dup.do(grouped);
        expect(after.hardware).toHaveLength(6);
        expect(new Set(after.hardware!.map((h) => h.id)).size).toBe(6);
        expect(safeParseSpec(after).success).toBe(true);
        expect(dup.undo(after)).toEqual(grouped);
    });

    it('comes along into a project made from those parts', () => {
        const out = extractParts(start, ['p_a'], 'Just A');
        expect(out.hardware!.map((h) => h.id)).toEqual(['hw_a', 'hw_a2']);
        expect(safeParseSpec(out).success).toBe(true);
    });
});
