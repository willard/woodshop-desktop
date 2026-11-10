import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { SetPartSpecies } from '@/engine/commands';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

// record-stand: one material (mat_bb18, Baltic Birch 18mm sheet), six parts on it.
function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

function materialOf(d: EditorDocument, partId: string) {
    const part = d.spec.parts.find((p) => p.id === partId)!;
    return d.spec.materials.find((m) => m.id === part.materialId)!;
}

describe('SetPartSpecies', () => {
    it('clones the current material with the species and repoints the part', () => {
        const d = doc();
        const before = materialOf(d, 'p_top');

        d.execute(new SetPartSpecies('p_top', 'walnut'));

        const after = materialOf(d, 'p_top');
        expect(after.id).not.toBe(before.id);
        expect(after.species).toBe('walnut');
        expect(after.name).toMatch(/walnut/i);
        // Stock characteristics and costs carry over unchanged.
        expect(after.thickness).toBe(before.thickness);
        expect(after.type).toBe(before.type);
        expect(after.sheetSize).toEqual(before.sheetSize);
        expect(after.costPerSheet).toBe(before.costPerSheet);
        expect(d.spec.materials).toHaveLength(2);
        // The species choice is a hand-tune (hard rule 10).
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.locked).toBe(true);
        // Other parts stay on the original material.
        expect(materialOf(d, 'p_side_l').id).toBe(before.id);
    });

    it('reuses an existing material with the same stock and species', () => {
        const d = doc();
        d.execute(new SetPartSpecies('p_top', 'walnut'));
        expect(d.spec.materials).toHaveLength(2);

        d.execute(new SetPartSpecies('p_bottom', 'walnut'));
        expect(d.spec.materials).toHaveLength(2); // no second clone
        expect(materialOf(d, 'p_bottom').id).toBe(materialOf(d, 'p_top').id);
    });

    it('is a no-op when the part already has that species', () => {
        const d = doc();
        d.execute(new SetPartSpecies('p_top', 'oak'));
        const before = JSON.stringify(d.spec);
        d.execute(new SetPartSpecies('p_top', 'oak'));
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('undo restores the part and removes a created material', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new SetPartSpecies('p_top', 'cherry'));
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('undo keeps a reused (pre-existing) material', () => {
        const d = doc();
        d.execute(new SetPartSpecies('p_top', 'walnut'));
        d.execute(new SetPartSpecies('p_bottom', 'walnut'));
        d.undo(); // p_bottom back to birch
        expect(d.spec.materials).toHaveLength(2); // walnut clone still owned by p_top
        expect(materialOf(d, 'p_bottom').species).toBeUndefined();
        expect(materialOf(d, 'p_top').species).toBe('walnut');
    });

    it('execute → undo → redo is byte-deterministic', () => {
        const d = doc();
        d.execute(new SetPartSpecies('p_top', 'maple'));
        const after = JSON.stringify(d.spec);
        d.undo();
        d.redo();
        expect(JSON.stringify(d.spec)).toBe(after);
    });

    it('switching species again does not strand a doubled prefix in the name', () => {
        const d = doc();
        d.execute(new SetPartSpecies('p_top', 'walnut'));
        d.execute(new SetPartSpecies('p_top', 'cherry'));
        const name = materialOf(d, 'p_top').name;
        expect(name).toMatch(/cherry/i);
        expect(name).not.toMatch(/walnut/i);
        expect(name.length).toBeLessThanOrEqual(80);
    });

    it('is a no-op for an unknown part', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new SetPartSpecies('p_ghost', 'pine'));
        expect(JSON.stringify(d.spec)).toBe(before);
    });
});
