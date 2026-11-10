/**
 * Proportion helpers for sizing a case and graduating its drawers (D86).
 *
 * Not arithmetic anyone needs help with — the value is having the common ratios to hand under their
 * names, and the graduated division that makes a stack of drawers look designed rather than evenly
 * chopped up.
 */
import type { CalcNotes } from './types';

export const PHI = 1.618033988749895;

export interface Ratio {
    readonly id: string;
    readonly label: string;
    readonly value: number;
}

export const RATIOS: readonly Ratio[] = [
    { id: 'golden', label: 'Golden section (1 : 1.618)', value: PHI },
    { id: 'root2', label: 'Root two (1 : 1.414)', value: Math.SQRT2 },
    { id: 'threeTwo', label: '3 : 2', value: 1.5 },
    { id: 'fourThree', label: '4 : 3', value: 4 / 3 },
    { id: 'fiveThree', label: '5 : 3', value: 5 / 3 },
    { id: 'fiveFour', label: '5 : 4', value: 1.25 },
    { id: 'double', label: '2 : 1', value: 2 },
];

export interface ProportionInput {
    readonly known: number;
    readonly ratioValue: number;
    /** Whether the dimension you have is the larger or the smaller of the pair. */
    readonly direction: 'larger' | 'smaller';
}

export interface ProportionResult {
    readonly larger: number;
    readonly smaller: number;
    /** The known dimension divided in the same ratio — where a rail or a shelf would sit. */
    readonly sectionMajor: number;
    readonly sectionMinor: number;
    /** The nearest ratio expressible in small whole numbers. */
    readonly nearestSimple: { readonly a: number; readonly b: number };
    readonly notes: CalcNotes;
}

/** Nearest a/b with a small denominator, by continued fractions. */
function nearestSimpleRatio(value: number, maxDenominator = 12): { a: number; b: number } {
    let bestA = 1;
    let bestB = 1;
    let bestError = Infinity;
    for (let b = 1; b <= maxDenominator; b += 1) {
        const a = Math.round(value * b);
        if (a < 1) {
            continue;
        }
        const error = Math.abs(value - a / b);
        if (error < bestError - 1e-12) {
            bestError = error;
            bestA = a;
            bestB = b;
        }
    }
    return { a: bestA, b: bestB };
}

export function computeProportion(input: ProportionInput): ProportionResult | null {
    const { known, ratioValue, direction } = input;
    if (!(known > 0) || !(ratioValue > 0)) {
        return null;
    }

    const larger = direction === 'larger' ? known : known * ratioValue;
    const smaller = direction === 'larger' ? known / ratioValue : known;

    // Divide the known dimension in the same ratio: the parts sum back to the whole.
    const sectionMajor = (known * ratioValue) / (1 + ratioValue);

    const notes: string[] = [];
    if (Math.abs(ratioValue - PHI) < 1e-9) {
        notes.push('The golden section is a starting point, not a rule — trust the drawing over the number.');
    }

    return {
        larger,
        smaller,
        sectionMajor,
        sectionMinor: known - sectionMajor,
        nearestSimple: nearestSimpleRatio(ratioValue),
        notes,
    };
}

/**
 * Drawer fronts that grow toward the bottom, the way a chest of drawers reads properly.
 * Returns each part's height top to bottom; they sum to the total once the gaps are taken out.
 */
export function computeGraduatedDivision(
    total: number,
    parts: number,
    ratio: number,
    gap: number,
): readonly number[] {
    if (!Number.isInteger(parts) || parts < 1 || !(total > 0) || !(ratio > 0)) {
        return [];
    }

    const available = total - gap * (parts - 1);
    if (available <= 0) {
        return [];
    }

    const weights = Array.from({ length: parts }, (_, i) => Math.pow(ratio, i));
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => (available * w) / sum);
}
