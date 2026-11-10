import { describe, it, expect } from 'vitest';
import { parseFraction, parseSignedFraction, formatFraction } from '@/lib/fraction';

describe('parseFraction', () => {
    it('parses integers and decimals', () => {
        expect(parseFraction('12')).toBe(12);
        expect(parseFraction('1.5')).toBe(1.5);
        expect(parseFraction('.5')).toBe(0.5);
        expect(parseFraction('  3  ')).toBe(3);
    });

    it('parses simple and mixed fractions', () => {
        expect(parseFraction('3/4')).toBe(0.75);
        expect(parseFraction('1 1/2')).toBe(1.5);
        expect(parseFraction('1-1/2')).toBe(1.5);
        expect(parseFraction('11/16')).toBeCloseTo(0.6875);
    });

    it('rejects garbage and divide-by-zero', () => {
        expect(parseFraction('')).toBeNull();
        expect(parseFraction('abc')).toBeNull();
        expect(parseFraction('1 1/2 x')).toBeNull();
        expect(parseFraction('3/0')).toBeNull();
        expect(parseFraction('-1')).toBeNull(); // dimensions are positive; negatives rejected
    });
});

describe('formatFraction', () => {
    it('formats common shop fractions', () => {
        expect(formatFraction(0.75)).toBe('3/4');
        expect(formatFraction(1.5)).toBe('1 1/2');
        expect(formatFraction(2)).toBe('2');
        expect(formatFraction(0.0625)).toBe('1/16');
        expect(formatFraction(0.5)).toBe('1/2');
    });

    it('snaps to the nearest sixteenth and reduces', () => {
        expect(formatFraction(0.1)).toBe('1/8'); // 0.1*16 = 1.6 → 2/16 → 1/8
        expect(formatFraction(0.24)).toBe('1/4'); // → 4/16 → 1/4
    });

    it('carries rounding up to the next whole', () => {
        expect(formatFraction(0.97)).toBe('1'); // 0.97*16 = 15.5 → 16 → whole+1
    });

    it('drops the sign from a negative that rounds to zero', () => {
        // The sign is taken after rounding — "-0" is not a measurement.
        expect(formatFraction(-0.02)).toBe('0');
        expect(formatFraction(-0.001)).toBe('0');
        expect(formatFraction(-0.001, 32)).toBe('0');
    });

    it('keeps the sign on negatives that survive rounding', () => {
        expect(formatFraction(-0.75)).toBe('-3/4');
        expect(formatFraction(-1.5)).toBe('-1 1/2');
        expect(formatFraction(-0.97)).toBe('-1'); // rounds up to a whole, still negative
    });

    it('round-trips through parse', () => {
        for (const v of [0.75, 1.5, 0.3125, 12, 3.5]) {
            expect(parseFraction(formatFraction(v))).toBeCloseTo(v);
        }
    });
});

describe('parseSignedFraction — coordinates, unlike dimensions, may be negative', () => {
    it('accepts a leading minus in every notation the parser knows', () => {
        expect(parseSignedFraction('-3 1/2')).toBe(-3.5);
        expect(parseSignedFraction('-3/4')).toBe(-0.75);
        expect(parseSignedFraction('-12')).toBe(-12);
        expect(parseSignedFraction('-1.5')).toBe(-1.5);
        expect(parseSignedFraction('-1-1/2')).toBe(-1.5);
    });

    it('still reads positives exactly like parseFraction', () => {
        for (const input of ['3/4', '1 1/2', '12', '0.0625']) {
            expect(parseSignedFraction(input)).toBe(parseFraction(input));
        }
    });

    it('never returns −0', () => {
        expect(Object.is(parseSignedFraction('-0'), 0)).toBe(true);
        expect(Object.is(parseSignedFraction('-0/4'), 0)).toBe(true);
    });

    it('rejects what the strict parser rejects', () => {
        expect(parseSignedFraction('')).toBeNull();
        expect(parseSignedFraction('-')).toBeNull();
        expect(parseSignedFraction('abc')).toBeNull();
        expect(parseSignedFraction('-1/0')).toBeNull();
    });

    it('tolerates a space after the minus — the intent is not ambiguous', () => {
        expect(parseSignedFraction('- 3')).toBe(-3);
    });

    it('round-trips what formatFraction prints, which parseFraction cannot', () => {
        for (const value of [-3.5, -0.75, -12, 0.75, 6]) {
            expect(parseSignedFraction(formatFraction(value))).toBe(value);
        }
        // The gap this closes: the strict parser refuses its own formatter's output.
        expect(parseFraction(formatFraction(-3.5))).toBeNull();
    });
});
