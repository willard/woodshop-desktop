import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { openedPoses } from '@/engine/open';
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
});
