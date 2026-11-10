import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { DeleteMaterial } from '@/engine/commands';
import { parseSpec } from '@/spec';
import type { Material, Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

/** A stray material nothing is made of — the litter add_material used to leave behind for good. */
const stray: Material = {
    id: 'mat_stray',
    type: 'sheet',
    name: 'MDF 3/4" (typo)',
    thickness: 0.75,
    sheetSize: { l: 96, w: 48 },
    grain: true,
} as Material;

/** The stray dropped in the MIDDLE, so a restore that appends instead of splicing is visible. */
function docWithStray(): EditorDocument {
    const spec = parseSpec(recordStand);
    const withStray: Spec = { ...spec, materials: [stray, ...spec.materials] };

    return new EditorDocument(withStray);
}

describe('DeleteMaterial', () => {
    it('removes a material nothing is using', () => {
        const d = docWithStray();

        d.execute(new DeleteMaterial('mat_stray'));

        expect(d.spec.materials.map((m) => m.id)).not.toContain('mat_stray');
    });

    it('puts it back where it was on undo, not on the end', () => {
        const d = docWithStray();
        const before = d.spec.materials.map((m) => m.id);

        d.execute(new DeleteMaterial('mat_stray'));
        d.undo();

        // Cut-list sections follow material order, so a restore in a different place would read
        // as something other than an undo.
        expect(d.spec.materials.map((m) => m.id)).toEqual(before);
    });

    it('refuses while a part is still made of it', () => {
        const d = docWithStray();
        const inUse = d.spec.parts[0].materialId;

        d.execute(new DeleteMaterial(inUse));

        expect(d.spec.materials.map((m) => m.id)).toContain(inUse);
        expect(d.spec.parts.every((p) => d.spec.materials.some((m) => m.id === p.materialId))).toBe(true);
    });

    it('refuses to empty the material list', () => {
        // Driven straight at the command: a loadable spec always has a part (the schema requires
        // one), so its last material is always in use — this guard only ever fires as defence.
        const spec = parseSpec(recordStand);
        const bare = { ...spec, materials: [spec.materials[0]], parts: [] } as unknown as Spec;

        const after = new DeleteMaterial(spec.materials[0].id).do(bare);

        expect(after.materials).toHaveLength(1);
    });

    it('leaves an unknown id alone', () => {
        const d = docWithStray();
        const before = d.spec.materials.length;

        d.execute(new DeleteMaterial('mat_ghost'));

        expect(d.spec.materials).toHaveLength(before);
    });
});
