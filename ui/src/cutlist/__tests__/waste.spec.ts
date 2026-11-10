import { describe, it, expect } from 'vitest';
import { computeCutList } from '../index';
import type { Spec } from '../../spec/types';

/**
 * One sheet cut efficiently plus one stick barely touched. Sheets are measured in area and
 * sticks in length, so combining their waste needs a common unit — board feet — or the stick
 * disappears behind the sheet's much larger raw numbers.
 */
function mixedStockSpec(): Spec {
    return {
        specVersion: '1.14',
        units: 'in',
        name: 'Mixed stock',
        materials: [
            {
                id: 'mat_ply',
                type: 'sheet',
                name: 'Ply',
                thickness: 0.75,
                sheetSize: { l: 96, w: 48 },
                grain: true,
            },
            {
                id: 'mat_pine',
                type: 'lumber',
                name: 'Pine 1x4',
                thickness: 0.75,
                stockWidth: 3.5,
                stockLengths: [96],
                grain: true,
            },
        ],
        parts: [
            {
                id: 'p_panel',
                name: 'Panel',
                materialId: 'mat_ply',
                size: { l: 90, w: 45 },
                grainAxis: 'l',
                transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
            },
            {
                id: 'p_stub',
                name: 'Stub',
                materialId: 'mat_pine',
                size: { l: 4, w: 3.5 },
                grainAxis: 'l',
                transform: { pos: [0, 10, 0], rot: [0, 0, 0] },
            },
        ],
    } as unknown as Spec;
}

describe('cut-list waste totals', () => {
    it('weighs sheet and lumber waste by the board feet each buys', () => {
        const cutList = computeCutList(mixedStockSpec());
        const [sheet] = cutList.sheets;
        const [lumber] = cutList.lumber;

        expect(sheet.waste).toBeLessThan(0.2); // 90×45 out of 96×48
        expect(lumber.waste).toBeGreaterThan(0.9); // a 4" cut off a 96" stick

        // Board feet bought: 96×48×0.75/144 = 24 for the sheet, 96×3.5×0.75/144 = 1.75 for the
        // stick. The combined figure is those two wastes weighted by that stock.
        const expected = (24 * sheet.waste + 1.75 * lumber.waste) / (24 + 1.75);
        expect(cutList.totals.wastePercent).toBeCloseTo(expected, 10);

        // The stick is a small share of the stock, but it is no longer invisible: adding square
        // inches to inches put this at 0.138, barely above the sheet's own figure.
        expect(cutList.totals.wastePercent).toBeGreaterThan(sheet.waste + 0.02);
    });

    it('reports a single plan its own waste unchanged', () => {
        const spec = mixedStockSpec();
        spec.parts = [spec.parts[0]];
        const cutList = computeCutList(spec);

        expect(cutList.totals.wastePercent).toBeCloseTo(cutList.sheets[0].waste, 10);
    });

    it('never reports negative waste when a part outruns its stock', () => {
        const spec = mixedStockSpec();
        spec.parts = [{ ...spec.parts[1], size: { l: 120, w: 3.5 } }];
        const cutList = computeCutList(spec);

        // The spec is unbuildable and the linter says so (`part.oversized`); the cut list must
        // not dress it up as a stick with -25% waste.
        expect(cutList.lumber[0].waste).toBe(0);
        expect(cutList.totals.wastePercent).toBeGreaterThanOrEqual(0);
    });
});
