/**
 * Main-thread client for the CSG worker. Serializes a base geometry, offloads the boolean to the
 * worker (hard rule 11), and resolves with the cut geometry — holes, and the channels of a shaped
 * part (D72). Results are cached by a content key so a design that hasn't changed isn't re-cut
 * (CLAUDE.md: cache CSG per part, invalidate only when that part's ops/size change).
 */
import * as THREE from 'three';
import type { ChannelSpec, HoleSpec, PartDims } from './geometry/subtract';

/**
 * How the worker is spawned. Required, and injected rather than defaulted: the app fetches it as
 * a chunk (engine/csgWorker.ts) while the exported plan viewer inlines it (D85), and a default
 * here would pull one of those into every bundle that imports this file — which is what would
 * put a second copy of three.js in the app, or a stray chunk reference in a single-file export.
 */
export type CsgWorkerFactory = () => Worker;

interface SerializedGeometry {
    position: Float32Array;
    normal?: Float32Array;
    uv?: Float32Array;
    index?: Uint32Array;
}

export class PartCsg {
    private readonly worker: Worker;
    private seq = 0;
    private readonly pending = new Map<number, (geo: THREE.BufferGeometry) => void>();
    private readonly cache = new Map<string, THREE.BufferGeometry>();

    constructor(createWorker: CsgWorkerFactory) {
        this.worker = createWorker();
        this.worker.onmessage = (event: MessageEvent<{ id: number; result: SerializedGeometry }>) => {
            const resolve = this.pending.get(event.data.id);
            if (resolve === undefined) {
                return;
            }
            this.pending.delete(event.data.id);
            resolve(deserialize(event.data.result));
        };
    }

    /** Returns a cut copy of `base`. Cached by `key`; caller owns (and disposes) the result. */
    async subtract(
        key: string,
        base: THREE.BufferGeometry,
        holes: HoleSpec[],
        channels: ChannelSpec[],
        dims: PartDims,
    ): Promise<THREE.BufferGeometry> {
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            return cached.clone();
        }
        const id = (this.seq += 1);
        const [payload, transfer] = serialize(base);
        const result = await new Promise<THREE.BufferGeometry>((resolve) => {
            this.pending.set(id, resolve);
            this.worker.postMessage({ id, base: payload, holes, channels, dims }, transfer);
        });
        this.cache.set(key, result);
        return result.clone();
    }

    dispose(): void {
        this.worker.terminate();
        this.pending.clear();
        this.cache.forEach((geo) => geo.dispose());
        this.cache.clear();
    }
}

/** Copies the base geometry's attributes into transferable buffers (base is left intact). */
function serialize(geo: THREE.BufferGeometry): [SerializedGeometry, Transferable[]] {
    const position = Float32Array.from(geo.getAttribute('position').array);
    const payload: SerializedGeometry = { position };
    const transfer: Transferable[] = [position.buffer];

    const normal = geo.getAttribute('normal');
    if (normal) {
        const copy = Float32Array.from(normal.array);
        payload.normal = copy;
        transfer.push(copy.buffer);
    }
    const uv = geo.getAttribute('uv');
    if (uv) {
        const copy = Float32Array.from(uv.array);
        payload.uv = copy;
        transfer.push(copy.buffer);
    }
    const index = geo.getIndex();
    if (index) {
        const copy = Uint32Array.from(index.array);
        payload.index = copy;
        transfer.push(copy.buffer);
    }
    return [payload, transfer];
}

function deserialize(data: SerializedGeometry): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    if (data.normal) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    }
    if (data.index) {
        geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    }
    if (!data.normal) {
        geometry.computeVertexNormals();
    }
    return geometry;
}
