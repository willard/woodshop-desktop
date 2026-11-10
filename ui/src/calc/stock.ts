/**
 * How much stock a pile of parts actually needs, kerf included (D86).
 *
 * Wraps `packLumber` and `packGuillotine` — the same packers the cut list uses, so the answers
 * agree — but with one addition that is NOT optional here.
 *
 * BOTH PACKERS MISHANDLE AN ITEM LARGER THAN THE STOCK. `packLumber` pushes a fresh stick and
 * records the cut without checking it fits, driving the stick's remaining length negative; a 100 in
 * rail against 96 in stock reports one stick. `packGuillotine` ignores the return of its second
 * `place()` call and adds to `usedArea` unconditionally, so an oversize part yields a phantom sheet
 * with no placement on it and a corrupted waste percentage. In the cut list the SpecLinter's "part
 * fits stock" rule means neither is ever reached. A calculator has no linter, so oversize items are
 * filtered out here and reported by name instead. Fixing the packers themselves would change
 * cut-list output and needs its own decision.
 */
import { packGuillotine, type SheetItem } from '../cutlist/guillotine';
import { packLumber, type LumberItem } from '../cutlist/lumber';
import type { LumberCut, Placement } from '../cutlist/types';

export interface StockPiece {
    /** Stable across runs — the packers tie-break on it, so results stay deterministic. */
    readonly id: string;
    readonly label: string;
    readonly length: number;
    /** Sheet mode only; ignored when estimating lumber. */
    readonly width: number;
    readonly qty: number;
    /** Grain-locked parts may not be rotated to fit. */
    readonly grainLocked: boolean;
}

export interface LumberStockInput {
    readonly pieces: readonly StockPiece[];
    readonly stockLength: number;
    readonly kerf: number;
    readonly pricePerStick: number | null;
}

export interface LumberStockResult {
    readonly stickCount: number;
    readonly cuts: readonly LumberCut[];
    readonly usedLength: number;
    readonly wastePercent: number;
    readonly cost: number | null;
    /** Labels of pieces longer than the stock. Excluded from packing, never silently packed. */
    readonly tooLong: readonly string[];
}

export interface SheetStockInput {
    readonly pieces: readonly StockPiece[];
    readonly sheet: { readonly l: number; readonly w: number };
    readonly kerf: number;
    readonly pricePerSheet: number | null;
}

export interface SheetStockResult {
    readonly sheetCount: number;
    readonly placements: readonly Placement[];
    readonly usedArea: number;
    readonly wastePercent: number;
    readonly cost: number | null;
    /** Labels of pieces that do not fit a sheet in any legal orientation. */
    readonly unplaced: readonly string[];
}

/** Whole positive quantities only; a fractional or absurd qty would multiply into nonsense. */
function repeats(qty: number): number {
    if (!Number.isFinite(qty) || qty < 1) {
        return 0;
    }
    return Math.min(Math.floor(qty), 999);
}

export function computeLumberStock(input: LumberStockInput): LumberStockResult {
    const { pieces, stockLength, kerf, pricePerStick } = input;

    const tooLong: string[] = [];
    const items: LumberItem[] = [];

    for (const piece of pieces) {
        if (piece.length <= 0) {
            continue;
        }
        if (piece.length > stockLength) {
            tooLong.push(piece.label);
            continue;
        }
        const n = repeats(piece.qty);
        for (let i = 0; i < n; i += 1) {
            items.push({ partId: `${piece.id}#${i}`, name: piece.label, length: piece.length });
        }
    }

    const packed = packLumber(items, stockLength, kerf);
    const capacity = packed.stickCount * stockLength;

    return {
        stickCount: packed.stickCount,
        cuts: packed.cuts,
        usedLength: packed.usedLength,
        wastePercent: capacity === 0 ? 0 : ((capacity - packed.usedLength) / capacity) * 100,
        cost: pricePerStick === null ? null : packed.stickCount * pricePerStick,
        tooLong,
    };
}

/** Does the piece fit the sheet in some orientation the grain allows? */
function fitsSheet(piece: StockPiece, sheet: { l: number; w: number }): boolean {
    const straight = piece.length <= sheet.l && piece.width <= sheet.w;
    if (straight) {
        return true;
    }
    if (piece.grainLocked) {
        return false;
    }
    return piece.width <= sheet.l && piece.length <= sheet.w;
}

export function computeSheetStock(input: SheetStockInput): SheetStockResult {
    const { pieces, sheet, kerf, pricePerSheet } = input;

    const unplaced: string[] = [];
    const items: SheetItem[] = [];

    for (const piece of pieces) {
        if (piece.length <= 0 || piece.width <= 0) {
            continue;
        }
        if (!fitsSheet(piece, sheet)) {
            unplaced.push(piece.label);
            continue;
        }
        const n = repeats(piece.qty);
        for (let i = 0; i < n; i += 1) {
            items.push({
                partId: `${piece.id}#${i}`,
                name: piece.label,
                w: piece.length,
                h: piece.width,
                rotatable: !piece.grainLocked,
            });
        }
    }

    const packed = packGuillotine(items, sheet, kerf);
    const capacity = packed.sheetCount * sheet.l * sheet.w;

    return {
        sheetCount: packed.sheetCount,
        placements: packed.placements,
        usedArea: packed.usedArea,
        wastePercent: capacity === 0 ? 0 : ((capacity - packed.usedArea) / capacity) * 100,
        cost: pricePerSheet === null ? null : packed.sheetCount * pricePerSheet,
        unplaced,
    };
}
