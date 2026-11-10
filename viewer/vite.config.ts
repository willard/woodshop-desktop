import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Second build: the standalone plan viewer. Emits exactly `viewer/dist/viewer.js` and
 * `viewer.css`, which `woodshop-export` embeds into one self-contained .html. Everything below
 * exists to guarantee "two files, no fetches": lib/IIFE mode, inlined assets and wasm, an inline
 * classic (iife) worker — a module worker from a blob URL fails on a file:// page.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** `virtual:woodshop-wasm` → the viewer's wasm module as a base64 string, inlined in the bundle. */
function inlineWasm(bytes = true): Plugin {
    const id = 'virtual:woodshop-wasm';
    return {
        name: 'woodshop-inline-wasm',
        resolveId: (source) => (source === id ? `\0${id}` : null),
        load(resolved) {
            if (resolved !== `\0${id}`) return null;
            // The CSG worker reaches the domain module through an import chain but never calls
            // it, so it gets an empty module rather than a second megabyte of base64.
            if (!bytes) return 'export default "";';
            const wasm = readFileSync(here('./src/wasm/woodshop_bg.wasm'));
            return `export default ${JSON.stringify(wasm.toString('base64'))};`;
        },
    };
}

export default defineConfig({
    root: here('.'),
    publicDir: false,
    plugins: [react(), tailwindcss(), inlineWasm()],
    resolve: {
        alias: [
            // The viewer carries its own (smaller, validation-free) build of the domain core.
            { find: /^@\/domain$/, replacement: here('./src/domain.ts') },
            { find: '@', replacement: here('../ui/src') },
        ],
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    worker: { format: 'iife', plugins: () => [inlineWasm(false)] },
    build: {
        outDir: here('./dist'),
        emptyOutDir: true,
        target: 'es2022',
        cssCodeSplit: false,
        modulePreload: false,
        sourcemap: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        lib: {
            entry: here('./src/main.tsx'),
            name: 'WoodshopViewer',
            formats: ['iife'],
            fileName: () => 'viewer.js',
            cssFileName: 'viewer',
        },
    },
});
