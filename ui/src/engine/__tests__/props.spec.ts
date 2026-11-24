import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { findItem } from '@/hardware/catalog';
import { buildPropGeometry, buildShapeGeometry } from '@/engine/geometry/propModels';
import { buildPropsGroup } from '@/engine/buildScene';
import { AddProp, RemoveProp, UpdateProp, uniquePropId } from '@/engine';
import { hangHeight, restOn, restingAs } from '@/spec/props';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec';

const TOTE = 'prop.tote-hdx-27gal';

/** Two 2x3 runners on edge, running front to back, 17" apart inside (the garage tote rack's). */
function rack(): Spec {
    const runner = (id: string, x: number) => ({
        id,
        name: id,
        materialId: 'm23',
        size: { l: 30, w: 2.5 },
        transform: { pos: [x, 16.25, -1.5], rot: [0, 90, 0] },
    });
    return parseSpec({
        specVersion: '1.22',
        units: 'in',
        name: 'Rack',
        materials: [
            { id: 'm23', type: 'lumber', name: '2x3', thickness: 1.5, stockLengths: [96], stockWidth: 2.5 },
        ],
        parts: [runner('p_left', -36.5), runner('p_right', -18)],
    });
}

function bounds(geometries: THREE.BufferGeometry[]): THREE.Box3 {
    const box = new THREE.Box3();
    for (const g of geometries) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
    }
    return box;
}

describe('props', () => {
    it('draws the HDX tote at its catalog size, the lid on top', () => {
        const { body, accent } = buildPropGeometry(findItem(TOTE)!.model);
        const all = bounds([...body, ...accent]);
        expect(all.max.x - all.min.x).toBeCloseTo(28.5, 2);
        expect(all.max.y - all.min.y).toBeCloseTo(19.6, 2);
        expect(all.min.z).toBeCloseTo(0, 5);
        expect(all.max.z).toBeCloseTo(15.2, 2);
        expect(bounds(accent).min.z).toBeCloseTo(15.2 - 1.25, 2); // the lid sits on the rim
    });

    it('stands each prop in the world at its bottom, turned about the vertical, in its colours', () => {
        const spec: Spec = {
            ...rack(),
            props: [{ id: 'pr_tote', item: TOTE, pos: [1, 2, 3], rot: 90, accent: '#ff0000' }],
        };
        const group = buildPropsGroup(spec);
        group.updateMatrixWorld(true);
        const holder = group.getObjectByName('pr_tote')!;
        const box = new THREE.Box3().setFromObject(holder);
        expect(box.min.y).toBeCloseTo(2, 3);
        expect(box.max.y).toBeCloseTo(17.2, 2);
        expect(box.max.z - box.min.z).toBeCloseTo(28.5, 2); // turned: its length front to back
        const colours = holder.children.map((m) =>
            ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString(),
        );
        expect(colours).toEqual(['1d1d1f', 'ff0000']);
    });

    it('rests a tote by its rim on a pair of runners and says it fits', () => {
        const tote = findItem(TOTE)!;
        expect(hangHeight(tote)).toBeCloseTo(12.45, 5);
        const rest = restOn(rack(), tote, 'p_left', 'p_right')!;
        expect(rest.rot).toBe(90);
        expect(rest.pos[0]).toBeCloseTo(-27.25, 3); // midway between them
        expect(rest.pos[1]).toBeCloseTo(16.25 + 1.25 - 12.45, 3); // rim on their tops
        expect(rest.pos[2]).toBeCloseTo(-1.5, 3);
        expect(rest.problems).toEqual([]);
    });

    it('names a tote that falls through or will not go between', () => {
        const tote = findItem(TOTE)!;
        const wide = rack();
        wide.parts[0].transform.pos = [-40, 16.25, -1.5];
        expect(restOn(wide, tote, 'p_left', 'p_right')!.problems.join(' ')).toMatch(/drops through/);
        const narrow = rack();
        narrow.parts[0].transform.pos = [-33, 16.25, -1.5];
        expect(restOn(narrow, tote, 'p_left', 'p_right')!.problems.join(' ')).toMatch(/wider than the/);
        expect(restOn(rack(), tote, 'p_left', 'p_left')).toBeNull();
    });

    it('adds, edits and removes a prop, each one undo', () => {
        let spec = rack();
        const id = uniquePropId(spec, TOTE);
        expect(id).toBe('pr_tote_hdx_27gal');
        const add = new AddProp({ id, item: TOTE, pos: [0, 0, 0], rot: 0 });
        spec = add.do(spec);
        expect(uniquePropId(spec, TOTE)).toBe('pr_tote_hdx_27gal_2');
        const edit = new UpdateProp(id, { pos: [1, 2, 3], accent: '#00ff00' });
        spec = edit.do(spec);
        expect(spec.props[0]).toMatchObject({ pos: [1, 2, 3], accent: '#00ff00' });
        const reset = new UpdateProp(id, { accent: undefined });
        spec = reset.do(spec);
        expect('accent' in spec.props[0]).toBe(false);
        spec = reset.undo(spec);
        expect(spec.props[0].accent).toBe('#00ff00');
        expect(new UpdateProp(id, { pos: [1, 2, 3] }).do(spec)).toBe(spec); // no change, no step
        const remove = new RemoveProp(id);
        spec = remove.do(spec);
        expect(spec.props).toEqual([]);
        spec = remove.undo(spec);
        expect(spec.props.map((p) => p.id)).toEqual([id]);
    });
});

