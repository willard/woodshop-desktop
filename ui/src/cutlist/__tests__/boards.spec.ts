import { describe, it, expect } from 'vitest';
import { boardLength, boardSizes, boughtBoards, parseStockLengths } from '@/cutlist/boards';
import type { LumberPlan } from '@/cutlist';

const plan = (stickCount: number, boardLengths?: number[]): LumberPlan => ({
    materialId: 'm',
    materialName: '2x6',
    stockLength: 120,
    stickCount,
    boardLengths,
    cuts: [],
    waste: 0,
    cost: null,
});
const inches = (n: number) => `${n}"`;

describe('board lengths', () => {
    it('are all the stock length unless listed', () => {
        expect(boardLength(plan(2), 1)).toBe(120);
        expect(boughtBoards(plan(2))).toEqual([[120, 2]]);
        expect(boardSizes(plan(2), inches)).toBe('120"');
    });

    it('are counted by length, longest first, when they differ', () => {
        const mixed = plan(3, [96, 120, 96]);
        expect(boardLength(mixed, 1)).toBe(120);
        expect(boughtBoards(mixed)).toEqual([
            [120, 1],
            [96, 2],
        ]);
        expect(boardSizes(mixed, inches)).toBe('1 × 120", 2 × 96"');
    });
});

describe('parseStockLengths', () => {
    const inches = (s: string): number | null => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null);

    it('lists each length once, shortest first', () => {
        expect(parseStockLengths('120, 96,96 , 144', inches)).toEqual([96, 120, 144]);
    });

    it('refuses anything that is not a length on sale', () => {
        expect(parseStockLengths('', inches)).toBeNull();
        expect(parseStockLengths('96, lots', inches)).toBeNull();
        expect(parseStockLengths('0', inches)).toBeNull();
        expect(parseStockLengths('300', inches)).toBeNull();
        expect(parseStockLengths('1,2,3,4,5,6,7,8,9', inches)).toBeNull();
    });
});
