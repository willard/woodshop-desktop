import { describe, it, expect } from 'vitest';
import { computeLumberStock, computeSheetStock, type StockPiece } from '@/calc/stock';
import { DEFAULT_CUTLIST_CONFIG } from '@/cutlist/types';
import { DEFAULT_STOCK_LENGTH } from '@/lib/lumberSizes';

const KERF = DEFAULT_CUTLIST_CONFIG.kerf; // 1/8 in
const SHEET = { l: 96, w: 48 };

function piece(over: Partial<StockPiece> = {}): StockPiece {
    return { id: 'p', label: 'Part', length: 30, width: 6, qty: 1, grainLocked: false, ...over };
}

describe('computeLumberStock', () => {
    it('fits five 30-inch pieces onto two eight-foot sticks', () => {
        // Three per stick: 3 x 30.125 = 90.375, and a fourth will not go.
        const r = computeLumberStock({
            pieces: [piece({ id: 'rail', label: 'Rail', length: 30, qty: 5 })],
            stockLength: DEFAULT_STOCK_LENGTH,
            kerf: KERF,
            pricePerStick: null,
        });
        expect(r.stickCount).toBe(2);
        expect(r.cuts).toHaveLength(5);
        expect(r.usedLength).toBeCloseTo(150, 10);
        expect(r.tooLong).toEqual([]);
    });

    it('sets aside a piece longer than the stock instead of packing it', () => {
        // Guards cutlist/lumber.ts: it pushes a fresh stick and records the cut without checking it
        // fits, driving the remaining length negative — a 100 in rail would report ONE stick.
        const good = computeLumberStock({
            pieces: [piece({ id: 'rail', label: 'Rail', length: 30, qty: 5 })],
            stockLength: 96,
            kerf: KERF,
            pricePerStick: null,
        });
        const withOversize = computeLumberStock({
            pieces: [
                piece({ id: 'rail', label: 'Rail', length: 30, qty: 5 }),
                piece({ id: 'beam', label: 'Long beam', length: 100, qty: 1 }),
            ],
            stockLength: 96,
            kerf: KERF,
            pricePerStick: null,
        });

        expect(withOversize.tooLong).toEqual(['Long beam']);
        // The oversize piece changed nothing else — it never reached the packer.
        expect(withOversize.stickCount).toBe(good.stickCount);
        expect(withOversize.usedLength).toBeCloseTo(good.usedLength, 10);
        expect(withOversize.cuts).toHaveLength(good.cuts.length);
    });

    it('reports no sticks at all when everything is too long', () => {
        const r = computeLumberStock({
            pieces: [piece({ label: 'Long beam', length: 100, qty: 3 })],
            stockLength: 96,
            kerf: KERF,
            pricePerStick: null,
        });
        expect(r.stickCount).toBe(0);
        expect(r.wastePercent).toBe(0);
        expect(r.tooLong).toEqual(['Long beam']);
    });

    it('does not get two 48-inch pieces out of an 8-foot board, because of the kerf', () => {
        // The reality the estimator exists to surface: 2 x 48 is exactly 96, but the first cut
        // eats an eighth, so the second piece starts a second stick. Half the material is waste.
        const r = computeLumberStock({
            pieces: [piece({ label: 'Rail', length: 48, qty: 2 })],
            stockLength: 96,
            kerf: KERF,
            pricePerStick: 24,
        });
        expect(r.stickCount).toBe(2);
        expect(r.usedLength).toBeCloseTo(96, 10);
        expect(r.wastePercent).toBeCloseTo(50, 6);
        expect(r.cost).toBe(48);
    });

    it('gets both out once they are trimmed to clear the kerf', () => {
        const r = computeLumberStock({
            pieces: [piece({ label: 'Rail', length: 47.875, qty: 2 })],
            stockLength: 96,
            kerf: KERF,
            pricePerStick: 24,
        });
        expect(r.stickCount).toBe(1);
        expect(r.cost).toBe(24);
        expect(r.wastePercent).toBeLessThan(1);
    });

    it('is deterministic across runs', () => {
        const args = {
            pieces: [
                piece({ id: 'a', label: 'A', length: 30, qty: 3 }),
                piece({ id: 'b', label: 'B', length: 44, qty: 2 }),
                piece({ id: 'c', label: 'C', length: 12, qty: 5 }),
            ],
            stockLength: 96,
            kerf: KERF,
            pricePerStick: null,
        };
        expect(computeLumberStock(args)).toEqual(computeLumberStock(args));
    });

    it('ignores nonsense quantities rather than multiplying them out', () => {
        expect(
            computeLumberStock({
                pieces: [piece({ qty: 0 }), piece({ id: 'q', qty: -4 }), piece({ id: 'r', qty: 0.5 })],
                stockLength: 96,
                kerf: KERF,
                pricePerStick: null,
            }).stickCount,
        ).toBe(0);
    });
});

