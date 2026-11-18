/**
 * Cut list engine types (build-plan §5). Pure TS — no DOM, no Vue. Everything is derived from
 * the spec and never stored; results recompute on demand (CLAUDE.md). Dimensions are decimal
 * inches (hard rule 3).
 */

/** One row of the parts table: a distinct part and how many to cut. */
export interface PartRow {
    partId: string;
    name: string;
    materialId: string;
    materialName: string;
    /** Wood species preset (spec 1.3), when the material declares one. */
    species?: string;
    /** True when the part has a curve op (spec 1.4): cut the rectangular blank, then template. */
    curved?: boolean;
    /** True when the part has a notch op (spec 1.7): cut the rectangular blank, then notch. */
    notched?: boolean;
    /** True when the part has a miter op: cut the blank to size, then bevel the named edge. */
    mitered?: boolean;
    /** True when the part has an ease op (spec 1.10): cut the blank, then run the router. */
    eased?: boolean;
    length: number;
    width: number;
    thickness: number;
    qty: number;
    boardFeet: number;
}

/** A placed piece on a sheet (origin at the sheet's bottom-left; x along length, y along width). */
export interface Placement {
    partId: string;
    name: string;
    /** 0-based index of the sheet within its material group. */
    sheet: number;
    x: number;
    y: number;
    /** Footprint on the sheet after any grain-legal rotation. */
    w: number;
    h: number;
    rotated: boolean;
}

/** Guillotine packing result for one sheet material. */
export interface SheetPlan {
    materialId: string;
    materialName: string;
    sheetSize: { l: number; w: number };
    sheetCount: number;
    placements: Placement[];
    /** Fraction of used sheet area that is offcut (0..1). */
    waste: number;
    cost: number | null;
    /** Pieces on hand cut from first; placement sheet `sheetCount + i` is `offcuts[i]`. */
    offcuts?: UsedOffcut[];
    /** Pieces worth keeping once the parts are cut out. */
    leftovers?: Leftover[];
    /** The saw cuts that free the parts, sheet by sheet, in the order to make them. */
    cuts?: SawCut[];
    /** Trimmed off every edge of a bought sheet first; its parts and cuts sit inside. */
    trim?: number;
}

/** One straight saw cut on a sheet or board, edge to edge of the piece it is made on. */
export interface SawCut {
    /** The sheet or board, numbered as placements or cuts are. */
    sheet: number;
    /** Its place in that sheet's order, from 1. */
    n: number;
    /** Where it starts (as placements are measured) and how long it runs. */
    x: number;
    y: number;
    l: number;
    /** Along the sheet's length (a rip, at `y`); otherwise across it (at `x`). */
    rip: boolean;
    /** Distance from the near edge of the piece it is cut on (bottom for a rip, left for a crosscut): where the fence goes. */
    off: number;
}

/** A piece left over once a plan's parts are cut: at least 12" × 6" of sheet, or 12" of board. */
export interface Leftover {
    /** The sheet or stick, numbered as placements or cuts are. */
    sheet: number;
    x: number;
    y: number;
    l: number;
    /** Width, for a piece of sheet. */
    w?: number;
}

/** A piece of stock the user has on hand (the `offcuts` setting). */
export interface Offcut {
    id: string;
    /** The material's name; matched with the thickness. */
    material: string;
    thickness: number;
    /** Length along the grain. */
    l: number;
    /** Width, for a sheet piece. */
    w?: number;
}

/** A piece on hand a plan cuts from. */
export interface UsedOffcut {
    id: string;
    l: number;
    w?: number;
}

/** One cut on a stick of lumber. */
export interface LumberCut {
    partId: string;
    name: string;
    length: number;
    /** 0-based index of the stock stick this cut is on. */
    stick: number;
    /** Where the cut starts along the board. */
    x: number;
    /** Where it starts across the board, when ripped beside another piece; absent means 0. */
    y?: number;
}

