import { describe, it, expect } from 'vitest';
import {
    computeMortiseTenon,
    computeDowelLayout,
    DEFAULT_JOINERY_CONFIG,
    DEFAULT_DOWEL_SPACING,
    DEFAULT_DOWEL_END_INSET,
    type MortiseTenonInput,
} from '@/calc/joinery';
import { DOWEL_SIZES } from '@/lib/lumberSizes';

function frame(over: Partial<MortiseTenonInput> = {}): MortiseTenonInput {
    return {
        railThickness: 0.75,
        railWidth: 3,
        stileThickness: 1.5,
        through: false,
        haunched: false,
        ...over,
    };
}

describe('computeMortiseTenon', () => {
    it('takes a third of the rail, snapped down to a chisel you own', () => {
        // 0.75 / 3 = 0.25 exactly — the 1/4in chisel.
        expect(computeMortiseTenon(frame()).tenonThickness).toBe(0.25);
        // 1 / 3 = 0.333 — snapped DOWN to 5/16, never up to 3/8, which would thin the cheeks.
        expect(computeMortiseTenon(frame({ railThickness: 1 })).tenonThickness).toBe(0.3125);
    });

    it('never rounds the tenon up past the ideal, or says plainly why it could not', () => {
        for (const railThickness of [0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 2]) {
            const r = computeMortiseTenon(frame({ railThickness }));
            expect(DEFAULT_JOINERY_CONFIG.chiselSizes).toContain(r.tenonThickness);
            if (r.tenonThickness > railThickness / 3 + 1e-9) {
                // Only when a third is finer than the smallest chisel — and then it must warn.
                expect(r.tenonThickness).toBe(Math.min(...DEFAULT_JOINERY_CONFIG.chiselSizes));
                expect(r.notes.join(' ')).toContain('thinner than your smallest chisel');
            }
        }
    });

    it('warns rather than quietly thinning the cheeks on thin stock', () => {
        const r = computeMortiseTenon(frame({ railThickness: 0.5 }));
        expect(r.tenonThickness).toBe(0.25);
        expect(r.shoulderFace).toBeCloseTo(0.125, 10);
        expect(r.notes.join(' ')).toContain('smallest chisel');
    });

    it('splits the leftover evenly between the two cheeks', () => {
        const r = computeMortiseTenon(frame());
        expect(r.shoulderFace * 2 + r.tenonThickness).toBeCloseTo(0.75, 10);
    });

    it('matches the mortise to the tenon exactly', () => {
        const r = computeMortiseTenon(frame());
        expect(r.mortiseWidth).toBe(r.tenonThickness);
    });

    it('keeps a blind tenon inside the stile', () => {
        const r = computeMortiseTenon(frame({ stileThickness: 1.5 }));
        expect(r.tenonLength).toBeCloseTo(1, 10); // two thirds of 1.5
        expect(r.mortiseDepth).toBeCloseTo(1.0625, 10); // plus glue relief
        expect(r.mortiseDepth).toBeLessThan(1.5);
        expect(r.notes.join(' ')).not.toContain('break through');
    });

    it('runs a through tenon the full thickness and says what that shows', () => {
        const r = computeMortiseTenon(frame({ through: true }));
        expect(r.tenonLength).toBe(1.5);
        expect(r.mortiseDepth).toBe(1.5);
        expect(r.notes.join(' ')).toContain('end grain');
    });

    it('caps the edge shoulder so a deep rail keeps a wide tenon', () => {
        const narrow = computeMortiseTenon(frame({ railWidth: 1.5 }));
        expect(narrow.shoulderEdge).toBeCloseTo(0.25, 10); // a sixth of 1.5

        const deep = computeMortiseTenon(frame({ railWidth: 6 }));
        expect(deep.shoulderEdge).toBe(DEFAULT_JOINERY_CONFIG.maxShoulder); // capped, not 1in
        expect(deep.tenonWidth).toBeCloseTo(6 - 2 * 0.375, 10);
    });

    it('adds a haunch only when asked', () => {
        expect(computeMortiseTenon(frame()).haunchDepth).toBeNull();
        expect(computeMortiseTenon(frame({ haunched: true })).haunchDepth).toBeGreaterThan(0);
    });

    it('explains when it had to compromise', () => {
        expect(computeMortiseTenon(frame({ railThickness: 1 })).notes.join(' ')).toContain('snapped down');
        expect(computeMortiseTenon(frame()).notes.join(' ')).not.toContain('snapped down');
    });
});

describe('computeDowelLayout', () => {
    it('lays out the worked reference: a 24in run at 8in spacing with 1in insets', () => {
        const r = computeDowelLayout({
            jointLength: 24,
            stockThickness: 0.75,
            diameter: 0.25,
            spacing: 8,
            endInset: 1,
        });
        expect(r.count).toBe(4);
        expect(r.actualSpacing).toBeCloseTo(22 / 3, 10);
        expect(r.positions.map((p) => Number(p.toFixed(2)))).toEqual([1, 8.33, 15.67, 23]);
    });

    it('treats the spacing as a maximum, never a target', () => {
        for (const jointLength of [12, 18, 24, 30, 36, 47]) {
            const r = computeDowelLayout({
                jointLength,
                stockThickness: 0.75,
                diameter: 0.25,
                spacing: DEFAULT_DOWEL_SPACING,
                endInset: DEFAULT_DOWEL_END_INSET,
            });
            expect(r.actualSpacing).toBeLessThanOrEqual(DEFAULT_DOWEL_SPACING + 1e-9);
        }
    });

    it('starts and ends on the insets', () => {
        const r = computeDowelLayout({
            jointLength: 24,
            stockThickness: 0.75,
            diameter: 0.25,
            spacing: 8,
            endInset: 1,
        });
        expect(r.positions[0]).toBeCloseTo(1, 10);
        expect(r.positions[r.positions.length - 1]).toBeCloseTo(23, 10);
    });

    it('centres a single dowel in a run too short to inset', () => {
        const r = computeDowelLayout({
            jointLength: 1.5,
            stockThickness: 0.75,
            diameter: 0.25,
            spacing: 8,
            endInset: 1,
        });
        expect(r.count).toBe(1);
        expect(r.positions).toEqual([0.75]);
    });

    it('derives a dowel size you can actually buy', () => {
        const r = computeDowelLayout({
            jointLength: 24,
            stockThickness: 0.75,
            diameter: null,
            spacing: 8,
            endInset: 1,
        });
        expect(DOWEL_SIZES.map((d) => d.diameter)).toContain(r.diameter);
        expect(r.diameter).toBeLessThanOrEqual(0.75 / 3 + 1e-9);
        expect(r.label).toBe('1/4"');
    });

    it('sizes the dowel and its holes together', () => {
        const r = computeDowelLayout({
            jointLength: 24,
            stockThickness: 0.75,
            diameter: 0.375,
            spacing: 8,
            endInset: 1,
        });
        expect(r.dowelLength).toBeCloseTo(1.5, 10);
        expect(r.holeDepthEach * 2).toBeGreaterThan(r.dowelLength); // room for glue at the bottom
    });

    it('warns when the dowel is too big for the stock', () => {
        const r = computeDowelLayout({
            jointLength: 24,
            stockThickness: 0.5,
            diameter: 0.375,
            spacing: 8,
            endInset: 1,
        });
        expect(r.notes.join(' ')).toContain('half the thickness');
    });
});
