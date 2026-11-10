/**
 * Mortise-and-tenon proportions and dowel layout (D86).
 *
 * The tenon rule is the old one — a third of the rail — with the correction that matters in a real
 * shop: it is snapped DOWN to a chisel or mortiser bit you actually own, because a 0.25in tenon you
 * can chop beats a 0.2467in tenon you cannot.
 */
import { DOWEL_SIZES, dowelLabelOf } from '../lib/lumberSizes';
import { DEFAULT_DOWEL_CONFIG } from '../engine/config';
import type { CalcNotes } from './types';

export interface JoineryConfig {
    /** Mortise widths you can actually cut, inches. */
    readonly chiselSizes: readonly number[];
    /** Tenon thickness as a fraction of the rail. */
    readonly tenonRatio: number;
    /** Glue relief cut past the end of the tenon so it seats on its shoulders, not its end. */
    readonly mortiseRelief: number;
    /** Cap on the edge shoulder, so a deep rail does not get a comically narrow tenon. */
    readonly maxShoulder: number;
    /** A blind mortise goes this fraction into the stile. */
    readonly blindDepthFraction: number;
}

export const DEFAULT_JOINERY_CONFIG: JoineryConfig = {
    chiselSizes: [0.25, 0.3125, 0.375, 0.5],
    tenonRatio: 1 / 3,
    mortiseRelief: 0.0625,
    maxShoulder: 0.375,
    blindDepthFraction: 2 / 3,
};

export interface MortiseTenonInput {
    readonly railThickness: number;
    readonly railWidth: number;
    readonly stileThickness: number;
    readonly through: boolean;
    readonly haunched: boolean;
    readonly config?: JoineryConfig;
}

export interface MortiseTenonResult {
    readonly tenonThickness: number;
    readonly tenonLength: number;
    readonly tenonWidth: number;
    /** Cheek shoulder, each face of the rail. */
    readonly shoulderFace: number;
    /** Edge shoulder, top and bottom of the rail width. */
    readonly shoulderEdge: number;
    readonly mortiseWidth: number;
    readonly mortiseDepth: number;
    readonly haunchDepth: number | null;
    readonly notes: CalcNotes;
}

/** The largest chisel at or below the ideal — never larger, which would weaken the rail. */
function snapDownToChisel(ideal: number, sizes: readonly number[]): number {
    const usable = [...sizes].sort((a, b) => a - b).filter((s) => s <= ideal + 1e-9);
    return usable.length > 0 ? usable[usable.length - 1] : Math.min(...sizes);
}

export function computeMortiseTenon(input: MortiseTenonInput): MortiseTenonResult {
    const config = input.config ?? DEFAULT_JOINERY_CONFIG;
    const { railThickness, railWidth, stileThickness, through, haunched } = input;

    const tenonThickness = snapDownToChisel(railThickness * config.tenonRatio, config.chiselSizes);
    const shoulderFace = (railThickness - tenonThickness) / 2;
    const shoulderEdge = Math.min(railWidth / 6, config.maxShoulder);
    const tenonWidth = Math.max(0, railWidth - 2 * shoulderEdge);

    const tenonLength = through ? stileThickness : stileThickness * config.blindDepthFraction;
    const mortiseDepth = through ? stileThickness : tenonLength + config.mortiseRelief;

    const ideal = railThickness * config.tenonRatio;
    const notes: string[] = [];
    if (tenonThickness > ideal + 1e-9) {
        // Thinner stock than the smallest chisel can serve by the third rule. Say so rather than
        // returning a tenon that quietly leaves thinner cheeks than the user expects.
        notes.push(
            `A third of this rail is ${ideal.toFixed(3)}in, thinner than your smallest chisel. At ${tenonThickness}in the cheeks are only ${shoulderFace.toFixed(3)}in — consider a thicker rail or a smaller bit.`,
        );
    } else if (tenonThickness < ideal - 1e-9) {
        notes.push(
            `A third of the rail is ${ideal.toFixed(3)}in; this is snapped down to the nearest chisel you have.`,
        );
    }
    if (!through && mortiseDepth > stileThickness) {
        notes.push('The mortise would break through the far face — shorten the tenon or go through.');
    }
    if (through) {
        notes.push(
            'A through tenon shows end grain on the outside face; wedge it or leave it proud and chamfered.',
        );
    }

    return {
        tenonThickness,
        tenonLength,
        tenonWidth,
        shoulderFace,
        shoulderEdge,
        mortiseWidth: tenonThickness,
        mortiseDepth,
        haunchDepth: haunched ? Math.min(shoulderEdge, tenonLength / 2) : null,
        notes,
    };
}

export interface DowelLayoutInput {
    /** Length of the run being joined, inches. */
    readonly jointLength: number;
    readonly stockThickness: number;
    /** Null derives it from the stock: about a third, snapped to a size you can buy. */
    readonly diameter: number | null;
    /** Maximum gap between dowels — the actual spacing comes out at or under this. */
    readonly spacing: number;
    readonly endInset: number;
}

export interface DowelLayoutResult {
    readonly diameter: number;
    readonly label: string;
    readonly count: number;
    /** Centres measured from the start of the run, inches. */
    readonly positions: readonly number[];
    readonly actualSpacing: number;
    readonly dowelLength: number;
    readonly holeDepthEach: number;
    readonly notes: CalcNotes;
}

function snapDownToDowel(ideal: number): number {
    const usable = DOWEL_SIZES.filter((s) => s.diameter <= ideal + 1e-9);
    return usable.length > 0 ? usable[usable.length - 1].diameter : DOWEL_SIZES[0].diameter;
}

export function computeDowelLayout(input: DowelLayoutInput): DowelLayoutResult {
    const { jointLength, stockThickness, spacing, endInset } = input;

    const diameter = input.diameter ?? snapDownToDowel(stockThickness / 3);
    const usable = jointLength - 2 * endInset;

    let count: number;
    let positions: number[];
    let actualSpacing: number;

    if (usable <= 0) {
        // Too short to inset both ends: one dowel, centred.
        count = 1;
        positions = [jointLength / 2];
        actualSpacing = 0;
    } else {
        // Spacing is a maximum, so round the gap count UP and let the actual spacing fall under it.
        const gaps = Math.max(1, Math.ceil(usable / spacing));
        count = gaps + 1;
        actualSpacing = usable / gaps;
        positions = Array.from({ length: count }, (_, i) => endInset + i * actualSpacing);
    }

    // A dowel wants about four diameters of length, half buried in each board.
    const dowelLength = diameter * 4;
    const holeDepthEach = dowelLength / 2 + 0.0625;

    const notes: string[] = [];
    if (diameter > stockThickness / 2) {
        notes.push(
            'That dowel is more than half the thickness of the stock — it leaves very little wood either side.',
        );
    }
    notes.push('Drill both halves from the same reference face, or the joint will step.');

    return {
        diameter,
        label: dowelLabelOf(diameter) ?? `${diameter}in`,
        count,
        positions,
        actualSpacing,
        dowelLength,
        holeDepthEach,
        notes,
    };
}

/** The editor's own dowel spacing, so the calculator opens on what the app assumes. */
export const DEFAULT_DOWEL_SPACING = DEFAULT_DOWEL_CONFIG.spacing;
export const DEFAULT_DOWEL_END_INSET = DEFAULT_DOWEL_CONFIG.endInset;
