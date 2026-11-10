/**
 * Length unit conversion for the display layer (hard rule 3: dimensions are decimal inches
 * internally, and metric is a conversion on the way in and out — never a second internal unit).
 *
 * Pairs with `fraction.ts`: that one converts between inches and the way a woodworker writes them,
 * this one between inches and other units. Neither is the storage format; inches are.
 */

/** Millimetres in an inch. Exact by definition since 1959, not a measurement. */
export const MM_PER_INCH = 25.4;

export type LengthUnit = 'in' | 'ft' | 'mm' | 'cm' | 'm';

const PER_INCH: Readonly<Record<LengthUnit, number>> = {
    in: 1,
    ft: 1 / 12,
    mm: MM_PER_INCH,
    cm: MM_PER_INCH / 10,
    m: MM_PER_INCH / 1000,
};

const LABELS: Readonly<Record<LengthUnit, string>> = {
    in: 'in',
    ft: 'ft',
    mm: 'mm',
    cm: 'cm',
    m: 'm',
};

/** A value the user typed in `unit`, as decimal inches. */
export function toInches(value: number, unit: LengthUnit): number {
    return value / PER_INCH[unit];
}

/** Decimal inches, expressed in `unit`. */
export function fromInches(inches: number, unit: LengthUnit): number {
    return inches * PER_INCH[unit];
}

export function unitLabel(unit: LengthUnit): string {
    return LABELS[unit];
}

/**
 * Split inches into whole feet and the remainder, for reading a long dimension aloud:
 * 38.5 becomes 3 ft 2.5 in. Negative input keeps its sign on the feet.
 */
export function feetAndInches(inches: number): { readonly feet: number; readonly inches: number } {
    if (!Number.isFinite(inches)) {
        return { feet: 0, inches: 0 };
    }
    const sign = inches < 0 ? -1 : 1;
    const abs = Math.abs(inches);
    const feet = Math.floor(abs / 12);
    return { feet: sign * feet, inches: abs - feet * 12 };
}
