/**
 * What you already have, so it is not bought: a design's materials (`m:<id>`) and hardware
 * (`h:<key>`), kept per design on this device, and tools (by name), kept once for every design,
 * since a tool you own serves them all. The cut list's shopping list and the shopping page both
 * tick and read them.
 */
import { useSyncExternalStore } from 'react';
import type { Have } from './types';

const PREFIX = 'woodshop.have.';
/** Where the tools you have are kept. */
export const TOOLS = 'tools';

const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
let version = 0;

function read(key: string): ReadonlySet<string> {
    const hit = cache.get(key);
    if (hit) return hit;
    let items = new Set<string>();
    try {
        const raw: unknown = JSON.parse(window.localStorage.getItem(PREFIX + key) ?? '[]');
        if (Array.isArray(raw)) items = new Set(raw.filter((s): s is string => typeof s === 'string'));
    } catch {
        // Unreadable: nothing had.
    }
    cache.set(key, items);
    return items;
}

/** What the design (or `TOOLS`) stored under `key` has. */
export function haveOf(key: string): ReadonlySet<string> {
    return read(key);
}

/** Marks `items` of the design under `key` as had, or not. */
export function setHave(key: string, items: readonly string[], had: boolean): void {
    const next = new Set(read(key));
    for (const item of items) {
        if (had) next.add(item);
        else next.delete(item);
    }
    cache.set(key, next);
    try {
        if (next.size === 0) window.localStorage.removeItem(PREFIX + key);
        else window.localStorage.setItem(PREFIX + key, JSON.stringify([...next]));
    } catch {
        // Not remembered; the ticks last until the page closes.
    }
    version += 1;
    for (const listener of listeners) listener();
}

/** Re-renders when anything had changes; read with [`haveOf`]. */
export function useHaveChanges(): number {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => version,
    );
}

/** A design's ticks as the shopping list takes them. */
export function haveFor(key: string): Have {
    const items = [...read(key)];
    const strip = (prefix: string) =>
        items.filter((i) => i.startsWith(prefix)).map((i) => i.slice(prefix.length));
    return { materials: strip('m:'), hardware: strip('h:') };
}

/** Forgets what was read, so the next read is from storage (tests). */
export function resetHaveCache(): void {
    cache.clear();
}
