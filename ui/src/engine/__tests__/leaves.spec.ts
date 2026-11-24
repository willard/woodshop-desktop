import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LEAF_FOLD_RAD, openedPoses } from '@/engine/open';
import { bracketLegMatrix } from '@/engine/geometry/hardwareModels';
import { findItem } from '@/hardware/catalog';
import { hardwarePlacements } from '@/engine/movablePlacement';
import { leafHingeEdgeFor, leafSupportFor } from '@/spec/movables';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec/types';

/** A cart top with a 24"-deep wing raised level off its right end (+X), hinged on its w0 edge. */
function cart(leaf: Record<string, unknown> = {}): Spec {
    return parseSpec({
        specVersion: '1.22',
        units: 'in',
        name: 'Cart',
        materials: [{ id: 'ply', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } }],
        parts: [
            {
                id: 'p_top',
                name: 'Top',
                materialId: 'ply',
                size: { l: 36, w: 24 },
                transform: { pos: [0, 30.375, 0], rot: [90, 0, 0] },
            },
            {
                id: 'p_wing',
                name: 'Wing',
                materialId: 'ply',
                size: { l: 24, w: 24 },
                transform: { pos: [30, 30.375, 0], rot: [90, 0, 0] },
            },
        ],
        movables: [
            {
                id: 'mv_wing',
                kind: 'leaf',
                partIds: ['p_wing'],
                leafPartId: 'p_wing',
                hingeEdge: 'w0',
                ...leaf,
            },
        ],
    }) as Spec;
}

describe('a drop leaf (spec 1.22)', () => {
    it('folds down about the lower arris of its hinge edge, hanging beside the piece', () => {
        const pose = openedPoses(cart(), 1).get('p_wing')!;
        // The hinge line is at x = 18, y = 30: the wing's centre swings from 12" out to 12" down.
        expect(pose.pos[0]).toBeCloseTo(18.375, 2);
        expect(pose.pos[1]).toBeCloseTo(30 - 12, 2);
        // Halfway, its free edge is going down, not up.
        expect(openedPoses(cart(), 0.5).get('p_wing')!.pos[1]).toBeLessThan(30.375);
        // Closed is the authored, raised position.
        expect(openedPoses(cart(), 0).get('p_wing')!.pos).toEqual([30, 30.375, 0]);
    });

    it('hangs on butt hinges and the longest folding bracket that stops short of its edge', () => {
        const placed = hardwarePlacements(cart(), cart().movables![0]);
        const hinges = placed.filter((p) => p.kind === 'hinge');
        const brackets = placed.filter((p) => p.kind === 'support');
        expect(hinges.map((h) => h.itemId)).toEqual(['hinge.butt-2-5in', 'hinge.butt-2-5in']);
        expect(brackets.map((b) => b.itemId)).toEqual(['bracket.folding-20in', 'bracket.folding-20in']);
        expect(leafSupportFor(24)?.id).toBe('bracket.folding-20in');
        // Each bracket's arm points from the hinge edge out under the wing (+X locally), and its
        // leg runs down (the wing's underside is its front face here: local +Z points down).
        expect(brackets[0].basis!.z).toEqual([1, 0, 0]);
        const up = new THREE.Vector3(...brackets[0].basis!.x);
        expect(up.z).toBe(-1);
    });

    it('guesses the hinge edge as the one against the rest of the piece', () => {
        const spec = cart();
        expect(leafHingeEdgeFor(spec, spec.parts[1])).toBe('w0');
    });

    it('hangs on its brackets alone when its hinge is "none": no hinges, the brackets at the ends', () => {
        const spec = cart({ hinge: 'none', support: 'bracket.folding-20in' });
        const placed = hardwarePlacements(spec, spec.movables![0]);
        expect(placed.filter((p) => p.kind === 'hinge')).toEqual([]);
        const brackets = placed.filter((p) => p.kind === 'support');
        expect(brackets).toHaveLength(2);
        // Flush with each end of the 24" edge (half a 1 1/2"-wide bracket in), on the corner posts.
        const along = brackets.map((b) => b.pos[1]).sort((a, b) => a - b);
        expect(along[1] - along[0]).toBeCloseTo(22.5, 6);
    });

    it("keeps each bracket's leg on the post while the arm folds down with the leaf", () => {
        const spec = cart({ support: 'bracket.folding-16in' });
        const model = findItem('bracket.folding-16in')!.model;
        const leg = model.leg as number;
        const bracket = hardwarePlacements(spec, spec.movables![0]).find((p) => p.kind === 'support')!;
        const vx = new THREE.Vector3(...bracket.basis!.x);
        const vz = new THREE.Vector3(...bracket.basis!.z);
        const place = new THREE.Matrix4()
            .makeBasis(vx, new THREE.Vector3().crossVectors(vz, vx), vz)
            .setPosition(...bracket.pos);
        const world = (factor: number, local: THREE.Vector3): THREE.Vector3 => {
            const pose = openedPoses(spec, factor).get('p_wing')!;
            const leaf = new THREE.Matrix4().compose(
                new THREE.Vector3(...pose.pos),
                new THREE.Quaternion(...pose.quat),
                new THREE.Vector3(1, 1, 1),
            );
            return local
                .clone()
                .applyMatrix4(bracketLegMatrix(model, factor * LEAF_FOLD_RAD))
                .applyMatrix4(place)
                .applyMatrix4(leaf);
        };
        const foot = new THREE.Vector3(-leg / 2, 0, 0);
        for (const factor of [0.5, 1]) {
            expect(world(factor, foot).distanceTo(world(0, foot))).toBeLessThan(1e-6);
        }
        // Locked out, the leg hangs straight down from the leaf's underside.
        const top = world(0, new THREE.Vector3(leg / 2, 0, 0));
        expect(top.y - world(0, foot).y).toBeCloseTo(leg, 6);
    });

    it('pivots a box wing hung on its brackets at the bottom of its aprons, so it folds clear', () => {
        // The 24" wing as a box: the top over a 3 1/2"-deep apron rail along its outer end.
        const base = cart({ hinge: 'none', support: 'bracket.folding-20in' });
        const spec = parseSpec({
            ...base,
            parts: [
                ...base.parts,
                {
                    id: 'p_apron',
                    name: 'Apron',
                    materialId: 'ply',
                    size: { l: 24, w: 3.5 },
                    transform: { pos: [41.625, 28.25, 0], rot: [0, 90, 0] },
                },
            ],
            movables: [{ ...base.movables![0], partIds: ['p_wing', 'p_apron'] }],
        } as unknown as Spec);
        // Brackets meet the wing 3 1/2" below the top's underside: at the bottom of the apron.
        const bracket = hardwarePlacements(spec, spec.movables![0]).find((p) => p.kind === 'support')!;
        const model = findItem('bracket.folding-20in')!.model;
        expect(bracket.pos[2]).toBeCloseTo(0.375 + 3.5 + (model.leg as number) / 2, 6);
        // Folded, the apron hangs outboard of the hinge edge (x = 18), never inside the piece.
        const apron = openedPoses(spec, 1).get('p_apron')!;
        expect(apron.pos[0]).toBeGreaterThan(18);
        const wing = openedPoses(spec, 1).get('p_wing')!;
        expect(wing.pos[0]).toBeGreaterThan(18);
    });
});
