import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EditorDocument } from '@/engine/EditorDocument';
import {
    GroupParts,
    UngroupParts,
    MoveParts,
    RotateParts,
    RemoveParts,
    RemovePart,
    DuplicateGroup,
    uniqueGroupId,
} from '@/engine/commands';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

/** record-stand with the two sides already grouped. */
function groupedDoc(): EditorDocument {
    const d = doc();
    d.execute(new GroupParts('g_sides', ['p_side_l', 'p_side_r'], 'Sides'));
    return d;
}

function partOf(d: EditorDocument, id: string) {
    return d.spec.parts.find((p) => p.id === id)!;
}

describe('GroupParts / UngroupParts', () => {
    it('creates a named group and undoes exactly', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new GroupParts('g_sides', ['p_side_l', 'p_side_r'], 'Sides'));
        expect(d.spec.groups).toEqual([{ id: 'g_sides', name: 'Sides', partIds: ['p_side_l', 'p_side_r'] }]);
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('refuses to group a part that is already grouped (flat groups)', () => {
        const d = groupedDoc();
        const before = JSON.stringify(d.spec);
        d.execute(new GroupParts('g_other', ['p_side_l', 'p_top']));
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('is a no-op when any member id is unknown', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new GroupParts('g_x', ['p_top', 'p_ghost']));
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('rejects a singleton group at the schema gate', () => {
        const d = doc();
        expect(() => d.execute(new GroupParts('g_solo', ['p_top']))).toThrow();
        expect(d.canUndo).toBe(false);
    });

    it('ungroup removes the group and restores it at its index on undo', () => {
        const d = groupedDoc();
        const before = JSON.stringify(d.spec);
        d.execute(new UngroupParts('g_sides'));
        expect(d.spec.groups ?? []).toHaveLength(0);
        // Parts themselves are untouched.
        expect(d.spec.parts).toHaveLength(6);
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });
});

describe('MoveParts', () => {
    it('moves every part by the delta in ONE undo step and locks them', () => {
        const d = doc();
        const l0 = [...partOf(d, 'p_side_l').transform.pos];
        const r0 = [...partOf(d, 'p_side_r').transform.pos];

        d.execute(new MoveParts(['p_side_l', 'p_side_r'], [2, 0, -3]));
        expect(partOf(d, 'p_side_l').transform.pos).toEqual([l0[0] + 2, l0[1], l0[2] - 3]);
        expect(partOf(d, 'p_side_r').transform.pos).toEqual([r0[0] + 2, r0[1], r0[2] - 3]);
        expect(partOf(d, 'p_side_l').locked).toBe(true);

        d.undo(); // single undo restores both
        expect(partOf(d, 'p_side_l').transform.pos).toEqual(l0);
        expect(partOf(d, 'p_side_r').transform.pos).toEqual(r0);
        expect(partOf(d, 'p_side_l').locked).toBe(false);
        expect(d.canUndo).toBe(false);
    });

    it('works for a single part (drag-commit convergence)', () => {
        const d = doc();
        const p0 = [...partOf(d, 'p_top').transform.pos];
        d.execute(new MoveParts(['p_top'], [0, 1, 0]));
        expect(partOf(d, 'p_top').transform.pos).toEqual([p0[0], p0[1] + 1, p0[2]]);
    });
});

describe('RotateParts', () => {
    it('rotates positions 90° about the cohort centre (hand-computed)', () => {
        const d = doc();
        const l0 = partOf(d, 'p_side_l').transform.pos;
        const r0 = partOf(d, 'p_side_r').transform.pos;
        // Centre of the two-part cohort AABB along X is midway between them.
        d.execute(new RotateParts(['p_side_l', 'p_side_r'], 1)); // about world Y

        const l1 = partOf(d, 'p_side_l').transform.pos;
        const r1 = partOf(d, 'p_side_r').transform.pos;
        // +90° about Y maps (x, z) → (z, -x) relative to the centre; y unchanged.
        expect(l1[1]).toBeCloseTo(l0[1], 6);
        expect(r1[1]).toBeCloseTo(r0[1], 6);
        // The two parts must remain the same distance apart.
        const dist = (a: readonly number[], b: readonly number[]) =>
            Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(dist(l1, r1)).toBeCloseTo(dist(l0, r0), 6);
    });

    it('composes orientation exactly as THREE quaternions do, staying within ±180', () => {
        const d = doc();
        // Pre-rotate a part to a messy orientation first.
        const spec: Spec = {
            ...d.spec,
            parts: d.spec.parts.map((p) =>
                p.id === 'p_top' ? { ...p, transform: { ...p.transform, rot: [90, 0, 45] } } : p,
            ),
        };
        const d2 = new EditorDocument(parseSpec(spec));
        d2.execute(new RotateParts(['p_top', 'p_bottom'], 2)); // about world Z

        const rot = partOf(d2, 'p_top').transform.rot;
        const DEG = Math.PI / 180;
        const expected = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
            .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(90 * DEG, 0, 45 * DEG, 'XYZ')));
        const got = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'),
        );
        // Same rotation (allow q ≡ -q).
        expect(Math.abs(expected.dot(got))).toBeCloseTo(1, 6);
        for (const component of rot) {
            expect(component).toBeGreaterThanOrEqual(-180);
            expect(component).toBeLessThanOrEqual(180);
        }
    });

    it('4 × 90° returns to the start (within float noise)', () => {
        const d = groupedDoc();
        const before = d.spec.parts.map((p) => ({
            pos: [...p.transform.pos],
            rot: [...p.transform.rot],
        }));
        for (let i = 0; i < 4; i += 1) {
            d.execute(new RotateParts(['p_side_l', 'p_side_r'], 1));
        }
        d.spec.parts.forEach((p, i) => {
            p.transform.pos.forEach((v, axis) => expect(v).toBeCloseTo(before[i].pos[axis], 4));
            const q0 = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                    ...(before[i].rot.map((x) => (x * Math.PI) / 180) as [number, number, number]),
                    'XYZ',
                ),
            );
            const q1 = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                    ...(p.transform.rot.map((x) => (x * Math.PI) / 180) as [number, number, number]),
                    'XYZ',
                ),
            );
            expect(Math.abs(q0.dot(q1))).toBeCloseTo(1, 4);
        });
    });

    it('undo restores positions, rotations, and locked exactly', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new RotateParts(['p_side_l', 'p_side_r'], 0));
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('defaults to 90° when no angle is given (back-compat)', () => {
        const dImplicit = doc();
        const dExplicit = doc();
        dImplicit.execute(new RotateParts(['p_side_l', 'p_side_r'], 1));
        dExplicit.execute(new RotateParts(['p_side_l', 'p_side_r'], 1, 90));
        expect(JSON.stringify(dImplicit.spec.parts)).toBe(JSON.stringify(dExplicit.spec.parts));
    });

    it('rotates by an arbitrary angle (15°) about the cohort centre', () => {
        const d = doc();
        const l0 = partOf(d, 'p_side_l').transform.pos;
        const r0 = partOf(d, 'p_side_r').transform.pos;
        d.execute(new RotateParts(['p_side_l', 'p_side_r'], 1, 15)); // 15° about world Y

        // Orientation: composing 15° about Y onto each part matches THREE's quaternion.
        const DEG = Math.PI / 180;
        const rot = partOf(d, 'p_side_l').transform.rot;
        const before = partOf(doc(), 'p_side_l').transform.rot;
        const expected = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 15 * DEG)
            .multiply(
                new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(before[0] * DEG, before[1] * DEG, before[2] * DEG, 'XYZ'),
                ),
            );
        const got = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'),
        );
        expect(Math.abs(expected.dot(got))).toBeCloseTo(1, 6);

        // Rigid: the two parts stay the same distance apart.
        const l1 = partOf(d, 'p_side_l').transform.pos;
        const r1 = partOf(d, 'p_side_r').transform.pos;
        const dist = (a: readonly number[], b: readonly number[]) =>
            Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(dist(l1, r1)).toBeCloseTo(dist(l0, r0), 6);
    });
});

