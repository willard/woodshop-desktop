/**
 * Buildability linter: the rules the JSON Schema can't express (part fits material, op fits part,
 * dado width = mate thickness, nothing floats, nothing pierces, everything fastened, …).
 * Implemented in Rust (`woodshop-core::lint`) and pinned there by the parity corpus.
 *
 * Severity: `error` means "not buildable as written"; `warn` is "legal, probably a mistake".
 */
import { wasm } from '@/domain';
import type { Spec } from './types';

export type Severity = 'error' | 'warn';

export interface LintIssue {
    readonly severity: Severity;
    readonly code: string;
    readonly message: string;
    readonly partId?: string;
    readonly opIndex?: number;
    readonly jointIndex?: number;
    /** The joint's stable id (1.14), alongside — never instead of — `jointIndex`. */
    readonly jointId?: string;
}

export function lintSpec(spec: Spec): LintIssue[] {
    return wasm.lintSpec(spec) as LintIssue[];
}
