import { describe, it, expect } from 'vitest';
import { boardLength, boardSizes, boughtBoards } from '@/cutlist/boards';
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
