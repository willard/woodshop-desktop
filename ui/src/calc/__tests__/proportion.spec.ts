import { describe, it, expect } from 'vitest';
import { computeProportion, computeGraduatedDivision, RATIOS, PHI } from '@/calc/proportion';

describe('computeProportion', () => {
    it('divides 100 at the golden section', () => {
        const r = computeProportion({ known: 100, ratioValue: PHI, direction: 'larger' });
        expect(r?.sectionMajor).toBeCloseTo(61.8034, 4);
        expect(r?.sectionMinor).toBeCloseTo(38.1966, 4);
    });

    it('always splits the known dimension into parts that sum back to it', () => {
        for (const ratio of RATIOS) {
            const r = computeProportion({ known: 42, ratioValue: ratio.value, direction: 'larger' });
            expect((r?.sectionMajor as number) + (r?.sectionMinor as number)).toBeCloseTo(42, 10);
            expect(r?.sectionMajor as number).toBeGreaterThan(r?.sectionMinor as number);
        }
    });

    it('works from either end of the pair', () => {
        const fromLarger = computeProportion({ known: 100, ratioValue: PHI, direction: 'larger' });
        expect(fromLarger?.larger).toBe(100);
        expect(fromLarger?.smaller).toBeCloseTo(61.8034, 4);

        const fromSmaller = computeProportion({ known: 100, ratioValue: PHI, direction: 'smaller' });
        expect(fromSmaller?.smaller).toBe(100);
        expect(fromSmaller?.larger).toBeCloseTo(161.8034, 4);
    });

    it('names the nearest ratio in small whole numbers', () => {
        expect(computeProportion({ known: 10, ratioValue: 1.5, direction: 'larger' })?.nearestSimple).toEqual(
            { a: 3, b: 2 },
        );
        expect(computeProportion({ known: 10, ratioValue: 2, direction: 'larger' })?.nearestSimple).toEqual({
            a: 2,
            b: 1,
        });
        // The best Fibonacci convergent within a denominator of 12: 13/8 is off by 0.007 where
        // the better-known 8/5 is off by 0.018.
        expect(computeProportion({ known: 10, ratioValue: PHI, direction: 'larger' })?.nearestSimple).toEqual(
            { a: 13, b: 8 },
        );
    });

    it('refuses nonsense', () => {
        expect(computeProportion({ known: 0, ratioValue: PHI, direction: 'larger' })).toBeNull();
        expect(computeProportion({ known: 10, ratioValue: 0, direction: 'larger' })).toBeNull();
    });

    it('offers ratios that are all greater than one, so larger really is larger', () => {
        for (const r of RATIOS) {
            expect(r.value).toBeGreaterThan(1);
            expect(r.label.length).toBeGreaterThan(0);
        }
        expect(new Set(RATIOS.map((r) => r.id)).size).toBe(RATIOS.length);
    });
});

describe('computeGraduatedDivision', () => {
    it('grows each drawer toward the bottom and fills the case exactly', () => {
        const parts = computeGraduatedDivision(40, 4, 1.2, 0.25);
        expect(parts).toHaveLength(4);
        const sum = parts.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(40 - 0.25 * 3, 10);
        for (let i = 1; i < parts.length; i += 1) {
            expect(parts[i]).toBeGreaterThan(parts[i - 1]);
            expect(parts[i] / parts[i - 1]).toBeCloseTo(1.2, 10);
        }
    });

    it('divides evenly at a ratio of one', () => {
        const parts = computeGraduatedDivision(40, 4, 1, 0);
        for (const p of parts) {
            expect(p).toBeCloseTo(10, 10);
        }
    });

    it('handles a single drawer', () => {
        expect(computeGraduatedDivision(20, 1, 1.2, 0.25)).toEqual([20]);
    });

    it('returns nothing when the gaps eat the case', () => {
        expect(computeGraduatedDivision(1, 6, 1.2, 0.5)).toEqual([]);
        expect(computeGraduatedDivision(40, 0, 1.2, 0.25)).toEqual([]);
        expect(computeGraduatedDivision(40, 2.5, 1.2, 0.25)).toEqual([]);
    });
});