describe('RemoveParts', () => {
    it('removes members, their joints, and the group in one step; undo is order-exact', () => {
        const d = groupedDoc();
        const before = JSON.stringify(d.spec);

        d.execute(new RemoveParts(['p_side_l', 'p_side_r']));
        expect(d.spec.parts).toHaveLength(4);
        // Every joint that referenced a removed side goes with it; what's left never named one.
        expect(
            (d.spec.joints ?? []).filter(
                (j) =>
                    ['p_side_l', 'p_side_r'].includes(j.hostPartId) ||
                    ['p_side_l', 'p_side_r'].includes(j.insertPartId),
            ),
        ).toHaveLength(0);
        expect(d.spec.groups ?? []).toHaveLength(0);

        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });

    it('shrinks (not dissolves) a 3-member group when one member is removed', () => {
        const d = doc();
        d.execute(new GroupParts('g_three', ['p_top', 'p_bottom', 'p_back'], 'Carcass'));
        d.execute(new RemoveParts(['p_back']));
        expect(d.spec.groups?.[0].partIds).toEqual(['p_top', 'p_bottom']);
        d.undo();
        expect(d.spec.groups?.[0].partIds).toEqual(['p_top', 'p_bottom', 'p_back']);
    });
});

describe('RemovePart (single) group pruning', () => {
    it('dissolves a 2-member group when one member is deleted, and undo restores it', () => {
        const d = groupedDoc();
        const before = JSON.stringify(d.spec);
        d.execute(new RemovePart('p_side_l'));
        expect(d.spec.groups ?? []).toHaveLength(0);
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
    });
});

