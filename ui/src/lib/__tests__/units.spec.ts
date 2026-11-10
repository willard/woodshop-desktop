import { describe, it, expect } from 'vitest';
import { MM_PER_INCH, toInches, fromInches, unitLabel, feetAndInches, type LengthUnit } from '@/lib/units';

const ALL: readonly LengthUnit[] = ['in', 'ft', 'mm', 'cm', 'm'];

describe('toInches / fromInches', () => {
    it('uses the exact definition of an inch', () => {
        expect(MM_PER_INCH).toBe(25.4);
        expect(fromInches(1, 'mm')).toBe(25.4);
        expect(toInches(25.4, 'mm')).toBeCloseTo(1, 12);
    });

    it('converts each unit', () => {
        expect(toInches(1, 'ft')).toBe(12);
        expect(toInches(1, 'm')).toBeCloseTo(39.3700787, 6);
        expect(fromInches(96, 'ft')).toBe(8);
        expect(fromInches(0.75, 'mm')).toBeCloseTo(19.05, 10);
        expect(fromInches(12, 'cm')).toBeCloseTo(30.48, 10);
    });

    it('is the identity for inches', () => {
        expect(toInches(3.25, 'in')).toBe(3.25);
        expect(fromInches(3.25, 'in')).toBe(3.25);
    });

    it('round-trips every unit', () => {
        for (const u of ALL) {
            for (const v of [0.0625, 0.75, 12, 96, 1234.5]) {
                expect(toInches(fromInches(v, u), u)).toBeCloseTo(v, 9);
            }
        }
    });
});

describe('unitLabel', () => {
    it('names every unit', () => {
        for (const u of ALL) {
            expect(unitLabel(u)).toBe(u);
        }
    });
});

describe('feetAndInches', () => {
    it('splits a long dimension the way it is read aloud', () => {
        expect(feetAndInches(38.5)).toEqual({ feet: 3, inches: 2.5 });
        expect(feetAndInches(96)).toEqual({ feet: 8, inches: 0 });
        expect(feetAndInches(11.75)).toEqual({ feet: 0, inches: 11.75 });
    });

    it('keeps the sign on the feet', () => {
        expect(feetAndInches(-38.5).feet).toBe(-3);
        expect(feetAndInches(-38.5).inches).toBe(2.5);
    });

    it('survives non-finite input', () => {
        expect(feetAndInches(Number.NaN)).toEqual({ feet: 0, inches: 0 });
        expect(feetAndInches(Number.POSITIVE_INFINITY)).toEqual({ feet: 0, inches: 0 });
    });
});
