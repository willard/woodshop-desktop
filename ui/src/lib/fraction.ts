/**
 * The ONLY fraction math in the app. Woodworkers think in fractions; internally every dimension is
 * decimal inches. Parse on input, format on display. Implemented once, in Rust
 * (`woodshop-core::units::fraction`), and called through WebAssembly.
 */
import { wasm } from '@/domain';

/** "3/4" → 0.75, "1 1/2" → 1.5, "1-1/2" → 1.5, "1.5" → 1.5. Null when unparseable or negative. */
export function parseFraction(input: string): number | null {
    return wasm.parseFraction(input) ?? null;
}

/** As `parseFraction`, but a leading minus is allowed (positions are signed). Never −0. */
export function parseSignedFraction(input: string): number | null {
    return wasm.parseSignedFraction(input) ?? null;
}

/** 0.75 → "3/4", 1.5 → "1 1/2", 2 → "2", snapped to 1/denominator. No inch mark. */
export function formatFraction(value: number, denominator?: number): string {
    return wasm.formatFraction(value, denominator);
}