describe('DuplicateGroup', () => {
    it('clones every member with fresh ids, offset together, into a new group', () => {
        const d = groupedDoc();
        d.execute(new DuplicateGroup('g_sides'));

        expect(d.spec.parts).toHaveLength(8);
        expect(d.spec.groups).toHaveLength(2);
        const clone = d.spec.groups![1];
        expect(clone.partIds).toHaveLength(2);
        expect(clone.name).toBe('Sides copy');

        // Shared offset: the clones keep their relative placement.
        const l = partOf(d, 'p_side_l').transform.pos;
        const r = partOf(d, 'p_side_r').transform.pos;
        const cl = partOf(d, clone.partIds[0]).transform.pos;
        const cr = partOf(d, clone.partIds[1]).transform.pos;
        expect(cr[0] - cl[0]).toBeCloseTo(r[0] - l[0], 6);
        expect(cl[1]).toBeCloseTo(l[1], 6);
        expect(cl[0]).toBeGreaterThan(l[0]); // offset in +X
    });

    it('remaps intra-group joints to the cloned ids and drops boundary joints', () => {
        const d = doc();
        // Group a side with the shelf that sits in its dado: that joint is intra-group.
        d.execute(new GroupParts('g_pair', ['p_side_l', 'p_shelf_1']));
        const jointsBefore = d.spec.joints!.length; // 2 in the fixture

        d.execute(new DuplicateGroup('g_pair'));
        const cloneGroup = d.spec.groups![1];
        const [c1, c2] = cloneGroup.partIds;

        // One new joint: the intra-group dado (side_l ↔ shelf). The boundary joint
        // (side_r ↔ shelf) is NOT cloned.
        expect(d.spec.joints).toHaveLength(jointsBefore + 1);
        const cloned = d.spec.joints!.find((j) => cloneGroup.partIds.includes(j.hostPartId));
        expect(cloned).toBeDefined();
        expect([c1, c2]).toContain(cloned!.hostPartId);
        expect([c1, c2]).toContain(cloned!.insertPartId);
        expect(cloned!.opRef).toBe(0);
    });

    it('allocates non-colliding ids even when copy names already exist', () => {
        const d = groupedDoc();
        d.execute(new DuplicateGroup('g_sides'));
        d.execute(new DuplicateGroup('g_sides')); // second copy must not collide with the first
        const ids = d.spec.parts.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(d.spec.groups).toHaveLength(3);
    });

    it('undo removes clones, joints, and the new group; redo is byte-deterministic', () => {
        const d = doc();
        d.execute(new GroupParts('g_pair', ['p_side_l', 'p_shelf_1']));
        const before = JSON.stringify(d.spec);

        d.execute(new DuplicateGroup('g_pair'));
        const after = JSON.stringify(d.spec);
        d.undo();
        expect(JSON.stringify(d.spec)).toBe(before);
        d.redo();
        expect(JSON.stringify(d.spec)).toBe(after);
    });

    it('clones an associated door movable and remaps its parts', () => {
        const d = doc();
        d.execute(new GroupParts('g_pair', ['p_side_l', 'p_shelf_1'], 'Door Group'));
        // Attach a door movable covering this group
        const specWithDoor: Spec = {
            ...d.spec,
            movables: [
                {
                    id: 'mv_group_door',
                    kind: 'door',
                    name: 'Door Group',
                    partIds: ['p_side_l', 'p_shelf_1'],
                    panelPartId: 'p_side_l',
                    hingeEdge: 'w0',
                    style: 'overlay',
                },
            ],
        };
        const d2 = new EditorDocument(parseSpec(specWithDoor));
        d2.execute(new DuplicateGroup('g_pair'));

        expect(d2.spec.groups).toHaveLength(2);
        expect(d2.spec.movables).toHaveLength(2);

        const cloneMovable = d2.spec.movables![1];
        const cloneGroup = d2.spec.groups![1];
        expect(cloneMovable.kind).toBe('door');
        expect(cloneMovable.partIds).toEqual(cloneGroup.partIds);
        expect(cloneMovable.panelPartId).toBe(cloneGroup.partIds[0]);

        // Undo removes the cloned movable
        d2.undo();
        expect(d2.spec.movables).toHaveLength(1);

        // Redo restores it
        d2.redo();
        expect(d2.spec.movables).toHaveLength(2);
    });

    it('respects the 40-char id cap when cloning long ids', () => {
        const d = doc();
        const longId = 'p_' + 'a'.repeat(37); // 39 chars, near the cap
        const src = partOf(d, 'p_top');
        const spec: Spec = {
            ...d.spec,
            parts: [
                ...d.spec.parts,
                {
                    ...src,
                    id: longId,
                    name: 'Long',
                    transform: { ...src.transform, pos: [0, src.transform.pos[1] + 1, 0] },
                },
            ],
        };
        const d2 = new EditorDocument(parseSpec(spec));
        d2.execute(new GroupParts('g_long', [longId, 'p_top']));
        d2.execute(new DuplicateGroup('g_long'));
        for (const p of d2.spec.parts) {
            expect(p.id.length).toBeLessThanOrEqual(40);
        }
        expect(new Set(d2.spec.parts.map((p) => p.id)).size).toBe(d2.spec.parts.length);
    });
});

