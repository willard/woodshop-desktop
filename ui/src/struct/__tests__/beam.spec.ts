import { describe, it, expect } from 'vitest';
import { rectangleInertia, deflection, maxSpan, type BeamLoad } from '@/struct/beam';
import { DEFAULT_STRUCT_CONFIG } from '@/struct/types';
import { modulusOf } from '@/lib/species';

// The reference case, worked by hand: a 3/4 x 12 red oak shelf spanning 36 in under 20 lb/ft.
const OAK = modulusOf('oak'); // 1,820,000 psi
const I36 = rectangleInertia(12, 0.75); // 0.421875 in⁴
const BOOKS: BeamLoad = { kind: 'uniform', perFoot: 20 };
const LIMIT = DEFAULT_STRUCT_CONFIG.sagLimitPerFoot; // 0.02 in per foot of span

describe('rectangleInertia', () => {
    it('cubes the thickness and not the depth', () => {
        expect(rectangleInertia(12, 0.75)).toBeCloseTo(0.421875, 10);
        // Doubling thickness is 8x stiffer; doubling depth is only 2x. Swapping the arguments is
        // the error that still returns a plausible-looking number.
        expect(rectangleInertia(12, 1.5) / rectangleInertia(12, 0.75)).toBeCloseTo(8, 10);
        expect(rectangleInertia(24, 0.75) / rectangleInertia(12, 0.75)).toBeCloseTo(2, 10);
        expect(rectangleInertia(12, 0.75)).not.toBeCloseTo(rectangleInertia(0.75, 12), 5);
    });
});

describe('deflection', () => {
    it('matches the hand-computed reference shelf', () => {
        expect(deflection(BOOKS, 36, OAK, I36, 'simple')).toBeCloseTo(0.04747, 5);
    });

    it('divides a per-foot load by 12 before it meets a span in inches', () => {
        // The 12x trap. A load quoted per foot against a span in inches, unconverted, would give
        // exactly twelve times this answer.
        const wrong = ((5 / 384) * 20 * 36 ** 4) / (OAK * I36);
        expect(wrong / deflection(BOOKS, 36, OAK, I36, 'simple')).toBeCloseTo(12, 6);
    });

    it('makes fixed ends exactly a fifth of simple ends under a uniform load', () => {
        const simple = deflection(BOOKS, 36, OAK, I36, 'simple');
        const fixed = deflection(BOOKS, 36, OAK, I36, 'fixed');
        expect(fixed).toBeCloseTo(simple / 5, 10);
    });

    it('uses PL³/48EI for a centred point load', () => {
        const point: BeamLoad = { kind: 'center', pounds: 60 };
        expect(deflection(point, 36, OAK, I36, 'simple')).toBeCloseTo((60 * 36 ** 3) / (48 * OAK * I36), 10);
        expect(deflection(point, 36, OAK, I36, 'fixed')).toBeCloseTo(
            deflection(point, 36, OAK, I36, 'simple') / 4,
            10,
        );
    });

    it('scales with the fourth power of span and the inverse of stiffness', () => {
        const a = deflection(BOOKS, 30, OAK, I36, 'simple');
        const b = deflection(BOOKS, 60, OAK, I36, 'simple');
        expect(b / a).toBeCloseTo(16, 6);
        expect(deflection(BOOKS, 36, OAK / 2, I36, 'simple')).toBeCloseTo(
            deflection(BOOKS, 36, OAK, I36, 'simple') * 2,
            10,
        );
    });

    it('returns zero rather than Infinity for degenerate input', () => {
        expect(deflection(BOOKS, 0, OAK, I36, 'simple')).toBe(0);
        expect(deflection(BOOKS, 36, OAK, 0, 'simple')).toBe(0);
        expect(deflection(BOOKS, 36, 0, I36, 'simple')).toBe(0);
    });
});

describe('maxSpan', () => {
    it('finds the longest passing span for the reference shelf', () => {
        expect(maxSpan(BOOKS, OAK, I36, LIMIT, 'simple')).toBeCloseTo(38.9, 1);
    });

    it('inverts deflection exactly — at the max span, deflection equals the allowance', () => {
        for (const ends of ['simple', 'fixed'] as const) {
            for (const load of [BOOKS, { kind: 'center', pounds: 60 } as const]) {
                const L = maxSpan(load, OAK, I36, LIMIT, ends);
                expect(deflection(load, L, OAK, I36, ends)).toBeCloseTo((LIMIT * L) / 12, 9);
            }
        }
    });

    it('grows with stiffness and shrinks with load', () => {
        expect(maxSpan(BOOKS, OAK, I36, LIMIT, 'fixed')).toBeGreaterThan(
            maxSpan(BOOKS, OAK, I36, LIMIT, 'simple'),
        );
        expect(maxSpan({ kind: 'uniform', perFoot: 40 }, OAK, I36, LIMIT, 'simple')).toBeLessThan(
            maxSpan(BOOKS, OAK, I36, LIMIT, 'simple'),
        );
        expect(maxSpan(BOOKS, modulusOf('mdf'), I36, LIMIT, 'simple')).toBeLessThan(
            maxSpan(BOOKS, OAK, I36, LIMIT, 'simple'),
        );
    });

    it('is unbounded with no load and zero for a section with no stiffness', () => {
        expect(maxSpan({ kind: 'uniform', perFoot: 0 }, OAK, I36, LIMIT, 'simple')).toBe(Infinity);
        expect(maxSpan(BOOKS, OAK, 0, LIMIT, 'simple')).toBe(0);
    });
});
