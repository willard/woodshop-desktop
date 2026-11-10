/**
 * The viewer's domain core: the same Rust crate as the app, built without schema validation (the
 * exported spec was validated when it was saved) and inlined as base64 so the page needs no
 * server and no fetch. Instantiated synchronously before anything renders.
 */
import { initSync } from './wasm/woodshop.js';
import wasmBase64 from 'virtual:woodshop-wasm';

export * as wasm from './wasm/woodshop.js';

function decode(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

let ready = false;

export function initDomain(): Promise<void> {
    if (!ready) {
        initSync({ module: decode(wasmBase64) });
        ready = true;
    }
    return Promise.resolve();
}
