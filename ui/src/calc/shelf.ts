/**
 * Will the shelf sag? (D86)
 *
 * The arithmetic is `struct/beam.ts` — the same implementation the editor's sturdiness advisory
 * uses, so the two can never give different answers for the same shelf. What this adds is the
 * shop framing: a species picker that includes the panel products shelves are actually made from,
 * a verdict, the longest span that would still pass, and the caveats that stop the number being
 * read as more certain than it is.
 */
import { deflection, maxSpan, rectangleInertia, type BeamLoad, type EndCondition } from '../struct/beam';
import { DEFAULT_STRUCT_CONFIG } from '../struct/types';
import { modulusOf, speciesById, type SpeciesId } from '../lib/species';
import type { CalcNotes } from './types';

/** Above this fraction of the allowance a shelf passes, but with nothing in hand. */
const MARGINAL_AT = 0.8;

/**
 * A shelf sitting exactly on the allowance must not be called a failure by floating-point dust —
 * `maxSpan` inverts `deflection`, so feeding its own answer back lands within an ulp of 1.
 */
const RATIO_TOL = 1e-9;

export interface ShelfSagInput {
    /** Clear span between supports, inches. */
    readonly span: number;
    /** Front to back, inches. */
    readonly depth: number;
    readonly thickness: number;
    readonly speciesId: SpeciesId;
    readonly load: BeamLoad;
    readonly ends: EndCondition;
    /** Allowed deflection per foot of span, inches. */
    readonly allowedPerFoot: number;
}

export type SagVerdict = 'ok' | 'marginal' | 'sag';

export interface ShelfSagResult {
    readonly deflection: number;
    readonly allowed: number;
    /** Deflection over allowance. Above 1 it sags more than the eye forgives. */
    readonly ratio: number;
    /** Longest span that still passes at this section and load, inches. */
    readonly maxSpan: number;
    readonly modulus: number;
    readonly inertia: number;
    readonly verdict: SagVerdict;
    readonly notes: CalcNotes;
}

function verdictOf(ratio: number): SagVerdict {
    if (ratio > 1 + RATIO_TOL) {
        return 'sag';
    }
    return ratio >= MARGINAL_AT ? 'marginal' : 'ok';
}

export function computeShelfSag(input: ShelfSagInput): ShelfSagResult {
    const { span, depth, thickness, speciesId, load, ends, allowedPerFoot } = input;

    const modulus = modulusOf(speciesId);
    const inertia = rectangleInertia(depth, thickness);
    const d = deflection(load, span, modulus, inertia, ends);
    const allowed = (allowedPerFoot * span) / 12;
    const ratio = allowed === 0 ? 0 : d / allowed;

    const notes: string[] = [
        'This is fresh-load deflection. Wood keeps creeping under sustained weight — the per-foot limit already absorbs that.',
    ];

    const species = speciesById(speciesId);
    if (species?.kind === 'panel') {
        notes.push(
            'Panel stiffness varies a lot by brand and thickness; treat this as the shape of the answer, not a guarantee.',
        );
    }
    if (verdictOf(ratio) !== 'ok') {
        notes.push(
            'A glued-on front lip or a face frame stiffens a shelf far more than this bare rectangle predicts. If yours has one, this reads pessimistic.',
        );
    }
    if (ends === 'fixed') {
        notes.push(
            'Housed ends only count if the shelf really cannot rotate in the dado — a loose housing behaves closer to resting on supports.',
        );
    }

    return {
        deflection: d,
        allowed,
        ratio,
        maxSpan: maxSpan(load, modulus, inertia, allowedPerFoot, ends),
        modulus,
        inertia,
        verdict: verdictOf(ratio),
        notes,
    };
}

/** The advisory's own limit and load, so the calculator opens on what the editor assumes. */
export const DEFAULT_SAG_LIMIT_PER_FOOT = DEFAULT_STRUCT_CONFIG.sagLimitPerFoot;
export const DEFAULT_SHELF_LOAD_PER_FOOT = DEFAULT_STRUCT_CONFIG.shelfLoadPerFoot;
