/**
 * How the *app* spawns the CSG worker: as its own chunk, fetched on demand the first time a
 * design needs a boolean. This module is deliberately the only importer of `?worker` — a bundle
 * that has no business fetching a chunk (the standalone plan viewer, D85, which must be one
 * file) simply never imports it, and so never carries it.
 */
import CsgWorkerCtor from './workers/csg.worker?worker';
import type { CsgWorkerFactory } from './PartCsg';

/**
 * In dev the app and Vite run on different origins (e.g. 127.0.0.1:8001 vs [::1]:5173) and
 * `new Worker(<cross-origin url>)` throws a SecurityError. A blob worker inherits the page's
 * origin, and its `import` of the dev-server module is a CORS fetch Vite allows — so we shim
 * through a blob when origins differ.
 *
 * Builds go through Vite's `?worker` import. The older `new URL('./workers/csg.worker.ts',
 * import.meta.url)` form was never recognised as a worker: Vite emitted the raw, uncompiled .ts
 * as a plain asset, so every built boolean failed and holes were silently left uncut (D85).
 */
export const createCsgWorker: CsgWorkerFactory = () => {
    if (import.meta.env.DEV) {
        // Held in a variable on purpose: Vite's asset scanner matches the literal
        // `new URL('...', import.meta.url)` shape *before* dead-code elimination, so writing the
        // path inline would emit the raw .ts alongside the real worker chunk.
        const devWorkerPath = './workers/csg.worker.ts';
        const url = new URL(devWorkerPath, import.meta.url);
        if (url.origin !== self.location.origin) {
            const blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' });
            return new Worker(URL.createObjectURL(blob), { type: 'module' });
        }
        return new Worker(url, { type: 'module' });
    }
    return new CsgWorkerCtor();
};
