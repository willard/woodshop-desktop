/**
 * 1D first-fit-decreasing stick cutting for loose items (the Stock calculator), via the Rust core.
 */
import { wasm } from '@/domain';
import type { LumberCut } from './types';

export interface LumberItem {
    partId: string;
    name: string;
    length: number;
}

export interface PackedLumber {
    stickCount: number;
    cuts: LumberCut[];
    usedLength: number;
}

export function packLumber(items: readonly LumberItem[], stockLength: number, kerf: number): PackedLumber {
    return wasm.packLumber(items, stockLength, kerf) as PackedLumber;
}
