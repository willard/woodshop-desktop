import { describe, it, expect } from 'vitest';
import { computeConversion } from '@/calc/convert';
import { MM_PER_INCH, toInches } from '@/lib/units';

describe('computeConversion', () => {
    it('shows how far a sixteenth-inch mark misses a 25 mm dimension', () => {
        // The number this calculator exists for. 25 mm reads as a clean 1 in at sixteenths and is
        // a sixty-fourth short of it; no ordinary converter shows that.
        const r = computeConversion({ inches: toInches(25, 'mm'), denominator: 16 });
        expect(r.fraction).toBe('1');
        expect(r.fractionError).toBeCloseTo(0.015748, 6);
        expect(r.fractionError).toBeGreaterThan(0); // the mark is long
    });

    it('closes the gap at sixty-fourths', () => {
        const r = computeConversion({ inches: toInches(25, 'mm'), denominator: 64 });
        expect(r.fraction).toBe('63/64');
        expect(r.fractionError).toBeCloseTo(0.000123, 6);
    });

    it('reports no error for a dimension that lands on the rule', () => {
        expect(computeConversion({ inches: 0.75, denominator: 16 }).fractionError).toBeCloseTo(0, 12);
        expect(computeConversion({ inches: 12, denominator: 16 }).fractionError).toBeCloseTo(0, 12);
    });

    it('signs the error so you can tell long from short', () => {
        // 0.51 rounds down to 1/2 at sixteenths: the mark is short of the true value.
        expect(computeConversion({ inches: 0.51, denominator: 16 }).fractionError).toBeLessThan(0);
        // 0.49 rounds up to 1/2: the mark is long.
        expect(computeConversion({ inches: 0.49, denominator: 16 }).fractionError).toBeGreaterThan(0);
    });

    it('converts to every unit at once', () => {
        const r = computeConversion({ inches: 38.5, denominator: 16 });
        expect(r.mm).toBeCloseTo(38.5 * MM_PER_INCH, 8);
        expect(r.cm).toBeCloseTo(38.5 * 2.54, 8);
        expect(r.m).toBeCloseTo(0.9779, 4);
        expect(r.feetInches).toEqual({ feet: 3, inches: 2.5 });
        expect(r.fraction).toBe('38 1/2');
    });

    it('rounds a finer denominator at least as closely as a coarser one', () => {
        for (const inches of [0.3, 1.1, 5.77, 12.345]) {
            const coarse = Math.abs(computeConversion({ inches, denominator: 8 }).fractionError);
            const fine = Math.abs(computeConversion({ inches, denominator: 64 }).fractionError);
            expect(fine).toBeLessThanOrEqual(coarse + 1e-12);
        }
    });
});
