/**
 * Friendly view model over a computed cut list (build-plan §5): identical blanks collapse into a
 * single ×N row, and rows are bucketed into per-material sections split by stock kind (sheet goods
 * vs. board lumber) with the stock to buy. Pure TS — no DOM, no Vue, and derived from `CutList`
 * alone, so `computeCutList` and its frozen golden snapshots are untouched (CLAUDE.md).
 *
 * Computed by the Rust core (`woodshop-core::cutlist::grouping`).
 */
import { wasm } from '@/domain';
import type { CutList, PartRow } from './types';

/** Identical blanks — same material and same L×W×T — merged into one row to cut N times. */
export interface CutListGroup {
    /** Stable identity for expansion state: `materialId|l|w|t` at 3dp. */
    key: string;
    materialId: string;
    /** Shared name for the merged rows, e.g. "Shelf" for Shelf 1/2/3. */
    label: string;
    length: number;
    width: number;
    thickness: number;
    /** Total pieces to cut — the count the user no longer has to tally by hand. */
    qty: number;
    boardFeet: number;
    /** Union of the member rows' op flags: true when *any* member needs that work. */
    curved?: boolean;
    notched?: boolean;
    mitered?: boolean;
    eased?: boolean;
    /** True when members disagree on an op flag — same blank, different machining. */
    mixedOps?: boolean;
    /** The original rows, in cut-list order: expansion, selection, and per-part naming. */
    members: PartRow[];
}

/** Stock to buy for a section. Formatting (fractions, pluralisation) is the view's job. */
export interface CutListStock {
    count: number;
    unit: 'sheet' | 'stick';
    l: number;
    /** Sheet width; absent for lumber, whose width is the board's nominal size. */
    w?: number;
}

/** One material's worth of the cut list. */
export interface CutListSection {
    materialId: string;
    materialName: string;
    /** Which pile it comes off: plywood/MDF sheets, board lumber, or unplanned stock. */
    kind: 'sheet' | 'lumber' | 'other';
    species?: string;
    thickness: number;
    groups: CutListGroup[];
    stock: CutListStock | null;
    boardFeet: number;
    cost: number | null;
    wastePercent: number | null;
}

/**
 * Buckets a cut list into per-material sections of merged rows. Section order is sheet goods
 * (in packing order), then lumber, then any material with no plan; groups run biggest-first.
 */
export function groupCutList(cutList: CutList): CutListSection[] {
    return wasm.groupCutList(cutList) as CutListSection[];
}

/** A name that reads for a whole group of rows ("Shelf 1/2/3" → "Shelf"). */
export function groupLabel(names: string[]): string {
    return wasm.groupLabel(names);
}
