/**
 * Board lengths in a lumber plan: each bought board is cut from the shortest listed length its
 * cuts fit, so a plan can buy boards of more than one length (`boardLengths`).
 */
import type { LumberPlan } from './types';

/** The length of bought board `i`. */
export function boardLength(plan: LumberPlan, i: number): number {
    return plan.boardLengths?.[i] ?? plan.stockLength;
}

/** The boards to buy as [length, how many], longest first. */
export function boughtBoards(plan: LumberPlan): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < plan.stickCount; i++) {
        const l = boardLength(plan, i);
        const same = out.find(([len]) => Math.abs(len - l) < 1e-9);
        if (same) same[1]++;
        else out.push([l, 1]);
    }
    return out.sort((a, b) => b[0] - a[0]);
}

/** `96"`, or `1 × 120", 2 × 96"` when the boards differ in length. */
export function boardSizes(plan: LumberPlan, len: (inches: number) => string): string {
    const bought = boughtBoards(plan);
    if (bought.length < 2) return len(plan.stockLength);
    return bought.map(([l, n]) => `${n} × ${len(l)}`).join(', ');
}

/** The most lengths a material may list (the spec's limit), and the longest board, in inches. */
export const MAX_STOCK_LENGTHS = 8;
export const MAX_STOCK_LENGTH = 240;

/**
 * Lengths on sale as typed, comma-separated ("96, 120", "2440, 3000"): shortest first, each once.
 * Null when one is not a length, is out of range, or there are none or too many.
 */
export function parseStockLengths(raw: string, parse: (input: string) => number | null): number[] | null {
    const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
    if (items.length === 0) return null;
    const lengths: number[] = [];
    for (const item of items) {
        const l = parse(item);
        if (l === null || !(l > 0) || l > MAX_STOCK_LENGTH) return null;
        if (!lengths.some((x) => Math.abs(x - l) < 1e-9)) lengths.push(l);
    }
    if (lengths.length > MAX_STOCK_LENGTHS) return null;
    return lengths.sort((a, b) => a - b);
}
