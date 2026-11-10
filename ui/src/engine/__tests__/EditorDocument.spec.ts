import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import {
    AddPart,
    RemovePart,
    DuplicatePart,
    ResizePart,
    RotatePart,
    MovePart,
    MoveParts,
    RenamePart,
    SetMaterial,
    SetJoints,
    GroupParts,
    UngroupParts,
    makePart,
    uniquePartId,
} from '@/engine/commands';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function doc() {
    return new EditorDocument(parseSpec(recordStand));
}

describe('EditorDocument history', () => {
    it('AddPart / undo is a round-trip', () => {
        const d = doc();
        const before = d.spec.parts.length;
        const part = makePart({
            id: uniquePartId(d.spec, 'divider'),
            name: 'Divider',
            materialId: 'mat_bb18',
            size: { l: 18, w: 12 },
        });

        d.execute(new AddPart(part));
        expect(d.spec.parts).toHaveLength(before + 1);
        expect(d.canUndo).toBe(true);

        d.undo();
        expect(d.spec.parts).toHaveLength(before);
        expect(d.spec.parts.some((p) => p.id === part.id)).toBe(false);

        d.redo();
        expect(d.spec.parts.some((p) => p.id === part.id)).toBe(true);
    });

    it('RemovePart restores the part and its joints on undo', () => {
        const d = doc();
        const jointsBefore = d.spec.joints?.length ?? 0;

        d.execute(new RemovePart('p_side_l'));
        expect(d.spec.parts.some((p) => p.id === 'p_side_l')).toBe(false);
        // Joints referencing the removed part are gone too.
        expect(d.spec.joints?.some((j) => j.hostPartId === 'p_side_l')).toBe(false);

        d.undo();
        expect(d.spec.parts.some((p) => p.id === 'p_side_l')).toBe(true);
        expect(d.spec.joints).toHaveLength(jointsBefore);
    });

    it('DuplicatePart adds an offset clone; undo removes it', () => {
        const d = doc();
        const src = d.spec.parts.find((p) => p.id === 'p_shelf_1')!;
        const newId = uniquePartId(d.spec, 'shelf_copy');

        d.execute(new DuplicatePart('p_shelf_1', newId));
        const clone = d.spec.parts.find((p) => p.id === newId)!;
        expect(clone).toBeDefined();
        // No gap → the default 2" offset past the source's length.
        expect(clone.transform.pos[0]).toBeCloseTo(src.transform.pos[0] + src.size.l + 2, 6);

        d.undo();
        expect(d.spec.parts.some((p) => p.id === newId)).toBe(false);
    });

    it('DuplicatePart lands the copy one width + gap away when a gap is given', () => {
        const d = doc();
        const src = d.spec.parts.find((p) => p.id === 'p_shelf_1')!;
        const newId = uniquePartId(d.spec, 'shelf_copy');

        d.execute(new DuplicatePart('p_shelf_1', newId, 0.25));
        const clone = d.spec.parts.find((p) => p.id === newId)!;
        // Copy sits a 1/4" gap past the source: centre = x + length + 0.25.
        expect(clone.transform.pos[0]).toBeCloseTo(src.transform.pos[0] + src.size.l + 0.25, 6);
    });

    it('ResizePart marks the part locked and undoes exactly', () => {
        const d = doc();
        const original = d.spec.parts.find((p) => p.id === 'p_top')!.size;

        d.execute(new ResizePart('p_top', { l: 40, w: 20 }));
        const edited = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(edited.size).toEqual({ l: 40, w: 20 });
        expect(edited.locked).toBe(true);

        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.size).toEqual(original);
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.locked).toBe(false);
    });

    it('SetJoints replaces joints and undoes exactly', () => {
        const d = doc();
        const before = d.spec.joints ?? [];
        d.execute(
            new SetJoints([{ type: 'dado', hostPartId: 'p_side_l', insertPartId: 'p_shelf_1', opRef: 0 }]),
        );
        expect(d.spec.joints).toHaveLength(1);
        d.undo();
        expect(d.spec.joints).toEqual(before);
    });

    it('SetMaterial edits sheet size and undoes exactly', () => {
        const d = doc();
        const before = d.spec.materials.find((m) => m.id === 'mat_bb18')!.sheetSize;
        d.execute(new SetMaterial('mat_bb18', { sheetSize: { l: 96, w: 48 } }));
        expect(d.spec.materials.find((m) => m.id === 'mat_bb18')!.sheetSize).toEqual({ l: 96, w: 48 });
        d.undo();
        expect(d.spec.materials.find((m) => m.id === 'mat_bb18')!.sheetSize).toEqual(before);
    });

    it('MovePart round-trips position and marks locked', () => {
        const d = doc();
        const original = [...d.spec.parts.find((p) => p.id === 'p_shelf_1')!.transform.pos];
        d.execute(new MovePart('p_shelf_1', [3, 20, -1]));
        const moved = d.spec.parts.find((p) => p.id === 'p_shelf_1')!;
        expect(moved.transform.pos).toEqual([3, 20, -1]);
        expect(moved.locked).toBe(true);
        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_shelf_1')!.transform.pos).toEqual(original);
    });

    it('RotatePart round-trips rotation', () => {
        const d = doc();
        d.execute(new RotatePart('p_back', [0, 0, 90]));
        expect(d.spec.parts.find((p) => p.id === 'p_back')!.transform.rot).toEqual([0, 0, 90]);
        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_back')!.transform.rot).toEqual([0, 0, 0]);
    });

    it('RotatePart stores an arbitrary (non-90°) angle and locks the part', () => {
        const d = doc();
        d.execute(new RotatePart('p_back', [0, 0, 15]));
        const part = d.spec.parts.find((p) => p.id === 'p_back')!;
        expect(part.transform.rot).toEqual([0, 0, 15]);
        expect(part.locked).toBe(true); // hand-tuned orientation
        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_back')!.transform.rot).toEqual([0, 0, 0]);
    });

    it('RenamePart renames without touching locked, and undoes exactly', () => {
        const d = doc();
        const before = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(before.locked).toBe(false);

        d.execute(new RenamePart('p_top', 'Crown Shelf'));
        const renamed = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(renamed.name).toBe('Crown Shelf');
        // A rename is organisational metadata, not a geometry hand-tune — no lock.
        expect(renamed.locked).toBe(false);

        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.name).toBe(before.name);
    });

    it('RenamePart is a no-op for an unknown part or an unchanged/invalid name', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new RenamePart('p_ghost', 'X'));
        d.execute(new RenamePart('p_top', d.spec.parts.find((p) => p.id === 'p_top')!.name));
        d.execute(new RenamePart('p_top', '   '));
        expect(JSON.stringify(d.spec)).toBe(before);
        // Undoing the (stack-recorded) no-ops must not corrupt anything either.
        d.undo();
        d.undo();
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('RenamePart trims whitespace and rejects names over 80 chars via the schema', () => {
        const d = doc();
        d.execute(new RenamePart('p_top', '  Crown Shelf  '));
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.name).toBe('Crown Shelf');
        expect(() => d.execute(new RenamePart('p_top', 'x'.repeat(81)))).toThrow();
    });

    it('executing a new command clears the redo stack', () => {
        const d = doc();
        d.execute(new RotatePart('p_back', [0, 0, 90]));
        d.undo();
        expect(d.canRedo).toBe(true);
        d.execute(new RotatePart('p_back', [0, 0, 15]));
        expect(d.canRedo).toBe(false);
    });
});

