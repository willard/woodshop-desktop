/// <reference lib="webworker" />
/**
 * CSG Web Worker (CLAUDE.md hard rule 11: booleans never run on the main thread). Receives a
 * serialized base geometry plus the hole and channel specs to cut out of it, runs `subtractOps`,
 * and posts the result back with transferable buffers. Excluded from vue-tsc (worker globals
 * conflict with the DOM lib); Vite compiles and type-checks it at build time.
 */
import * as THREE from 'three';
import { subtractOps, type ChannelSpec, type HoleSpec, type PartDims } from '../geometry/subtract';

interface SerializedGeometry {
    position: Float32Array;
    normal?: Float32Array;
    uv?: Float32Array;
    index?: Uint32Array;
}

interface CsgRequest {
    id: number;
    base: SerializedGeometry;
    holes: HoleSpec[];
    /** Channels to cut with a boolean — only ever sent for a shaped part (D72). */
    channels?: ChannelSpec[];
    dims: PartDims;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function toGeometry(data: SerializedGeometry): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    if (data.normal) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    }
    if (data.uv) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    }
    if (data.index) {
        geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    }
    return geometry;
}

ctx.onmessage = (event: MessageEvent<CsgRequest>) => {
    const { id, base, holes, channels, dims } = event.data;
    const result = subtractOps(toGeometry(base), { holes, channels: channels ?? [] }, dims);

    const position = result.getAttribute('position').array as Float32Array;
    const transfer: Transferable[] = [position.buffer];
    const payload: SerializedGeometry = { position };

    const normalAttr = result.getAttribute('normal');
    if (normalAttr) {
        const normal = normalAttr.array as Float32Array;
        payload.normal = normal;
        transfer.push(normal.buffer);
    }
    const indexAttr = result.getIndex();
    if (indexAttr) {
        const index = Uint32Array.from(indexAttr.array);
        payload.index = index;
        transfer.push(index.buffer);
    }

    ctx.postMessage({ id, result: payload }, transfer);
};
