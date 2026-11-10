/**
 * Sturdiness assessment — advisory structural checks layered on top of the spec
 * (docs/DECISIONS.md D38). Pure and derived like cutlist: the report is never stored;
 * recompute from the spec. Client-only — no PHP mirror, never blocks anything.
 */
import type { Species } from '../spec/types';
import { modulusOf } from '../lib/species';

/** Always advisory: sturdiness never blocks a save, an AI round-trip, or an edit. */
export interface StructIssue {
    readonly severity: 'warn';
    readonly code: string;
    readonly message: string;
    readonly partId?: string;
}

/** One analyzed shelf span — recorded whether it passes or not. */
export interface ShelfSagRow {
    readonly partId: string;
    /** Clear span between supports, inches. */
    readonly span: number;
    /** Predicted mid-span deflection at the configured load, inches. */
    readonly deflection: number;
    /** Allowed deflection for this span (sagLimitPerFoot · span/12), inches. */
    readonly allowed: number;
    /** Modulus of elasticity used, psi. */
    readonly modulus: number;
}

export interface StructReport {
    readonly issues: StructIssue[];
    readonly shelves: ShelfSagRow[];
}

export interface StructConfig {
    /** Uniform shelf load, lb per linear foot of span. */
    shelfLoadPerFoot: number;
    /** Allowed deflection per foot of span, inches. */
    sagLimitPerFoot: number;
    /** Warn when assembly height / min horizontal footprint exceeds this. */
    tippingRatio: number;
    /** Warn when a vertical stick's length / min cross-section exceeds this. */
    slendernessRatio: number;
    /** Parts with min(l, w) above this are panels, not sticks, inches. */
    stickMaxWidth: number;
    /** Racking check only considers assemblies at least this tall, inches (Infinity disables). */
    rackingMinHeight: number;
    /** A shear panel must cover this fraction of the assembly's largest vertical face. */
    rackingCoverageFrac: number;
    /** A crediting stretcher must run this fraction of the racking face's width. */
    rackingStretcherSpanFrac: number;
    /** A crediting stretcher pair must be separated by this fraction of the height. */
    rackingStretcherRiseFrac: number;
    /** A crediting stretcher must be at least this deep vertically, inches. */
    rackingStretcherMinDepth: number;
    /** A sag support must overlap this fraction of the shelf's depth. */
    supportDepthFrac: number;
    /** Modulus for sheet goods without a species, psi (softwood plywood). */
    sheetE: number;
    /** Modulus for lumber without a species, psi (conservative pine). */
    lumberDefaultE: number;
    /** Species modulus of elasticity, psi (FPL Wood Handbook). */
    speciesE: Record<Species, number>;
}

export const DEFAULT_STRUCT_CONFIG: StructConfig = {
    shelfLoadPerFoot: 20,
    sagLimitPerFoot: 0.02,
    tippingRatio: 4,
    slendernessRatio: 25,
    stickMaxWidth: 4,
    rackingMinHeight: 24,
    rackingCoverageFrac: 0.5,
    rackingStretcherSpanFrac: 0.6,
    rackingStretcherRiseFrac: 0.5,
    rackingStretcherMinDepth: 2.5,
    supportDepthFrac: 0.5,
    sheetE: 1_100_000,
    lumberDefaultE: 1_200_000,
    // Single-sourced from lib/species.ts so the sturdiness advisory and the shelf-sag calculator
    // can never disagree about how stiff a species is (D86). species.spec.ts guards the values.
    speciesE: {
        pine: modulusOf('pine'),
        oak: modulusOf('oak'),
        maple: modulusOf('maple'),
        walnut: modulusOf('walnut'),
        cherry: modulusOf('cherry'),
    },
};
