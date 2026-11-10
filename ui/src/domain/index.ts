/**
 * The domain core, compiled from `crates/woodshop-core` to WebAssembly. The linter, cut list,
 * outlines, migrations, schema validation and fraction formatting all run here — the same code
 * the native side (store, exports, MCP server) runs, so the editor and the file on disk can never
 * disagree.
 *
 * The module must be initialised once before any call: `initDomain()` in the app entry (async,
 * fetches the .wasm) or `initDomainSync(bytes)` in tests.
 */
import init, { initSync } from './wasm/woodshop.js';

export * as wasm from './wasm/woodshop.js';

let ready: Promise<void> | null = null;

export function initDomain(): Promise<void> {
    ready ??= init().then(() => undefined);
    return ready;
}

export function initDomainSync(bytes: BufferSource): void {
    initSync({ module: bytes });
}
