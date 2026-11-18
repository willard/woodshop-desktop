/**
 * Sheet edge trim: what is cut off every edge of a bought sheet before its parts, since a factory
 * edge is often dinged or out of square. One setting (`sheetTrim`, inches) for every design; the
 * PDF, labels and agents read the same setting. A material whose part needs the whole sheet keeps
 * its factory edges (the core reports the trim each plan took as `SheetPlan.trim`).
 */
import { useSyncExternalStore } from 'react';
import { api } from '@/app/api';

/** None, then 1/8" to 1/2". */
export const TRIM_OPTIONS = [0, 0.125, 0.25, 0.375, 0.5];

let current = 0;
const listeners = new Set<() => void>();

/** Reads the setting's value: a trim of zero or more, else none. */
export function parseSheetTrim(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function setSheetTrim(trim: number): void {
    current = trim;
    for (const listener of listeners) listener();
}

export function getSheetTrim(): number {
    return current;
}

export function useSheetTrim(): number {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current,
    );
}

/** Sets the trim and saves it. */
export async function saveSheetTrim(trim: number): Promise<void> {
    setSheetTrim(trim);
    await api.setSetting('sheetTrim', trim);
}
