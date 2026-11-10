/** Vitest bootstrap: the domain core is WebAssembly, instantiated synchronously from disk. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import { initDomainSync } from '@/domain';

initDomainSync(readFileSync(resolve(process.cwd(), 'ui/src/domain/wasm/woodshop_bg.wasm')));