describe('computeSheetStock', () => {
    it('nests parts onto sheets', () => {
        const r = computeSheetStock({
            pieces: [piece({ id: 'side', label: 'Side', length: 30, width: 12, qty: 4 })],
            sheet: SHEET,
            kerf: KERF,
            pricePerSheet: null,
        });
        expect(r.sheetCount).toBe(1);
        expect(r.placements).toHaveLength(4);
        expect(r.unplaced).toEqual([]);
        expect(r.wastePercent).toBeGreaterThan(0);
        expect(r.wastePercent).toBeLessThan(100);
    });

    it('sets aside an oversize part instead of conjuring a sheet for it', () => {
        // Guards cutlist/guillotine.ts: it ignores the return of its second place() call and adds
        // to usedArea unconditionally, so an oversize part yields a phantom sheet with nothing on
        // it AND a corrupted waste percentage.
        const r = computeSheetStock({
            pieces: [piece({ label: 'Huge panel', length: 120, width: 60, qty: 1 })],
            sheet: SHEET,
            kerf: KERF,
            pricePerSheet: null,
        });
        expect(r.unplaced).toEqual(['Huge panel']);
        expect(r.sheetCount).toBe(0);
        expect(r.placements).toHaveLength(0);
        expect(r.usedArea).toBe(0);
        expect(r.wastePercent).toBe(0);
    });

    it('leaves the rest of the estimate untouched when one part is oversize', () => {
        const args = {
            pieces: [piece({ id: 'side', label: 'Side', length: 30, width: 12, qty: 4 })],
            sheet: SHEET,
            kerf: KERF,
            pricePerSheet: null,
        };
        const good = computeSheetStock(args);
        const withOversize = computeSheetStock({
            ...args,
            pieces: [...args.pieces, piece({ id: 'big', label: 'Huge panel', length: 120, width: 60 })],
        });
        expect(withOversize.sheetCount).toBe(good.sheetCount);
        expect(withOversize.usedArea).toBeCloseTo(good.usedArea, 10);
        expect(withOversize.unplaced).toEqual(['Huge panel']);
    });

    it('will not turn a grain-locked part to make it fit', () => {
        // 40 x 60 does not fit a 96 x 48 sheet as it lies, but does when turned.
        const turned = piece({ id: 'top', label: 'Top', length: 40, width: 60, grainLocked: false });
        const locked = piece({ id: 'top', label: 'Top', length: 40, width: 60, grainLocked: true });

        expect(
            computeSheetStock({ pieces: [turned], sheet: SHEET, kerf: KERF, pricePerSheet: null }).sheetCount,
        ).toBe(1);
        const r = computeSheetStock({ pieces: [locked], sheet: SHEET, kerf: KERF, pricePerSheet: null });
        expect(r.sheetCount).toBe(0);
        expect(r.unplaced).toEqual(['Top']);
    });

    it('prices by the sheet', () => {
        const r = computeSheetStock({
            pieces: [piece({ id: 'side', label: 'Side', length: 30, width: 12, qty: 4 })],
            sheet: SHEET,
            kerf: KERF,
            pricePerSheet: 82.5,
        });
        expect(r.cost).toBeCloseTo(82.5 * r.sheetCount, 8);
    });

    it('is deterministic across runs', () => {
        const args = {
            pieces: [
                piece({ id: 'a', label: 'A', length: 30, width: 12, qty: 3 }),
                piece({ id: 'b', label: 'B', length: 24, width: 24, qty: 4 }),
            ],
            sheet: SHEET,
            kerf: KERF,
            pricePerSheet: null,
        };
        expect(computeSheetStock(args)).toEqual(computeSheetStock(args));
    });
});
