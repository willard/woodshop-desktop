/**
 * Length conversion, and the number no other converter shows: how far the fraction you will
 * actually mark rounds off from the exact value (D86).
 *
 * 25 mm reads as 1 in at sixteenths and is 0.0157 in under. Over a six-drawer stack that is a
 * sixteenth of visible error, and it is invisible in any converter that only prints the fraction.
 */
import { formatFraction } from '../lib/fraction';
import { feetAndInches, fromInches } from '../lib/units';

export interface ConversionInput {
    readonly inches: number;
    /** 8, 16, 32 or 64 — how fine a rule you are reading. */
    readonly denominator: number;
}

export interface ConversionResult {
    readonly inches: number;
    /** As it would be written and marked, e.g. "1 1/2". */
    readonly fraction: string;
    /** Signed: snapped minus exact. Positive means the mark is long. */
    readonly fractionError: number;
    readonly feetInches: { readonly feet: number; readonly inches: number };
    readonly mm: number;
    readonly cm: number;
    readonly m: number;
}

/** Snap to the nearest 1/denominator — the value the printed fraction actually represents. */
function snap(inches: number, denominator: number): number {
    return Math.round(inches * denominator) / denominator;
}

export function computeConversion(input: ConversionInput): ConversionResult {
    const { inches, denominator } = input;

    return {
        inches,
        fraction: formatFraction(inches, denominator),
        fractionError: snap(inches, denominator) - inches,
        feetInches: feetAndInches(inches),
        mm: fromInches(inches, 'mm'),
        cm: fromInches(inches, 'cm'),
        m: fromInches(inches, 'm'),
    };
}
