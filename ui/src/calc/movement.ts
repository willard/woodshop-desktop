/**
 * How much a solid panel grows and shrinks between winter and summer (D86).
 *
 * Two independent sources of error, handled deliberately:
 *
 * 1. THE COEFFICIENTS. Transcribed from one cited source into `lib/species.ts` and pinned by value
 *    in its spec, because a typo here is a tabletop that splits.
 * 2. GRAIN ORIENTATION. Tangential movement is roughly twice radial, and most people do not know
 *    how their board was sawn. So BOTH readings are always returned, not just the selected one —
 *    a wrong guess should be visible rather than authoritative.
 *
 * The relative-humidity to equilibrium-moisture-content table is the standard one at about 70°F
 * (FPL Wood Handbook Ch. 4). EMC is temperature-dependent, but the extra precision of a full
 * Hailwood-Horrobin fit is far inside the error of "what humidity is your shop, actually".
 */
import { speciesById, type SpeciesId } from '../lib/species';
import type { CalcNotes } from './types';

export type Grain = 'flatsawn' | 'quartersawn' | 'riftsawn';

export type MoistureRange =
    | { readonly kind: 'rh'; readonly lowPercent: number; readonly highPercent: number }
    | { readonly kind: 'emc'; readonly lowPercent: number; readonly highPercent: number };

/** Relative humidity (%) to equilibrium moisture content (%) at ~70°F. */
const EMC_TABLE: readonly (readonly [number, number])[] = [
    [5, 1.4],
    [10, 2.6],
    [15, 3.5],
    [20, 4.5],
    [25, 5.4],
    [30, 6.2],
    [35, 6.9],
    [40, 7.7],
    [45, 8.5],
    [50, 9.3],
    [55, 10.1],
    [60, 11.0],
    [65, 12.0],
    [70, 13.1],
    [75, 14.4],
    [80, 16.0],
    [85, 18.0],
    [90, 20.5],
    [95, 24.3],
];

/** EMC at a given relative humidity, linearly interpolated between the table rows. */
export function emcFromRh(rhPercent: number): number {
    const rh = Math.min(95, Math.max(5, rhPercent));
    const last = EMC_TABLE.length - 1;
    for (let i = 0; i < last; i += 1) {
        const [r0, e0] = EMC_TABLE[i];
        const [r1, e1] = EMC_TABLE[i + 1];
        if (rh >= r0 && rh <= r1) {
            return e0 + ((rh - r0) / (r1 - r0)) * (e1 - e0);
        }
    }
    return EMC_TABLE[last][1];
}

export interface MovementInput {
    readonly speciesId: SpeciesId;
    /** The dimension ACROSS the grain — the one that moves. */
    readonly width: number;
    readonly grain: Grain;
    readonly moisture: MoistureRange;
}

export interface MovementResult {
    readonly lowEmc: number;
    readonly highEmc: number;
    readonly deltaEmc: number;
    /** The coefficient actually used, per 1% moisture content. */
    readonly coefficient: number;
    /** Total seasonal swing, inches. */
    readonly change: number;
    /** Half the swing — the clearance to leave at each edge. Usually the number you want. */
    readonly perSide: number;
    readonly widthAtLow: number;
    readonly widthAtHigh: number;
    /** Both orientations, always, so a wrong guess about the sawing is visible. */
    readonly flatsawnChange: number;
    readonly quartersawnChange: number;
    readonly notes: CalcNotes;
}

function emcEnds(moisture: MoistureRange): { low: number; high: number } {
    if (moisture.kind === 'emc') {
        return { low: moisture.lowPercent, high: moisture.highPercent };
    }
    return { low: emcFromRh(moisture.lowPercent), high: emcFromRh(moisture.highPercent) };
}

/** Rift is between the two; treat it as the midpoint rather than pretending to more precision. */
function coefficientFor(grain: Grain, tangential: number, radial: number): number {
    if (grain === 'flatsawn') {
        return tangential;
    }
    if (grain === 'quartersawn') {
        return radial;
    }
    return (tangential + radial) / 2;
}

export function computeMovement(input: MovementInput): MovementResult | null {
    const species = speciesById(input.speciesId);
    if (!species || species.tangential === null || species.radial === null) {
        return null; // a panel: it does not move across the face in any useful sense
    }

    const { low, high } = emcEnds(input.moisture);
    const deltaEmc = Math.abs(high - low);
    const coefficient = coefficientFor(input.grain, species.tangential, species.radial);
    const change = input.width * coefficient * deltaEmc;

    const notes: string[] = [
        'Only the across-grain dimension moves; along the grain is close enough to nothing to ignore.',
    ];
    if (input.grain === 'flatsawn') {
        notes.push(
            'Flatsawn moves about twice what quartersawn does. If you are not sure how the board was sawn, plan for this larger figure.',
        );
    }
    if (input.grain === 'riftsawn') {
        notes.push('Rift is taken as the midpoint of flatsawn and quartersawn.');
    }

    return {
        lowEmc: low,
        highEmc: high,
        deltaEmc,
        coefficient,
        change,
        perSide: change / 2,
        widthAtLow: input.width - change / 2,
        widthAtHigh: input.width + change / 2,
        flatsawnChange: input.width * species.tangential * deltaEmc,
        quartersawnChange: input.width * species.radial * deltaEmc,
        notes,
    };
}
