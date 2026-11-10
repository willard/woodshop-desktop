/**
 * Board feet for a stack of stock, priced (D86).
 *
 * Delegates the arithmetic to `cutlist/boardfeet.ts` so the calculator and the cut list can never
 * disagree — including the π/4 correction for round stock that D60 established.
 */
import { boardFeet, roundBoardFeet } from '../cutlist/boardfeet';

/** Rough thicknesses as the yard quotes them. 4/4 is one inch before planing. */
export const QUARTER_THICKNESSES: readonly { readonly label: string; readonly thickness: number }[] = [
    { label: '4/4', thickness: 1 },
    { label: '5/4', thickness: 1.25 },
    { label: '6/4', thickness: 1.5 },
    { label: '8/4', thickness: 2 },
    { label: '10/4', thickness: 2.5 },
    { label: '12/4', thickness: 3 },
    { label: '16/4', thickness: 4 },
];

export interface BoardFeetInput {
    /** Rough thickness, inches — or the diameter when `round` is set. */
    readonly thickness: number;
    /** Ignored entirely when `round` is set. */
    readonly width: number;
    readonly length: number;
    readonly qty: number;
    /** Defects, snipe and trim, as a fraction: 0.1 is ten percent. */
    readonly wasteFactor: number;
    readonly pricePerBoardFoot: number | null;
    /** Dowel or turning blank: a cylinder, not the square blank it came from. */
    readonly round: boolean;
}

export interface BoardFeetResult {
    readonly perPiece: number;
    readonly total: number;
    /** What to actually buy — the number that matters at the yard. */
    readonly withWaste: number;
    /** Priced on `withWaste`, because you pay for the waste too. Null with no price given. */
    readonly cost: number | null;
}

export function computeBoardFeet(input: BoardFeetInput): BoardFeetResult {
    const { thickness, width, length, qty, wasteFactor, pricePerBoardFoot, round } = input;

    const total = round ? roundBoardFeet(length, thickness, qty) : boardFeet(length, width, thickness, qty);

    const perPiece = qty === 0 ? 0 : total / qty;
    const withWaste = total * (1 + wasteFactor);

    return {
        perPiece,
        total,
        withWaste,
        cost: pricePerBoardFoot === null ? null : withWaste * pricePerBoardFoot,
    };
}
