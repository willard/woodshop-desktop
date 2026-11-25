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
    /** Part ids whose pieces are all cut. */
    cut: ReadonlySet<string>;
    /** Marks these parts cut, or not. */
    set(partIds: readonly string[], done: boolean): void;
    /** Unticks everything. */
    clear(): void;
}

/** The cut parts of the design stored under `key` (its project id). */
export function useCutProgress(key: string): CutProgress {
    const t = useTicks(CUT, key);
    return { cut: t.ticked, set: t.set, clear: t.clear };
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
    const set = useCallback(
        (ids: readonly string[], done: boolean) =>
            setState((prev) => {
                const next = new Set(prev.ticked);
                for (const id of ids) {
                    if (done) next.add(id);
                    else next.delete(id);
                }
                write(prefix, prev.key, next);
                return { key: prev.key, ticked: next };
            }),
        [prefix],
    );
    const clear = useCallback(
        () =>
            setState((prev) => {
                write(prefix, prev.key, new Set());
                return { key: prev.key, ticked: new Set<string>() };
            }),
        [prefix],
    );
    return { ticked, set, clear };
}
