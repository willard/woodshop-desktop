import { describe, it, expect } from 'vitest';
import { computeCutList } from '../index';
import { boardFeet, roundBoardFeet } from '../boardfeet';
import type { Spec } from '../../spec/types';

/** A rack with three ¾" dowel rails, the piece the Kreg book-rack plan could not express (D60). */
function specWithDowels(): Spec {
    return {
        specVersion: '1.14',
        units: 'in',
        name: 'Dowel Rack',
        materials: [
            {
                id: 'mat_dowel',
                type: 'round',
                name: 'Dowel 3/4',
                thickness: 0.75,
                stockLengths: [36],
                grain: true,
            },
        ],
        parts: [1, 2, 3].map((n) => ({
            id: `p_dowel_${n}`,
            name: `Dowel ${n}`,
            materialId: 'mat_dowel',
            size: { l: 22.5, w: 0.75 },
            grainAxis: 'l',
            transform: { pos: [0, n * 6, 0], rot: [0, 0, 0] },
        })),
    } as unknown as Spec;
}

describe('round stock in the cut list (D60)', () => {
    it('measures a dowel as a cylinder, not its square blank', () => {
        const cutList = computeCutList(specWithDowels());
        const row = cutList.parts[0];

        expect(row.boardFeet).toBeCloseTo(roundBoardFeet(22.5, 0.75, 1), 10);
        // The circumscribing box overstates the volume by 4/π.
        expect(row.boardFeet).toBeCloseTo(boardFeet(22.5, 0.75, 0.75, 1) * (Math.PI / 4), 10);
        expect(row.boardFeet).toBeLessThan(boardFeet(22.5, 0.75, 0.75, 1));
    });

    it('packs dowels as linear stock, off sticks', () => {
        const cutList = computeCutList(specWithDowels());

        expect(cutList.sheets).toHaveLength(0);
        expect(cutList.lumber).toHaveLength(1);
        expect(cutList.lumber[0].materialId).toBe('mat_dowel');
        // Three 22.5" rails will not share a 36" stick: one each.
        expect(cutList.lumber[0].stickCount).toBe(3);
        expect(cutList.lumber[0].cuts).toHaveLength(3);
    });

    it('totals the design in cylinder board feet', () => {
        const cutList = computeCutList(specWithDowels());

        expect(cutList.totals.boardFeet).toBeCloseTo(roundBoardFeet(22.5, 0.75, 3), 10);
        expect(cutList.totals.sheetCount).toBe(0);
    });
});

describe('roundBoardFeet', () => {
    it('is the cylinder volume in board feet', () => {
        // A 1" dowel, 144" long: π/4 · 1 · 144 / 144 = π/4 board feet.
        expect(roundBoardFeet(144, 1, 1)).toBeCloseTo(Math.PI / 4, 10);
    });

    it('scales with quantity', () => {
        expect(roundBoardFeet(36, 0.75, 4)).toBeCloseTo(roundBoardFeet(36, 0.75, 1) * 4, 10);
    });
});
