/**
 * Cut list engine entry point. Parts table, sheet layouts (guillotine, grain- and kerf-aware),
 * lumber/round stick cutting, board feet, cost, waste and hardware — computed by the Rust core
 * (`woodshop-core::cutlist`) so the panel, the PDF plan and an MCP agent read identical numbers.
 * Pure and derived: never stored, recompute from the spec.
 */
import { wasm } from '@/domain';
import type { Spec } from '../spec/types';
import { DEFAULT_CUTLIST_CONFIG, type CutList, type CutListConfig } from './types';

export * from './types';
export * from './grouping';

export function computeCutList(spec: Spec, config: CutListConfig = DEFAULT_CUTLIST_CONFIG): CutList {
    return wasm.computeCutList(spec, config) as CutList;
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