describe('EditorDocument selection & linting', () => {
    it('clears selection when the selected part is removed', () => {
        const d = doc();
        d.select('p_side_l');
        expect(d.selectedPart?.id).toBe('p_side_l');
        d.execute(new RemovePart('p_side_l'));
        expect(d.selectedId).toBeNull();
    });

    it('surfaces an oversized part through the linter after a resize', () => {
        const d = doc();
        expect(d.lint().filter((i) => i.severity === 'error')).toEqual([]);
        // Sheet is 60×60 and the side is grain-locked → 61×61 cannot fit.
        d.execute(new ResizePart('p_side_l', { l: 61, w: 61 }));
        const issues = d.issuesByPart().get('p_side_l') ?? [];
        expect(issues.some((i) => i.code === 'part.oversized')).toBe(true);
    });

    it('notifies subscribers on mutation', () => {
        const d = doc();
        let calls = 0;
        const unsub = d.subscribe(() => (calls += 1));
        d.execute(new RotatePart('p_back', [0, 0, 90]));
        d.select('p_back');
        expect(calls).toBe(2);
        unsub();
        d.undo();
        expect(calls).toBe(2);
    });
});

describe('EditorDocument group selection (handlePick)', () => {
    function groupedDoc() {
        const d = doc();
        d.execute(new GroupParts('g_sides', ['p_side_l', 'p_side_r'], 'Sides'));
        return d;
    }

    it('plain click on a grouped part selects the whole group', () => {
        const d = groupedDoc();
        d.handlePick('p_side_l', { additive: false });
        expect(d.selectedGroupId).toBe('g_sides');
        expect([...d.selectedIds].sort()).toEqual(['p_side_l', 'p_side_r']);
        expect(d.selectedId).toBeNull(); // no single selection during group selection
    });

    it('clicking a member of the selected group drills into it', () => {
        const d = groupedDoc();
        d.handlePick('p_side_l', { additive: false });
        d.handlePick('p_side_l', { additive: false });
        expect(d.selectedGroupId).toBeNull();
        expect(d.selectedId).toBe('p_side_l');
    });

    it('a drag-initiated pick never drills', () => {
        const d = groupedDoc();
        d.handlePick('p_side_l', { additive: false });
        d.handlePick('p_side_l', { additive: false, fromDrag: true });
        expect(d.selectedGroupId).toBe('g_sides');
        expect(d.selectedIds).toHaveLength(2);
    });

    it('additive clicks toggle ungrouped parts individually and groups atomically', () => {
        const d = groupedDoc();
        d.handlePick('p_top', { additive: false });
        d.handlePick('p_bottom', { additive: true });
        expect([...d.selectedIds].sort()).toEqual(['p_bottom', 'p_top']);
        expect(d.selectedId).toBeNull();

        d.handlePick('p_side_l', { additive: true }); // grouped → both members join
        expect(d.selectedIds).toHaveLength(4);
        d.handlePick('p_side_r', { additive: true }); // toggle the group back off
        expect(d.selectedIds).toHaveLength(2);

        d.handlePick('p_bottom', { additive: true });
        expect(d.selectedIds).toEqual(['p_top']);
    });

    it('clicking empty space clears; additive empty click keeps the selection', () => {
        const d = groupedDoc();
        d.handlePick('p_side_l', { additive: false });
        d.handlePick(null, { additive: true });
        expect(d.selectedIds).toHaveLength(2);
        d.handlePick(null, { additive: false });
        expect(d.selectedIds).toHaveLength(0);
        expect(d.selectedGroupId).toBeNull();
    });

    it('re-syncs group membership after undo/redo and survives ungroup as multi-select', () => {
        const d = groupedDoc();
        d.handlePick('p_side_l', { additive: false });

        d.execute(new UngroupParts('g_sides'));
        expect(d.selectedGroupId).toBeNull();
        expect(d.selectedIds).toHaveLength(2); // members survive as plain multi-select

        d.undo(); // group is back; selection stays plain (no phantom re-flavour)
        expect(d.selectedGroupId).toBeNull();
        expect(d.selectedIds).toHaveLength(2);
    });

    it('selectGroup selects members; select() stays literal', () => {
        const d = groupedDoc();
        d.selectGroup('g_sides');
        expect(d.selectedGroupId).toBe('g_sides');
        d.select('p_side_l');
        expect(d.selectedGroupId).toBeNull();
        expect(d.selectedId).toBe('p_side_l');
    });
});

