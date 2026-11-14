import { describe, it, expect } from 'vitest';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec';
import { derivedBorings, derivedHoleOps } from '@/spec/movables';
import { hardwarePlacements } from '@/engine/movablePlacement';

function doorSpec(hinge: string | undefined, hingeEdge: 'l0' | 'l1' | 'w0' | 'w1', l = 18, w = 30): Spec {
    return parseSpec({
        specVersion: '1.15',
        name: 'Cabinet',
        units: 'in',
        materials: [
            { id: 'ply', name: 'Plywood', type: 'sheet', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
        ],
        parts: [
            {
                id: 'door',
                name: 'Door',
                materialId: 'ply',
                size: { l, w },
                transform: { pos: [0, 0, 0] },
            },
        ],
        movables: [
            {
                id: 'mv_door',
                kind: 'door',
                partIds: ['door'],
                panelPartId: 'door',
                hingeEdge,
                style: 'overlay',
                ...(hinge === undefined ? {} : { hinge }),
            },
        ],
    });
}

describe('concealed-hinge cup holes', () => {
    it('bores a 35 mm cup per hinge in the back of the door', () => {
        const borings = derivedBorings(doorSpec('hinge.euro-full-overlay', 'w0'));
        expect(borings).toHaveLength(2);
        expect(borings[0].hole).toMatchObject({ face: 'back', purpose: 'hardware' });
        expect(borings[0].hole.diameter).toBeCloseTo(35 / 25.4, 3);
        expect(borings[0].hole.depth).toBeCloseTo(12 / 25.4, 3);
        // 22.5 mm in from the hinge edge, 3" from each end of it.
        expect(borings[0].hole.x).toBeCloseTo(22.5 / 25.4, 3);
        expect(borings.map((b) => b.hole.y)).toEqual([3, 27]);
    });

    it('a tall door gets a third hinge and a third cup', () => {
        expect(derivedBorings(doorSpec('hinge.euro-full-overlay', 'w0', 18, 48))).toHaveLength(3);
    });

    it('bores nothing for a surface hinge, or when no hinge is chosen', () => {
        expect(derivedBorings(doorSpec('hinge.butt-2-5in', 'w0'))).toEqual([]);
        expect(derivedBorings(doorSpec(undefined, 'w0'))).toEqual([]);
    });

    it('puts every cup exactly under the hinge the 3D view draws', () => {
        for (const edge of ['l0', 'l1', 'w0', 'w1'] as const) {
            const spec = doorSpec('hinge.euro-inset', edge, 20, 44);
            const door = spec.parts[0];
            const hinges = hardwarePlacements(spec, spec.movables![0]).filter((p) => p.kind === 'hinge');
            const holes = derivedHoleOps(spec).get('door')!;
            expect(holes, edge).toHaveLength(hinges.length);
            hinges.forEach((hinge, i) => {
                // A hole's (x, y) counts from the part's w0/l0 corner; a placement from its centre.
                expect(holes[i].x - door.size.l / 2, `${edge} x`).toBeCloseTo(hinge.pos[0], 6);
                expect(holes[i].y - door.size.w / 2, `${edge} y`).toBeCloseTo(hinge.pos[1], 6);
            });
        }
    });
});
