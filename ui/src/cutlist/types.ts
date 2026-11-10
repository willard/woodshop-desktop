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
}

/** One cut on a stick of lumber. */
export interface LumberCut {
    partId: string;
    name: string;
    length: number;
    /** 0-based index of the stock stick this cut is on. */
    stick: number;
}

/** 1D stock-cutting result for one lumber material. */
export interface LumberPlan {
    materialId: string;
    materialName: string;
    stockLength: number;
    stickCount: number;
    cuts: LumberCut[];
    waste: number;
    cost: number | null;
}

/** One line of the hardware list (spec 1.8, movables 1.12): the metal to buy. */
export interface HardwareRow {
    kind: 'pocketScrew' | 'woodScrew' | 'dowel' | 'hinge' | 'drawerSlide' | 'knob';
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
}

export interface CutListTotals {
    boardFeet: number;
    sheetCount: number;
    estimatedCost: number | null;
    /** Overall offcut fraction across all material (0..1). */
    wastePercent: number;
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
}

export const DEFAULT_CUTLIST_CONFIG: CutListConfig = {
    kerf: 0.125,
};
