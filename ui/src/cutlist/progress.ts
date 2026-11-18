/**
 * Which parts of a design have been cut, ticked off in the cut list as the reader works through
 * it in the shop. Remembered on this device per design; nothing in the design changes.
 */
import { useCallback, useState } from 'react';

const PREFIX = 'woodshop.cut.';

function read(key: string): Set<string> {
    try {
        const raw: unknown = JSON.parse(window.localStorage.getItem(PREFIX + key) ?? '[]');
        return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

function write(key: string, cut: ReadonlySet<string>): void {
    try {
        if (cut.size === 0) window.localStorage.removeItem(PREFIX + key);
        else window.localStorage.setItem(PREFIX + key, JSON.stringify([...cut]));
    } catch {
        // Not remembered; the ticks still show until the panel closes.
    }
}

export interface CutProgress {
    /** Part ids whose pieces are all cut. */
    cut: ReadonlySet<string>;
    /** Marks these parts cut, or not. */
    set(partIds: readonly string[], done: boolean): void;
    /** Unticks everything. */
    clear(): void;
}

/** The cut parts of the design stored under `key` (its project id). */
export function useCutProgress(key: string): CutProgress {
    const [state, setState] = useState(() => ({ key, cut: read(key) }));
    // A different design: start from what is stored for it.
    const cut = state.key === key ? state.cut : read(key);
    if (state.key !== key) setState({ key, cut });
    const set = useCallback(
        (partIds: readonly string[], done: boolean) =>
            setState((prev) => {
                const next = new Set(prev.cut);
                for (const id of partIds) {
                    if (done) next.add(id);
                    else next.delete(id);
                }
                write(prev.key, next);
                return { key: prev.key, cut: next };
            }),
        [],
    );
    const clear = useCallback(
        () =>
            setState((prev) => {
                write(prev.key, new Set());
                return { key: prev.key, cut: new Set() };
            }),
        [],
    );
    return { cut, set, clear };
}