/** 1D stock-cutting result for one lumber material. */
export interface LumberPlan {
    materialId: string;
    materialName: string;
    stockLength: number;
    /** The board width, when the material gives one. */
    stockWidth?: number;
    /** Each bought board's length, where they differ; absent when every one is `stockLength`. */
    boardLengths?: number[];
    stickCount: number;
    cuts: LumberCut[];
    waste: number;
    cost: number | null;
    /** Pieces on hand cut from first; cut stick `stickCount + i` is `offcuts[i]`. */
    offcuts?: UsedOffcut[];
    /** Board ends worth keeping once the parts are cut. */
    leftovers?: Leftover[];
    /** The saw cuts that free the pieces, board by board, in order: crosscuts first, then rips. */
    sawCuts?: SawCut[];
    /** Trimmed off each end of a bought board first; its cuts sit between. */
    trim?: number;
}

/** One line of the hardware list (spec 1.8, movables 1.12): the metal to buy. */
export interface HardwareRow {
    /** The same thing to buy, whatever the units or wording: what a price is kept by. */
    key: string;
    kind: 'pocketScrew' | 'woodScrew' | 'dowel' | 'hinge' | 'drawerSlide' | 'knob' | 'other' | 'edgeBanding';
    /** Shop notation, e.g. `#8 × 1-1/4" wood screws`. */
    description: string;
    qty: number;
    /**
     * Estimated from a recorded joint rather than counted off a fastener op (1.14). A design can
     * say "these two parts are screwed together" without saying where the screws go, and a
     * hardware list that then reports nothing is worse than one that reports an estimate — five
     * screw joints and two dowel joints used to come back as `hardware: []`. Place the fastener
     * ops to turn an estimate into a count.
     */
    derived?: true;
    /** The price of one (or a foot or metre of banding), from the user's price list. */
    unitPrice?: number;
    /** qty × unitPrice, when it has a price. */
    cost?: number;
}

export interface CutListTotals {
    boardFeet: number;
    sheetCount: number;
    /** Materials plus priced hardware; null when nothing has a price. */
    estimatedCost: number | null;
    materialCost?: number;
    hardwareCost?: number;
    /** Overall offcut fraction across all material (0..1). */
    wastePercent: number;
    /** About what the wood weighs once built, in pounds. */
    weight: number;
    /** Surface to finish, every face and edge, in square feet. */
    finishArea: number;
}

export interface CutList {
    parts: PartRow[];
    sheets: SheetPlan[];
    lumber: LumberPlan[];
    /** Screws and dowels the design calls for, merged by size (spec 1.8). */
    hardware: HardwareRow[];
    totals: CutListTotals;
}

export interface CutListConfig {
    /** Saw kerf between adjacent pieces (build-plan §5 default 1/8"). */
    kerf: number;
    /** How the hardware list words sizes; the numbers stay inches. Defaults to the setting. */
    units?: 'fraction' | 'decimal' | 'metric';
    /** Prices by hardware row key. Defaults to the user's price list. */
    hardwarePrices?: Readonly<Record<string, number>>;
    /** Stock on hand, cut from first. Defaults to the user's list. */
    offcuts?: readonly Offcut[];
    /** Trimmed off each edge of a bought sheet first. Defaults to the setting. */
    sheetTrim?: number;
    /** Trimmed off each end of a bought board first. Defaults to the setting. */
    boardTrim?: number;
}

export const DEFAULT_CUTLIST_CONFIG: CutListConfig = {
    kerf: 0.125,
};

/** One shopping list for several designs (`woodshop-core::cutlist::shopping`). */
export interface ShoppingList {
    /** One plan per material, the designs' pieces packed onto shared sheets. */
    sheets: SheetPlan[];
    lumber: LumberPlan[];
    /** Every design's hardware, added up by key. */
    hardware: HardwareRow[];
    totals: CutListTotals;
    /** What the designs would need bought one at a time. */
    separateSheets: number;
    separateBoards: number;
}
