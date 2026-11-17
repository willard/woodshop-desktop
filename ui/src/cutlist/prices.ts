/**
 * The user's hardware prices: one price list for every design, kept as the `hardwarePrices`
 * setting and keyed by hardware row key (`HardwareRow.key`). A price is for one piece, or for a
 * foot or metre of edge banding. Shared like the units setting, so every cut list — the panel,
 * the CSV, the PDF (which reads the setting itself) — is costed the same.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@/app/api';

export type HardwarePrices = Readonly<Record<string, number>>;

let current: HardwarePrices = {};
const listeners = new Set<() => void>();

/** Reads the setting's value, keeping only real prices. */
export function parseHardwarePrices(value: unknown): HardwarePrices {
    if (typeof value !== 'object' || value === null) return {};
    return Object.fromEntries(
        Object.entries(value).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0),
    );
}

export function setHardwarePrices(prices: HardwarePrices): void {
    current = prices;
    for (const listener of listeners) listener();
}

export function getHardwarePrices(): HardwarePrices {
    return current;
}

export function useHardwarePrices(): HardwarePrices {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current,
    );
}

/** Sets (or, with null, clears) the price for one row, and saves the list. */
export async function saveHardwarePrice(key: string, price: number | null): Promise<void> {
    const next: Record<string, number> = { ...current };
    if (price === null) delete next[key];
    else next[key] = price;
    setHardwarePrices(next);
    await api.setSetting('hardwarePrices', next);
}
