import { describe, it, expect } from 'vitest';
import { oneBoard, perBoardFoot } from '@/cutlist/boardfeet';
import type { Material } from '@/spec';

const twoByFour: Material = {
    id: 'mat_2x4',
    type: 'lumber',
    name: '2x4 SPF',
    thickness: 1.5,
    stockWidth: 3.5,
    stockLengths: [120, 96],
};

describe('oneBoard', () => {
    it('is the shortest board a material is sold in', () => {
        // 1.5 × 3.5 × 96 / 144 = 3.5 board feet.
        expect(oneBoard(twoByFour)).toEqual({ length: 96, boardFeet: 3.5 });
    });

    it('falls back to 96" boards', () => {
        expect(oneBoard({ ...twoByFour, stockLengths: undefined })?.length).toBe(96);
    });

    it('measures a dowel as a cylinder', () => {
        const dowel: Material = {
            id: 'mat_d',
            type: 'round',
            name: 'Dowel',
            thickness: 1,
            stockLengths: [36],
        };
        expect(oneBoard(dowel)!.boardFeet).toBeCloseTo(((Math.PI / 4) * 36) / 144, 6);
    });

    it('has no fixed board without a stock width, nor for a sheet', () => {
        expect(oneBoard({ ...twoByFour, stockWidth: undefined })).toBeNull();
        expect(oneBoard({ id: 's', type: 'sheet', name: 'Ply', thickness: 0.75 })).toBeNull();
    });
});

describe('perBoardFoot', () => {
    it('turns a price per board into one per board foot that reads back to the cent', () => {
        const board = oneBoard(twoByFour)!;
        const bf = perBoardFoot(4.48, board);
        expect(bf).toBe(1.28);
        const odd = perBoardFoot(5.97, board);
        expect(Math.round(odd * board.boardFeet * 100) / 100).toBe(5.97);
    });
});