describe('uniqueGroupId', () => {
    it('generates g_-prefixed ids that avoid existing groups', () => {
        const d = groupedDoc();
        const id = uniqueGroupId(d.spec, 'sides');
        expect(id).toMatch(/^g_/);
        expect(id).not.toBe('g_sides');
    });
});

describe('movable cascade on delete (spec 1.12)', () => {
    /** The record stand with its top declared a one-panel door and a two-part drawer. */
    function doored(): EditorDocument {
        const base = parseSpec(recordStand);
        return new EditorDocument(
            parseSpec({
                ...base,
                movables: [
                    {
                        id: 'mv_door',
                        kind: 'door',
                        partIds: ['p_top'],
                        panelPartId: 'p_top',
                        hingeEdge: 'w0',
                        style: 'overlay',
                    },
                    {
                        id: 'mv_drawer',
                        kind: 'drawer',
                        partIds: ['p_shelf_1', 'p_bottom'],
                        frontPartId: 'p_shelf_1',
                        style: 'inset',
                    },
                ],
            } as unknown as Spec),
        );
    }

    it('dissolves a movable when its anchor is deleted', () => {
        const d = doored();
        d.execute(new RemovePart('p_top'));
        expect((d.spec.movables ?? []).map((m) => m.id)).toEqual(['mv_drawer']);
    });

    it('shrinks a movable when a non-anchor member is deleted', () => {
        const d = doored();
        d.execute(new RemovePart('p_bottom'));
        const drawer = (d.spec.movables ?? []).find((m) => m.id === 'mv_drawer')!;
        expect(drawer.partIds).toEqual(['p_shelf_1']);
    });

    it('restores dissolved and shrunk movables exactly on undo', () => {
        const d = doored();
        const before = JSON.stringify(d.spec.movables);
        d.execute(new RemoveParts(['p_top', 'p_bottom']));
        expect((d.spec.movables ?? []).map((m) => m.id)).toEqual(['mv_drawer']);
        expect((d.spec.movables ?? [])[0].partIds).toEqual(['p_shelf_1']);

        d.undo();
        expect(JSON.stringify(d.spec.movables)).toBe(before);
    });

    it('leaves a movable alone when an unrelated part is deleted', () => {
        const d = doored();
        const before = JSON.stringify(d.spec.movables);
        d.execute(new RemovePart('p_back'));
        expect(JSON.stringify(d.spec.movables)).toBe(before);
    });
});
