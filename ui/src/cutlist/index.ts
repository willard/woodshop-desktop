/**
 * Cut list engine entry point. Parts table, sheet layouts (guillotine, grain- and kerf-aware),
 * lumber/round stick cutting, board feet, cost, waste and hardware — computed by the Rust core
 * (`woodshop-core::cutlist`) so the panel, the PDF plan and an MCP agent read identical numbers.
 * Pure and derived: never stored, recompute from the spec.
 */
import { wasm } from '@/domain';
import { getUnits } from '@/lib/display';
import type { Spec } from '../spec/types';
import { getHardwarePrices } from './prices';
import { getOffcuts } from './offcuts';
import { getTrim } from './trim';
import { DEFAULT_CUTLIST_CONFIG, type CutList, type CutListConfig, type ShoppingList } from './types';

export * from './types';
export * from './grouping';
export * from './boards';

/** The hardware list is worded in the reader's units unless `config.units` says otherwise. */
export function computeCutList(spec: Spec, config: CutListConfig = DEFAULT_CUTLIST_CONFIG): CutList {
    return wasm.computeCutList(spec, {
        units: getUnits(),
        hardwarePrices: getHardwarePrices(),
        offcuts: getOffcuts(),
        sheetTrim: getTrim('sheetTrim'),
        boardTrim: getTrim('boardTrim'),
        ...config,
    }) as CutList;
}

/** One list to buy for several designs: shared material packed together, hardware added up. */
export function shoppingList(specs: Spec[], config: CutListConfig = DEFAULT_CUTLIST_CONFIG): ShoppingList {
    return wasm.shoppingList(specs, {
        units: getUnits(),
        hardwarePrices: getHardwarePrices(),
        offcuts: getOffcuts(),
        sheetTrim: getTrim('sheetTrim'),
        boardTrim: getTrim('boardTrim'),
        ...config,
    }) as ShoppingList;
}

/** Smaller panel to buy when a single sheet is mostly offcut (advisory only). */
export interface StockSuggestion {
    materialId: string;
    materialName: string;
    currentStock: string;
    partsFitWithin: string;
    suggestedStock: string;
    wastePercent: number;
    /** In shop fractions (what MCP agents read); the app words its own with `adviceText`. */
    message: string;
    currentSize: { l: number; w: number };
    neededSize: { l: number; w: number };
    suggestedSize: { l: number; w: number };
}

export function stockAdvice(cutList: CutList, spec: Spec): StockSuggestion[] {
    return wasm.stockAdvice(cutList, spec) as StockSuggestion[];
}

/** One step of putting the piece together: a heading and a line per part or piece of hardware. */
export interface AssemblyStep {
    heading: string;
    lines: string[];
}

/** The order to assemble the design, the same steps the PDF plan prints. */
export function assemblyOrder(spec: Spec): AssemblyStep[] {
    return wasm.assemblyOrder(spec) as AssemblyStep[];
}

/** One tool setting (a dado stack, bit or blade angle) and every cut made at it. */
export interface JoinerySetup {
    setup: string;
    /** Cuts in all, counting each copy of a part. */
    cuts: number;
    parts: string;
}

/** The design's joinery in shop words, as the PDF plan prints it (`woodshop-core::joinery`). */
export interface Joinery {
    setups: JoinerySetup[];
    /** Parts cut the same way, and the cuts that shape them. */
    parts: { parts: string; lines: string[] }[];
}

export function joinery(spec: Spec, units = getUnits()): Joinery {
    return wasm.joinery(spec, units) as Joinery;
}
