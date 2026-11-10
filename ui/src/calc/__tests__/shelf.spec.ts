import { describe, it, expect } from 'vitest';
import { computeShelfSag, DEFAULT_SAG_LIMIT_PER_FOOT, type ShelfSagInput } from '@/calc/shelf';
import { assessSturdiness } from '@/struct';
import { makeSpec, shelfBetweenSides } from '@/struct/__tests__/helpers';
import type { BeamLoad } from '@/struct/beam';

const BOOKS: BeamLoad = { kind: 'uniform', perFoot: 20 };

function shelf(over: Partial<ShelfSagInput> = {}): ShelfSagInput {
    return {
        span: 36,
        depth: 12,
        thickness: 0.75,
        speciesId: 'oak',
        load: BOOKS,
        ends: 'simple',
        allowedPerFoot: DEFAULT_SAG_LIMIT_PER_FOOT,
        ...over,
    };
}

describe('computeShelfSag', () => {
    it('matches the hand-computed reference shelf', () => {
        const r = computeShelfSag(shelf());
        expect(r.deflection).toBeCloseTo(0.04747, 5);
        expect(r.allowed).toBeCloseTo(0.06, 10);
        expect(r.inertia).toBeCloseTo(0.421875, 10);
        expect(r.maxSpan).toBeCloseTo(38.9, 1);
    });

    it('grades the result the way an eye would', () => {
        expect(computeShelfSag(shelf({ span: 24 })).verdict).toBe('ok');
        expect(computeShelfSag(shelf({ span: 48 })).verdict).toBe('sag');
        // Marginal is the band just under the limit, where it passes with nothing in hand.
        const marginal = computeShelfSag(shelf({ span: 37 }));
        expect(marginal.ratio).toBeGreaterThanOrEqual(0.8);
        expect(marginal.ratio).toBeLessThanOrEqual(1);
        expect(marginal.verdict).toBe('marginal');
    });

    it('flips exactly at the allowance', () => {
        const r = computeShelfSag(shelf({ span: 38.92 }));
        expect(r.ratio).toBeCloseTo(1, 2);
        // At its own reported max span the shelf is exactly at the limit, not over it.
        const atMax = computeShelfSag(shelf({ span: computeShelfSag(shelf()).maxSpan }));
        expect(atMax.ratio).toBeCloseTo(1, 9);
        expect(atMax.verdict).not.toBe('sag');
    });

    it('shows why picking the wrong panel is the expensive mistake', () => {
        const oak = computeShelfSag(shelf());
        const mdf = computeShelfSag(shelf({ speciesId: 'mdf' }));
        expect(mdf.deflection / oak.deflection).toBeCloseTo(1_820_000 / 500_000, 6);
        expect(mdf.verdict).toBe('sag');
        expect(oak.verdict).toBe('ok');
    });

    it('rewards housing the ends', () => {
        expect(computeShelfSag(shelf({ ends: 'fixed' })).deflection).toBeCloseTo(
            computeShelfSag(shelf()).deflection / 5,
            10,
        );
    });

    it('says what the number does not cover', () => {
        expect(computeShelfSag(shelf()).notes.join(' ')).toContain('creeping');
        // The lip caveat appears where it matters — on a result the user might act on.
        expect(computeShelfSag(shelf({ span: 48 })).notes.join(' ')).toContain('front lip');
        expect(computeShelfSag(shelf({ speciesId: 'mdf' })).notes.join(' ')).toContain('by brand');
    });

    it('does not produce nonsense for a degenerate shelf', () => {
        const r = computeShelfSag(shelf({ thickness: 0 }));
        expect(Number.isFinite(r.deflection)).toBe(true);
        expect(r.deflection).toBe(0);
        expect(r.maxSpan).toBe(0);
    });
});

describe('parity with the editor sturdiness advisory', () => {
    it('gives the identical deflection for the same shelf', () => {
        // The guard that matters most: a calculator that quietly disagrees with the advisory the
        // editor already shows is worse than no calculator (D86). Both route through struct/beam.
        for (const span of [24, 30, 36, 40]) {
            const report = assessSturdiness(
                makeSpec(shelfBetweenSides(span), {
                    materials: [{ id: 'mat_oak', type: 'lumber', thickness: 0.75, species: 'oak' }],
                }),
            );
            expect(report.shelves).toHaveLength(1);
            const row = report.shelves[0];

            const mine = computeShelfSag(
                shelf({ span: row.span, depth: 12, thickness: 0.75, speciesId: 'oak' }),
            );

            expect(mine.modulus).toBe(row.modulus);
            expect(mine.deflection).toBeCloseTo(row.deflection, 12);
            expect(mine.allowed).toBeCloseTo(row.allowed, 12);
        }
    });
});