describe('executeReplacingTop — a burst of nudges is one undo step', () => {
    function doc(): EditorDocument {
        return new EditorDocument(parseSpec(recordStand));
    }

    const posOf = (d: EditorDocument, id: string): number[] =>
        d.spec.parts.find((p) => p.id === id)!.transform.pos;

    it('replaces the top command instead of stacking a second one', () => {
        const d = doc();
        const start = [...posOf(d, 'p_top')];
        const depth = () => d.spec.parts.length; // unchanged; history depth checked via undo

        d.execute(new MoveParts(['p_top'], [0.125, 0, 0]));
        d.executeReplacingTop(new MoveParts(['p_top'], [0.25, 0, 0]));
        expect(posOf(d, 'p_top')[0]).toBeCloseTo(start[0] + 0.25, 9);

        // One undo returns the whole burst, not half of it.
        d.undo();
        expect(posOf(d, 'p_top')[0]).toBeCloseTo(start[0], 9);
        expect(d.canUndo).toBe(false);
        expect(depth()).toBeGreaterThan(0);
    });

    it('redoes the coalesced move as a single step', () => {
        const d = doc();
        const start = [...posOf(d, 'p_top')];
        d.execute(new MoveParts(['p_top'], [0.125, 0, 0]));
        d.executeReplacingTop(new MoveParts(['p_top'], [0.5, 0, 0]));
        d.undo();
        d.redo();
        expect(posOf(d, 'p_top')[0]).toBeCloseTo(start[0] + 0.5, 9);
    });

    it('behaves like execute when the history is empty', () => {
        const d = doc();
        const start = [...posOf(d, 'p_top')];
        d.executeReplacingTop(new MoveParts(['p_top'], [0.25, 0, 0]));
        expect(posOf(d, 'p_top')[0]).toBeCloseTo(start[0] + 0.25, 9);
        expect(d.canUndo).toBe(true);
    });

    it('leaves the document and the history untouched when the replacement is invalid', () => {
        const d = doc();
        d.execute(new MoveParts(['p_top'], [0.125, 0, 0]));
        const after = [...posOf(d, 'p_top')];

        // Past the schema's ±240 workspace bound.
        expect(() => d.executeReplacingTop(new MoveParts(['p_top'], [10_000, 0, 0]))).toThrow();
        expect(posOf(d, 'p_top')).toEqual(after);

        // The first move is still the top of the stack, and still undoable.
        d.undo();
        expect(d.canUndo).toBe(false);
    });
});
