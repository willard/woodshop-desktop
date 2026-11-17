/**
 * Stock the user has on hand: part sheets and short boards left from other jobs, kept as the
 * `offcuts` setting for every design. The cut list cuts from them before it buys anything; a
 * piece belongs to a material by name and thickness. The PDF and agents read the same setting.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@/app/api';
import type { Material, Spec } from '@/spec';
import type { CutList, Offcut } from './types';

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

let serial = 0;

function piece(material: Material, l: number, w?: number): Offcut {
    serial += 1;
    const id = `o${Date.now().toString(36)}${serial.toString(36)}`;
    const base: Offcut = { id, material: material.name, thickness: material.thickness, l };
    return w === undefined ? base : { ...base, w };
}

/** Adds a piece of `material` on hand: length, and width for sheet goods. */
export async function addOffcut(material: Material, l: number, w?: number): Promise<void> {
    await save([...current, piece(material, l, w)]);
}

/** The pieces worth keeping once `cutList`'s parts are cut, as pieces on hand. */
export function leftoversOf(spec: Spec, cutList: CutList): Offcut[] {
    const out: Offcut[] = [];
    for (const plan of [...cutList.sheets, ...cutList.lumber]) {
        const material = spec.materials.find((m) => m.id === plan.materialId);
        if (material === undefined) continue;
        for (const left of plan.leftovers ?? []) out.push(piece(material, left.l, left.w));
    }
    return out;
}

/**
 * The design is cut: the pieces on hand it used are gone, and what is left over from its sheets
 * and boards (those pieces included) goes on the list for the next job.
 */
export async function keepLeftovers(spec: Spec, cutList: CutList): Promise<void> {
    const used = new Set(
        [...cutList.sheets, ...cutList.lumber].flatMap((p) => (p.offcuts ?? []).map((o) => o.id)),
    );
    await save([...current.filter((o) => !used.has(o.id)), ...leftoversOf(spec, cutList)]);
}

/** Forgets pieces: used up, or never there. */
export async function removeOffcuts(ids: readonly string[]): Promise<void> {
    await save(current.filter((o) => !ids.includes(o.id)));
}
