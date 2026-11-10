/**
 * Public entry point for the spec layer. Every spec that enters the app — a stored draft, an
 * imported file, a restored version — is migrated on read, validated against the JSON Schema and
 * given its schema defaults here, by the Rust core.
 *
 * Types still come from the generated Zod schema (`import type` only — no Zod at runtime).
 */
import { wasm } from '@/domain';
import { CURRENT_SPEC_VERSION } from './migrations';
import type { Spec } from './types';

export { CURRENT_SPEC_VERSION };
export { overallSize, type OverallSize } from './geometry';
export { opSummary, inch } from './opLabel';
export type { Spec, Material, Part, Joint, Group, Movable, Op, Axis, Edge, Vec3, Species } from './types';

/** A spec that failed migration or validation; `issues` holds one readable line per problem. */
export class SpecError extends Error {
    constructor(readonly issues: string[]) {
        super(issues.join('\n'));
        this.name = 'SpecError';
    }
}

type SafeParse = { status: 'ok'; data: Spec } | { status: 'err'; messages: string[] };

/** Migrate → validate → defaults. Throws a SpecError on invalid input. */
export function parseSpec(input: unknown): Spec {
    const result = wasm.safeParseSpec(input) as SafeParse;
    if (result.status === 'err') {
        throw new SpecError(result.messages);
    }
    return result.data;
}

/** Non-throwing variant, shaped like Zod's result so callers read `.success` / `.data`. */
export function safeParseSpec(
    input: unknown,
): { success: true; data: Spec } | { success: false; error: SpecError } {
    const result = wasm.safeParseSpec(input) as SafeParse;
    return result.status === 'ok'
        ? { success: true, data: result.data }
        : { success: false, error: new SpecError(result.messages) };
}
