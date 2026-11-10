import { describe, it, expect } from 'vitest';
import { computeBoardFeet, QUARTER_THICKNESSES, type BoardFeetInput } from '@/calc/boardFeet';

function input(over: Partial<BoardFeetInput> = {}): BoardFeetInput {
    return {
        thickness: 1,
        width: 12,
        length: 12,
        qty: 1,
        wasteFactor: 0,
        pricePerBoardFoot: null,
        round: false,
        ...over,
    };
}

describe('computeBoardFeet', () => {
    it('makes one board foot out of 1 x 12 x 12', () => {
        // The definition: 144 cubic inches.
        expect(computeBoardFeet(input()).total).toBeCloseTo(1, 10);
    });

    it('works the yard example — 8/4 x 6 x 96 is eight board feet', () => {
        expect(computeBoardFeet(input({ thickness: 2, width: 6, length: 96 })).total).toBeCloseTo(8, 10);
    });

    it('multiplies by quantity and reports the per-piece figure', () => {
        const r = computeBoardFeet(input({ thickness: 2, width: 6, length: 96, qty: 6 }));
        expect(r.total).toBeCloseTo(48, 10);
        expect(r.perPiece).toBeCloseTo(8, 10);
    });

    it('charges only for a cylinder when the stock is round', () => {
        // D60: a dowel inside its square blank is π/4 — about 79% — of the boxed volume, and width
        // plays no part because the diameter is the thickness.
        const square = computeBoardFeet(input({ thickness: 2, width: 2, length: 96 }));
        const round = computeBoardFeet(input({ thickness: 2, width: 2, length: 96, round: true }));
        expect(round.total / square.total).toBeCloseTo(Math.PI / 4, 10);
        expect(
            computeBoardFeet(input({ thickness: 2, width: 99, length: 96, round: true })).total,
        ).toBeCloseTo(round.total, 10);
    });

    it('adds the waste allowance to what you buy, not to what you need', () => {
        const r = computeBoardFeet(input({ thickness: 2, width: 6, length: 96, wasteFactor: 0.1 }));
        expect(r.total).toBeCloseTo(8, 10);
        expect(r.withWaste).toBeCloseTo(8.8, 10);
    });

    it('prices the waste too, because the yard does', () => {
        const r = computeBoardFeet(
            input({ thickness: 2, width: 6, length: 96, wasteFactor: 0.1, pricePerBoardFoot: 9 }),
        );
        expect(r.cost).toBeCloseTo(79.2, 8); // 8.8 bdft, not 8
    });

    it('leaves the cost null when no price is given', () => {
        expect(computeBoardFeet(input()).cost).toBeNull();
    });

    it('does not divide by zero on an empty stack', () => {
        const r = computeBoardFeet(input({ qty: 0 }));
        expect(r.total).toBe(0);
        expect(r.perPiece).toBe(0);
    });

    it('quotes the rough thicknesses the yard uses', () => {
        expect(QUARTER_THICKNESSES.find((q) => q.label === '4/4')?.thickness).toBe(1);
        expect(QUARTER_THICKNESSES.find((q) => q.label === '8/4')?.thickness).toBe(2);
        for (const q of QUARTER_THICKNESSES) {
            expect(q.thickness).toBeCloseTo(Number(q.label.split('/')[0]) / 4, 10);
        }
    });
});
