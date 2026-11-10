import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { RecenterAssembly, MovePart } from '@/engine/commands';
import { aabbFromPart } from '@/engine/snapping';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

/** The record stand shifted well off the grid centre (and lifted off the floor). */
function offCenterDoc(dx = 40, dy = 6, dz = -25): EditorDocument {
    const base = parseSpec(recordStand);
    const spec: Spec = {
        ...base,
        parts: base.parts.map((p) => ({
            ...p,
            transform: {
                ...p.transform,
                pos: [p.transform.pos[0] + dx, p.transform.pos[1] + dy, p.transform.pos[2] + dz],
            },
        })),
    };
    return new EditorDocument(parseSpec(spec));
}

describe('RecenterAssembly', () => {
    it('translates every part by one shared delta so the assembly centres on the origin', () => {
        const d = offCenterDoc();
        const before = d.spec.parts.map((p) => [...p.transform.pos]);

        d.execute(new RecenterAssembly());

        const after = d.spec.parts.map((p) => [...p.transform.pos]);
        // One rigid translation: every part moved by the same vector.
        const delta = [after[0][0] - before[0][0], after[0][1] - before[0][1], after[0][2] - before[0][2]];
        for (let i = 1; i < after.length; i += 1) {
            expect(after[i][0] - before[i][0]).toBeCloseTo(delta[0], 9);
            expect(after[i][1] - before[i][1]).toBeCloseTo(delta[1], 9);
            expect(after[i][2] - before[i][2]).toBeCloseTo(delta[2], 9);
        }
        // The shift we applied was (40, 6, -25); recentring must undo it exactly, because
        // the fixture is already centred and floor-resting in its authored form.
        expect(delta[0]).toBeCloseTo(-40, 6);
        expect(delta[1]).toBeCloseTo(-6, 6);
        expect(delta[2]).toBeCloseTo(25, 6);
    });

    it('does not mark parts as locked (a rigid normalization is not a hand-tune)', () => {
        const d = offCenterDoc();
        const lockedBefore = d.spec.parts.map((p) => p.locked);
        d.execute(new RecenterAssembly());
        expect(d.spec.parts.map((p) => p.locked)).toEqual(lockedBefore);
    });

    it('is a no-op when the assembly is already centred', () => {
        const d = new EditorDocument(parseSpec(recordStand));
        // The authored fixture is centred; recentring must not create an undo entry.
        const before = JSON.stringify(d.spec);
        d.execute(new RecenterAssembly());
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('undo restores the original positions byte-exactly', () => {
        const d = offCenterDoc();
        const before = JSON.stringify(d.spec);
        d.execute(new RecenterAssembly());
        expect(JSON.stringify(d.spec)).not.toBe(before);
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('undo → redo is byte-deterministic', () => {
        const d = offCenterDoc();
        d.execute(new RecenterAssembly());
        const after = JSON.stringify(d.spec);
        d.undo();
        d.redo();
        expect(JSON.stringify(d.spec)).toBe(after);
    });

    it('rests a sunken assembly back onto the ground plane', () => {
        // Shift down only: dy = -3 buries the stand below the grid.
        const d = offCenterDoc(0, -3, 0);
        d.execute(new RecenterAssembly());
        // The lowest world face (rotation-aware) must come back to y = 0.
        const lowest = Math.min(
            ...d.spec.parts.map((p) => {
                const m = d.spec.materials.find((mm) => mm.id === p.materialId)!;
                return aabbFromPart(p, m.thickness).min[1];
            }),
        );
        expect(lowest).toBeCloseTo(0, 6);
    });

    it('recenters after an off-axis single-part move too', () => {
        const d = new EditorDocument(parseSpec(recordStand));
        // Drag one part far away: the union AABB centre shifts, so recentring moves ALL
        // parts (rigidly) to re-balance around the origin.
        d.execute(new MovePart('p_top', [60, 33.6455, 0]));
        d.execute(new RecenterAssembly());
        const xs = d.spec.parts.map((p) => p.transform.pos[0]);
        expect(Math.min(...xs)).toBeLessThan(0);
        expect(Math.max(...xs)).toBeGreaterThan(0);
    });
});
