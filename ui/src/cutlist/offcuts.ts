/**
 * Stock the user has on hand: part sheets and short boards left from other jobs, kept as the
 * `offcuts` setting for every design. The cut list cuts from them before it buys anything; a
 * piece belongs to a material by name and thickness. The PDF and agents read the same setting.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@/app/api';
import type { Material } from '@/spec';
import type { Offcut } from './types';

let current: readonly Offcut[] = [];
const listeners = new Set<() => void>();

/** Reads the setting's value, keeping only well-formed pieces. */
export function parseOffcuts(value: unknown): Offcut[] {
    if (!Array.isArray(value)) return [];
    const size = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
    return value.filter(
        (o): o is Offcut =>
            typeof o === 'object' &&
            o !== null &&
            typeof (o as Offcut).id === 'string' &&
            typeof (o as Offcut).material === 'string' &&
            size((o as Offcut).thickness) &&
            size((o as Offcut).l) &&
            ((o as Offcut).w === undefined || size((o as Offcut).w)),
    );
}

export function setOffcuts(offcuts: readonly Offcut[]): void {
    current = offcuts;
    for (const listener of listeners) listener();
}

export function getOffcuts(): readonly Offcut[] {
    return current;
}

export function useOffcuts(): readonly Offcut[] {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current,
    );
}

/** The same test as the core's `Offcut::is`: the material's name in any case, thickness to a 64th. */
export function isOffcutOf(offcut: Offcut, material: Material): boolean {
    return (
        offcut.material.trim().toLowerCase() === material.name.trim().toLowerCase() &&
        Math.abs(offcut.thickness - material.thickness) < 1 / 64
    );
}

async function save(next: readonly Offcut[]): Promise<void> {
    setOffcuts(next);
    await api.setSetting('offcuts', next);
}

/** Adds a piece of `material` on hand: length, and width for sheet goods. */
export async function addOffcut(material: Material, l: number, w?: number): Promise<void> {
    const id = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const piece: Offcut = { id, material: material.name, thickness: material.thickness, l };
    await save([...current, w === undefined ? piece : { ...piece, w }]);
}

/** Forgets pieces: used up, or never there. */
export async function removeOffcuts(ids: readonly string[]): Promise<void> {
    await save(current.filter((o) => !ids.includes(o.id)));
}
