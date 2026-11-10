import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { SetPartStock, SetPartSpecies } from '@/engine/commands';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

// The record stand is all sheet stock (mat_bb18), so picking any lumber size must create
// a new lumber material rather than matching one.
function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

function partOf(d: EditorDocument, id: string) {
    return d.spec.parts.find((p) => p.id === id)!;
}

describe('SetPartStock', () => {
    it('creates a lumber material with the nominal size and repoints the part', () => {
        const d = doc();
        const before = d.spec.materials.length;

        d.execute(new SetPartStock('p_shelf_1', '2x4'));
        const part = partOf(d, 'p_shelf_1');
        const material = d.spec.materials.find((m) => m.id === part.materialId)!;

        expect(d.spec.materials).toHaveLength(before + 1);
        expect(material.type).toBe('lumber');
        expect(material.thickness).toBe(1.5);
        expect(material.stockWidth).toBe(3.5);
        expect(material.sheetSize).toBeUndefined();
        expect(material.name).toContain('2x4');
        expect(part.locked).toBe(true);
    });

    it('sets the part width to the stock width, keeping its length', () => {
        const d = doc();
        const lengthBefore = partOf(d, 'p_shelf_1').size.l;
        d.execute(new SetPartStock('p_shelf_1', '2x4'));
        expect(partOf(d, 'p_shelf_1').size).toEqual({ l: lengthBefore, w: 3.5 });
    });

    it('reuses an existing material with the same lumber dims and species', () => {
        const d = doc();
        d.execute(new SetPartStock('p_shelf_1', '2x2'));
        const count = d.spec.materials.length;

        d.execute(new SetPartStock('p_back', '2x2'));
        expect(d.spec.materials).toHaveLength(count); // matched, not re-created
        expect(partOf(d, 'p_back').materialId).toBe(partOf(d, 'p_shelf_1').materialId);
    });

    it('preserves the species of the part it converts', () => {
        const d = doc();
        d.execute(new SetPartSpecies('p_shelf_1', 'walnut'));
        d.execute(new SetPartStock('p_shelf_1', '2x6'));
        const part = partOf(d, 'p_shelf_1');
        const material = d.spec.materials.find((m) => m.id === part.materialId)!;
        expect(material.species).toBe('walnut');
        expect(material.name).toMatch(/walnut/i);
    });

    it('undo restores materialId, size, locked, and removes a created material', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new SetPartStock('p_shelf_1', '4x4'));
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('redo is byte-deterministic', () => {
        const d = doc();
        d.execute(new SetPartStock('p_shelf_1', '2x10'));
        const after = JSON.stringify(d.spec);
        d.undo();
        d.redo();
        expect(JSON.stringify(d.spec)).toBe(after);
    });

    it('is a no-op for an unknown nominal or part', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new SetPartStock('p_shelf_1', '3x17'));
        d.execute(new SetPartStock('p_ghost', '2x4'));
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('is a no-op when the part is already that stock', () => {
        const d = doc();
        d.execute(new SetPartStock('p_shelf_1', '2x4'));
        const count = d.spec.materials.length;
        const snapshot = JSON.stringify(d.spec);
        d.execute(new SetPartStock('p_shelf_1', '2x4'));
        expect(d.spec.materials).toHaveLength(count);
        expect(JSON.stringify(d.spec)).toBe(snapshot);
    });
});
