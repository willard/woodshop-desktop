/**
 * Sturdiness assessment entry point — advisory structural checks (D38). Pure and
 * derived: the report is never stored; recompute from the spec. Never blocks anything;
 * client-only with no PHP mirror (the dual-runtime lint invariant covers buildability
 * gating, not advice).
 */
import type { Spec } from '../spec/types';
import { DEFAULT_STRUCT_CONFIG, type StructConfig, type StructIssue, type StructReport } from './types';
import { placeParts } from './placed';
import { checkTipping, checkSlenderness, checkRacking } from './heuristics';
import { checkSag } from './sag';

export * from './types';

export function assessSturdiness(spec: Spec, config: StructConfig = DEFAULT_STRUCT_CONFIG): StructReport {
    const placed = placeParts(spec);
    const issues: StructIssue[] = [];
    const shelves = checkSag(placed, config, issues);
    checkTipping(placed, config, issues);
    checkRacking(spec, placed, config, issues);
    checkSlenderness(placed, config, issues);
    return { issues, shelves };
}
