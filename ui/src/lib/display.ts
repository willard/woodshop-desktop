/**
 * How lengths are shown and read in this app: shop fractions, decimal inches or millimetres
 * (Settings ▸ Units). Storage is always decimal inches (hard rule 3); this is a conversion at the
 * edge, implemented once in Rust (`woodshop-core::units::display`).
 *
 * Every screen formats a length with `len()` and parses one with `parseLen()`, so switching the
 * setting switches the whole app. `useUnits()` makes a component re-render when it changes.
 */
import { useSyncExternalStore } from 'react';
import { wasm } from '@/domain';

export type Units = 'fraction' | 'decimal' | 'metric';

export const UNITS_OPTIONS: { value: Units; label: string; example: string }[] = [
    { value: 'fraction', label: 'Inches, fractions', example: '3 1/2"' },
    { value: 'decimal', label: 'Inches, decimal', example: '3.5"' },
    { value: 'metric', label: 'Millimetres', example: '89 mm' },
];

/** Countries that build in inches. Everyone else defaults to millimetres. */
const INCH_REGIONS = new Set(['US', 'LR', 'MM']);

/** The default before anyone chooses: inches where inches are the trade unit, else metric. */
export function defaultUnits(locale: string | undefined = globalThis.navigator?.language): Units {
    const region = locale?.split(/[-_]/)[1]?.toUpperCase();
    return region === undefined || INCH_REGIONS.has(region) ? 'fraction' : 'metric';
}

let current: Units = defaultUnits();
const listeners = new Set<() => void>();

export function setUnits(units: Units): void {
    if (units === current) return;
    current = units;
    for (const listener of listeners) listener();
}

export function getUnits(): Units {
    return current;
}

/** The current setting, re-rendering the component when it changes. */
export function useUnits(): Units {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current,
    );
}

export function isUnits(value: unknown): value is Units {
    return value === 'fraction' || value === 'decimal' || value === 'metric';
}

/** A length to read: `3 1/2"`, `3.5"`, `89 mm`. */
export function len(inches: number, units: Units = current): string {
    return wasm.formatLength(inches, units);
}

/** A length for an input field, with no unit mark: `3 1/2`, `3.5`, `89`. */
export function lenValue(inches: number, units: Units = current): string {
    return wasm.formatLengthValue(inches, units);
}

/** Two lengths as a size: `24" × 16"`, `610 × 406 mm`. */
export function size(a: number, b: number, units: Units = current): string {
    return units === 'metric'
        ? `${lenValue(a, units)} × ${lenValue(b, units)} mm`
        : `${len(a, units)} × ${len(b, units)}`;
}

/** Three lengths as one size, the unit said once in metric: `24" × 12" × 3/4"`, `610 × 305 × 18 mm`. */
export function dims(a: number, b: number, c: number, units: Units = current): string {
    return units === 'metric'
        ? `${lenValue(a, units)} × ${lenValue(b, units)} × ${lenValue(c, units)} mm`
        : `${len(a, units)} × ${len(b, units)} × ${len(c, units)}`;
}

/** What a person typed, in inches; null if unreadable or negative. A named unit (mm, cm, ", ') wins. */
export function parseLen(input: string, units: Units = current): number | null {
    return wasm.parseLength(input, units) ?? null;
}

/** As `parseLen`, but a leading minus is allowed (positions). */
export function parseSignedLen(input: string, units: Units = current): number | null {
    return wasm.parseSignedLength(input, units) ?? null;
}

/** The unit a bare number in a field means, for labels: `in` or `mm`. */
export function unitSuffix(units: Units = current): string {
    return units === 'metric' ? 'mm' : 'in';
}
