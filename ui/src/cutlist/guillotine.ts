/**
 * 2D guillotine packing for loose sheet items (the Stock calculator). Deterministic; the Rust
 * core (`woodshop-core::cutlist::pack`) is the implementation the cut list itself uses.
 */
import { wasm } from '@/domain';
import type { Placement } from './types';

export interface SheetItem {
    partId: string;
    name: string;
    /** Footprint along the sheet length (x). */
    w: number;
    /** Footprint along the sheet width (y). */
    h: number;
    rotatable: boolean;
}

export interface PackedSheets {
    sheetCount: number;
    placements: Placement[];
    /** Total area consumed by placed parts (excludes kerf and offcut). */
    usedArea: number;
}

export function packGuillotine(
    items: readonly SheetItem[],
    sheet: { l: number; w: number },
    kerf: number,
): PackedSheets {
    return wasm.packGuillotine(items, sheet, kerf) as PackedSheets;
}
