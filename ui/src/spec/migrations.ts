/**
 * On-read spec migrations. Implemented in Rust (`woodshop-core::spec::migrate`); every stored
 * spec is upgraded to the current version before it is validated.
 */
import { wasm } from '@/domain';

export const CURRENT_SPEC_VERSION = '1.15' as const;

/** Applies every step from the spec's version up to CURRENT_SPEC_VERSION. Throws on unknown. */
export function migrateToLatest(input: unknown): Record<string, unknown> {
    return wasm.migrateToLatest(input) as Record<string, unknown>;
}
