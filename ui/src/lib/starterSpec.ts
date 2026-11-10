/**
 * A minimal valid spec for a brand-new project (the schema requires at least one material and one
 * part). Built by the Rust core so the app and an MCP `start_design` seed identical boards.
 */
import { wasm } from '@/domain';
import type { Spec } from '@/spec';

export function starterSpec(name: string): Spec {
    return wasm.starterSpec(name, undefined) as Spec;
}