describe('resting an imported model', () => {
    it('says when it would drop between the runners or overrun them', () => {
        const narrow = restOn(rack(), null, 'p_left', 'p_right', { l: 22, w: 14 })!;
        expect(narrow.pos[1]).toBeCloseTo(17.5, 3); // on their tops, by its bottom
        expect(narrow.problems.join(' ')).toMatch(/drops through/);
        expect(restOn(rack(), null, 'p_left', 'p_right', { l: 28, w: 18 })!.problems).toEqual([]);
        expect(restOn(rack(), null, 'p_left', 'p_right', { l: 34, w: 18 })!.problems.join(' ')).toMatch(
            /carry it/,
        );
    });
});

describe('shapes made by hand', () => {
    it('draws each at the size typed in, standing on its bottom', () => {
        const size = (g: { body: THREE.BufferGeometry[]; accent: THREE.BufferGeometry[] }) =>
            bounds([...g.body, ...g.accent]).getSize(new THREE.Vector3());
        const box = size(buildShapeGeometry({ kind: 'box', l: 16, w: 12, h: 10 }));
        expect([box.x, box.y, box.z].map((n) => Math.round(n * 10) / 10)).toEqual([16.1, 12.1, 10]);
        const bin = buildShapeGeometry({ kind: 'box', l: 16, w: 11, h: 7, open: true });
        expect(bin.accent).toEqual([]); // no lid
        expect(bounds(bin.body).max.z).toBeCloseTo(7, 5);
        const pail = bounds(
            buildShapeGeometry({ kind: 'round', d: 10.3, top: 11.9, h: 14.5, open: true }).body,
        );
        expect(pail.min.z).toBeCloseTo(0, 2);
        expect(pail.max.x - pail.min.x).toBeGreaterThan(11.9); // the rolled rim round the top
        const tote = size(buildShapeGeometry({ kind: 'tote', l: 24, w: 16, h: 12 }));
        expect(tote.x).toBeCloseTo(24, 3);
        expect(tote.z).toBeCloseTo(12, 3);
    });

    it('rests a hand-sized tote by its rim, and a bin by its bottom', () => {
        const spec = rack();
        const tote = restingAs(spec, {
            id: 'pr',
            shape: { kind: 'tote', l: 28, w: 19, h: 14 },
            pos: [0, 0, 0],
            rot: 0,
        });
        expect(tote.item).not.toBeNull();
        expect(hangHeight(tote.item)).toBeGreaterThan(10);
        expect(restOn(spec, tote.item, 'p_left', 'p_right', tote.footprint)!.problems).toEqual([]);
        const bin = restingAs(spec, {
            id: 'pr',
            shape: { kind: 'box', l: 16, w: 11, h: 7, open: true },
            pos: [0, 0, 0],
            rot: 0,
        });
        expect(bin.item).toBeNull();
        expect(restOn(spec, bin.item, 'p_left', 'p_right', bin.footprint)!.problems.join(' ')).toMatch(
            /drops through/,
        );
    });

    it("is drawn in its own colours, the kind's until given some", () => {
        const spec: Spec = {
            ...rack(),
            props: [
                { id: 'pr_pail', shape: { kind: 'round', d: 10, h: 14 }, pos: [0, 0, 30], rot: 0 },
                {
                    id: 'pr_box',
                    shape: { kind: 'box', l: 10, w: 10, h: 10 },
                    pos: [0, 0, 50],
                    rot: 0,
                    color: '#123456',
                },
                { id: 'pr_half', shape: { kind: 'round', h: 14 }, pos: [0, 0, 70], rot: 0 },
            ],
        };
        const group = buildPropsGroup(spec);
        const colour = (id: string) =>
            (
                (group.getObjectByName(id)!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
            ).color.getHexString();
        expect(colour('pr_pail')).toBe('e4e4e1');
        expect(colour('pr_box')).toBe('123456');
        expect(group.getObjectByName('pr_half')).toBeUndefined(); // no size: not drawn
    });
});
