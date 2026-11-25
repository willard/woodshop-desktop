/**
 * What has been done in the shop, ticked off as the reader works through a design: the parts cut
 * (in the cut list) and the build steps done (in build mode). Remembered on this device per
 * design; nothing in the design changes.
 */
import { useCallback, useState } from 'react';

const CUT = 'woodshop.cut.';
const BUILT = 'woodshop.built.';

function read(prefix: string, key: string): Set<string> {
    try {
        const raw: unknown = JSON.parse(window.localStorage.getItem(prefix + key) ?? '[]');
        return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

function write(prefix: string, key: string, cut: ReadonlySet<string>): void {
    try {
        if (cut.size === 0) window.localStorage.removeItem(prefix + key);
        else window.localStorage.setItem(prefix + key, JSON.stringify([...cut]));
    } catch {
        // Not remembered; the ticks still show until the panel closes.
    }
}

export interface CutProgress {
    /**
     * What is cut: a part id when all its pieces are, or a [`pieceKey`] for one piece of a part
     * whose others are not all cut yet. Read it with [`isPieceCut`] and [`piecesCutOf`].
     */
    cut: ReadonlySet<string>;
    /** Marks every piece of these parts cut, or none of them. */
    set(partIds: readonly string[], done: boolean): void;
    /** Ticks one piece (copy `copy` of a part cut `qty` times), or unticks it. */
    toggle(partId: string, copy: number, qty: number): void;
    /** Unticks everything. */
    clear(): void;
}

/**
 * One piece of a part cut more than once: copy `copy` (from 0) of it. Copies of a part are the
 * same piece, so a layout that moves them about keeps the count right, and a tick on a piece
 * stays on that part whatever else changes.
 */
export function pieceKey(partId: string, copy: number): string {
    return `${partId}#${copy}`;
}

export function isPieceCut(cut: ReadonlySet<string>, partId: string, copy: number): boolean {
    return cut.has(partId) || cut.has(pieceKey(partId, copy));
}

/** How many of a part's `qty` pieces are cut. */
export function piecesCutOf(cut: ReadonlySet<string>, partId: string, qty: number): number {
    if (cut.has(partId)) return qty;
    let n = 0;
    for (let copy = 0; copy < qty; copy++) if (cut.has(pieceKey(partId, copy))) n += 1;
    return n;
}

/** The cut parts of the design stored under `key` (its project id). */
export function useCutProgress(key: string): CutProgress {
    const t = useTicks(CUT, key);
    const { update } = t;
    const set = useCallback(
        (ids: readonly string[], done: boolean) =>
            update((next) => {
                const parts = new Set(ids);
                for (const k of [...next]) {
                    const hash = k.lastIndexOf('#');
                    if (hash > 0 && parts.has(k.slice(0, hash))) next.delete(k);
                }
                for (const id of ids) {
                    if (done) next.add(id);
                    else next.delete(id);
                }
            }),
        [update],
    );
    const toggle = useCallback(
        (partId: string, copy: number, qty: number) =>
            update((next) => {
                const key = pieceKey(partId, copy);
                const wasCut = next.has(partId) || next.has(key);
                if (next.has(partId)) {
                    // All were cut: now all but this one.
                    next.delete(partId);
                    for (let c = 0; c < qty; c++) next.add(pieceKey(partId, c));
                }
                if (wasCut) next.delete(key);
                else next.add(key);
                const copies = Array.from({ length: qty }, (_, c) => pieceKey(partId, c));
                if (copies.every((k) => next.has(k))) {
                    for (const k of copies) next.delete(k);
                    next.add(partId);
                }
            }),
        [update],
    );
    return { cut: t.ticked, set, toggle, clear: t.clear };
}

export interface BuildProgress {
    /** The keys ([`stepKey`]) of the steps done. */
    done: ReadonlySet<string>;
    set(stepKeys: readonly string[], done: boolean): void;
    clear(): void;
}

/** A build step's name for ticking off: its heading and parts, so a step that changes with the
 * design starts unticked. */
export function stepKey(step: { heading: string; partIds: readonly string[] }): string {
    return `${step.heading}|${step.partIds.join(',')}`;
}

/** The build steps done for the design stored under `key` (its project id). */
export function useBuildProgress(key: string): BuildProgress {
    const t = useTicks(BUILT, key);
    return { done: t.ticked, set: t.set, clear: t.clear };
}

function useTicks(prefix: string, key: string) {
    const [state, setState] = useState(() => ({ key, ticked: read(prefix, key) }));
    // A different design: start from what is stored for it.
    const ticked = state.key === key ? state.ticked : read(prefix, key);
    if (state.key !== key) setState({ key, ticked });
    const update = useCallback(
        (change: (next: Set<string>) => void) =>
            setState((prev) => {
                const next = new Set(prev.ticked);
                change(next);
                write(prefix, prev.key, next);
                return { key: prev.key, ticked: next };
            }),
        [prefix],
    );
    const set = useCallback(
        (ids: readonly string[], done: boolean) =>
            update((next) => {
                for (const id of ids) {
                    if (done) next.add(id);
                    else next.delete(id);
                }
            }),
        [update],
    );
    const clear = useCallback(
        () =>
            setState((prev) => {
                write(prefix, prev.key, new Set());
                return { key: prev.key, ticked: new Set<string>() };
            }),
        [prefix],
    );
    return { ticked, set, update, clear };
}
