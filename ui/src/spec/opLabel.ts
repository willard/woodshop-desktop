/**
 * The one op vocabulary (§3.1). The editor's Inspector and the standalone plan viewer (D85)
 * both read it, so a shop drawing and the screen can never disagree about what a dado is.
 * Pure — no DOM.
 */
import type { Op } from './types';
import { wasm } from '@/domain';
import { getUnits, len } from '@/lib/display';

/** Formats a decimal-inch measurement the way hard rule 3 requires — via lib/fraction, only. */
export const inch = (n: number): string => `${len(n)}`;

/**
 * One line a woodworker can read: what the cut is, how big, and where (§3.1 vocabulary, in shop
 * words), in the reader's units. Worded by the Rust core (`spec::describe`), which the PDF plan
 * also prints, so the screen and the printed plan can never disagree.
 */
export function opSummary(op: Op): string {
    return wasm.opSummary(op, getUnits());
}
