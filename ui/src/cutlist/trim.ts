/**
 * Trimming bought stock before its parts are cut: every edge of a sheet (`sheetTrim`), since a
 * factory edge is often dinged or out of square, and each end of a board (`boardTrim`), since ends
 * are often checked or sniped. One setting each, in inches, for every design; the PDF, labels and
 * agents read the same settings. A material whose part needs the whole sheet or board keeps it
 * whole (the core reports the trim each plan took as `trim`), and round stock is never trimmed.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@/app/api';

export type TrimKey = 'sheetTrim' | 'boardTrim';

/** None, then 1/8" to 1/2" off a sheet's edges, or 1/2" to 2" off a board's ends. */
export const TRIM_OPTIONS: Record<TrimKey, number[]> = {
    sheetTrim: [0, 0.125, 0.25, 0.375, 0.5],
    boardTrim: [0, 0.5, 1, 1.5, 2],
};

const current: Record<TrimKey, number> = { sheetTrim: 0, boardTrim: 0 };
const listeners = new Set<() => void>();

/** Reads a setting's value: a trim of zero or more, else none. */
export function parseTrim(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function setTrim(key: TrimKey, trim: number): void {
    current[key] = trim;
    for (const listener of listeners) listener();
}

export function getTrim(key: TrimKey): number {
    return current[key];
}

export function useTrim(key: TrimKey): number {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current[key],
    );
}

/** Sets a trim and saves it. */
export async function saveTrim(key: TrimKey, trim: number): Promise<void> {
    setTrim(key, trim);
    await api.setSetting(key, trim);
}
