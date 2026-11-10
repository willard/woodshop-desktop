import { describe, it, expect } from 'vitest';
import { assessSturdiness } from '@/struct';
import { parseSpec } from '@/spec';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';
import recordStand from '@fixtures/specs/record-stand.spec.json';

describe('assessSturdiness — golden fixtures', () => {
    it('bookshelf: tall case tips, but every 30.5" shelf span passes', () => {
        const report = assessSturdiness(parseSpec(bookshelf));
        expect(report.issues.map((i) => i.code)).toEqual(['struct.tipping']);
        // Top + three shelves analyzed; bottom rests on the floor and is skipped.
        expect(report.shelves.map((s) => s.partId)).toEqual(['p_top', 'p_shelf_1', 'p_shelf_2', 'p_shelf_3']);
        for (const row of report.shelves) {
            expect(row.span).toBeCloseTo(30.5, 3);
            expect(row.deflection).toBeLessThan(row.allowed);
        }
    });

    it('record stand: top and middle shelf both sag over the 36.6" span (D38)', () => {
        const report = assessSturdiness(parseSpec(recordStand));
        expect(report.issues.map((i) => i.code)).toEqual(['struct.sag', 'struct.sag']);
        expect(report.issues.map((i) => i.partId)).toEqual(['p_top', 'p_shelf_1']);
        expect(report.shelves.map((s) => s.partId)).toEqual(['p_top', 'p_shelf_1']);
        const shelfRow = report.shelves[1];
        expect(shelfRow.span).toBeCloseTo(36.582, 3);
        expect(shelfRow.deflection).toBeCloseTo(0.0661, 3);
        expect(shelfRow.allowed).toBeCloseTo(0.061, 3);
        // Messages carry fraction-formatted numbers via lib/fraction.
        expect(report.issues[1].message).toContain('1/16"');
        expect(report.issues[1].message).toContain('36 9/16"');
    });
});
