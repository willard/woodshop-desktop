/**
 * Shared types and defaults for the shop calculators (D86).
 *
 * `resources/js/calc/` is pure TS — no DOM, no Vue, no `any`, decimal inches in and out, the same
 * contract `cutlist/` and `struct/` carry. It may import from `lib/`, `cutlist/`, `struct/` and, by
 * DEEP PATH ONLY, `spec/fasteners.ts` and `engine/config.ts`: the `@/engine` barrel drags Three.js
 * and the `@/spec` barrel drags Zod into what should be a small page bundle.
 *
 * Every calculator exports one pure, total `computeX(input): XResult`. There is deliberately no
 * `Calculator<I, R>` interface — see D86 for why a metadata-only registry beats an existential type.
 */

/** Tunables, in the spirit of DEFAULT_CUTLIST_CONFIG and DEFAULT_STRUCT_CONFIG. */
export interface CalcConfig {
    /** Denominator the measure field rounds display to. */
    readonly denominator: number;
    /** Default allowance for defects, snipe and trim, as a fraction. */
    readonly wasteFactor: number;
    /** Seasonal indoor relative humidity swing, percent, for the movement calculator. */
    readonly rhLow: number;
    readonly rhHigh: number;
}

export const DEFAULT_CALC_CONFIG: CalcConfig = {
    denominator: 16,
    wasteFactor: 0.1,
    rhLow: 30,
    rhHigh: 70,
};

/**
 * Advisory shop notes attached to a result — "end grain holds about half as well", not error
 * strings. Modelled on `StructIssue`: always informational, never blocking.
 */
export type CalcNotes = readonly string[];
