/**
 * Undo coverage for `SetPartRoundStock` (build-plan Phase 1d). It shipped without any, and it is
 * the command with the most to put back: it rewrites a part's material, width and locked flag, and
 * may add a material to the spec on the way.
 */
import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { SetPartRoundStock, AddOp, DuplicatePart } from '@/engine/commands';
import { parseSpec } from '@/spec';
import type { Spec, Part, Material } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

function partOf(d: EditorDocument, id: string): Part {
    return d.spec.parts.find((p) => p.id === id)!;
}

function materialOf(spec: Spec, id: string): Material | undefined {
    return spec.materials.find((m) => m.id === id);
}

/** The fixture's one part with no ops — round stock refuses parts that carry any. */
const PLAIN = 'p_shelf_1';

/** A second op-free part, since the fixture only ships one. Returns the new part's id. */
function duplicatePlain(d: EditorDocument): string {
    d.execute(new DuplicatePart(PLAIN, 'p_shelf_2'));
    return 'p_shelf_2';
}

describe('SetPartRoundStock', () => {
    it('points the part at round stock and takes its width from the diameter', () => {
        const d = doc();
        d.execute(new SetPartRoundStock(PLAIN, '3/4"'));

        const part = partOf(d, PLAIN);
        const material = materialOf(d.spec, part.materialId)!;
        expect(material.type).toBe('round');
        expect(material.thickness).toBe(0.75);
        // A dowel blank is d x d x length, and the linter enforces it (`part.round-width`).
        expect(part.size.w).toBe(0.75);
        expect(part.size.l).toBe(37.082);
        // Hand-picked stock counts as a hand edit (hard rule 10).
        expect(part.locked).toBe(true);
    });

    it('restores material, size and locked exactly, and removes the material it created', () => {
        const d = doc();
        const before = d.spec;
        const materialsBefore = before.materials.length;

        d.execute(new SetPartRoundStock(PLAIN, '1/2"'));
        expect(d.spec.materials).toHaveLength(materialsBefore + 1);

        d.undo();
        expect(d.spec.materials).toHaveLength(materialsBefore);
        expect(partOf(d, PLAIN)).toEqual(before.parts.find((p) => p.id === PLAIN));
        expect(d.spec.materials).toEqual(before.materials);
    });

    it('reuses an existing round material of the same diameter instead of adding a second', () => {
        const d = doc();
        const other = duplicatePlain(d);
        d.execute(new SetPartRoundStock(PLAIN, '3/4"'));
        const created = partOf(d, PLAIN).materialId;
        const count = d.spec.materials.length;

        // A second part onto the same stock must land on the same material.
        d.execute(new SetPartRoundStock(other, '3/4"'));
        expect(d.spec.materials).toHaveLength(count);
        expect(partOf(d, other).materialId).toBe(created);
    });

    it('leaves a reused material in place when only the second part is undone', () => {
        const d = doc();
        const other = duplicatePlain(d);
        d.execute(new SetPartRoundStock(PLAIN, '3/4"'));
        const created = partOf(d, PLAIN).materialId;
        d.execute(new SetPartRoundStock(other, '3/4"'));
        const count = d.spec.materials.length;

        d.undo();
        // The first part still uses it, so undoing the second must not delete the material.
        expect(d.spec.materials).toHaveLength(count);
        expect(partOf(d, PLAIN).materialId).toBe(created);
        expect(materialOf(d.spec, created)).toBeDefined();
    });

    it('refuses a part carrying ops rather than dropping its joinery', () => {
        const d = doc();
        d.execute(
            new AddOp(PLAIN, {
                type: 'dado',
                face: 'front',
                axis: 'l',
                offset: 9,
                width: 0.709,
                depth: 0.25,
            }),
        );
        const afterOp = d.spec;

        d.execute(new SetPartRoundStock(PLAIN, '3/4"'));
        // §3.1 faces and edges do not exist on a cylinder; declining beats silently discarding.
        expect(d.spec).toEqual(afterOp);
    });

    it('is a no-op for an unknown part, an unknown size, and a repeat of the same stock', () => {
        const d = doc();
        const before = d.spec;

        d.execute(new SetPartRoundStock('p_ghost', '3/4"'));
        expect(d.spec).toEqual(before);

        d.execute(new SetPartRoundStock(PLAIN, 'not-a-dowel'));
        expect(d.spec).toEqual(before);

        d.execute(new SetPartRoundStock(PLAIN, '3/4"'));
        const applied = d.spec;
        d.execute(new SetPartRoundStock(PLAIN, '3/4"'));
        expect(d.spec).toEqual(applied);
    });

    it('survives a redo, because the plan is captured once and reused', () => {
        const d = doc();
        const before = d.spec;

        d.execute(new SetPartRoundStock(PLAIN, '1"'));
        const applied = d.spec;

        d.undo();
        expect(d.spec).toEqual(before);

        d.redo();
        expect(d.spec).toEqual(applied);
    });
});
