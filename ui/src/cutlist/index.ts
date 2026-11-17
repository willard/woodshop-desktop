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
import { DEFAULT_CUTLIST_CONFIG, type CutList, type CutListConfig } from './types';

export * from './types';
export * from './grouping';

/** The hardware list is worded in the reader's units unless `config.units` says otherwise. */
export function computeCutList(spec: Spec, config: CutListConfig = DEFAULT_CUTLIST_CONFIG): CutList {
    return wasm.computeCutList(spec, {
        units: getUnits(),
        hardwarePrices: getHardwarePrices(),
        ...config,
    }) as CutList;
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
