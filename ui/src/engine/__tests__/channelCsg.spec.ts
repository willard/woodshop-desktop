/**
 * Channels cut with a boolean (D72) — the path a SHAPED part takes, where the mesh is an extruded
 * full-thickness outline and the dado/groove/rabbet has to be subtracted from it. The reference is
 * the procedural slab path: a channel must land in the same place whichever builder made the part.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { channelCutterGeometry, subtractOps } from '@/engine/geometry/subtract';
import { buildPartGeometry } from '@/engine/geometry/partGeometry';
import { makePart } from '@/engine/commands';
import type { Op, Part } from '@/spec/types';

const T = 0.75;
const L = 24;
const W = 12;
const DIMS = { l: L, w: W, thickness: T };

function blank(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(L, W, T);
}

function part(ops: Op[]): Part {
    return { ...makePart({ id: 'p_a', name: 'A', materialId: 'mat_x', size: { l: L, w: W } }), ops };
}

/** Z of the topmost surface a −Z ray meets at (x, y), or null where there is no material. */
function topSurfaceZ(geo: THREE.BufferGeometry, x: number, y: number): number | null {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(mesh);
    return hits.length === 0 ? null : hits[0].point.z;
}

describe('channelCutterGeometry', () => {
    it('spans the dado width and cuts down from the front face', () => {
        // Dado on the front, run along l (+X), centreline 6" from the l0 edge (y = −6).
        const cutter = channelCutterGeometry(
            { type: 'dado', face: 'front', axis: 'l', offset: 6, width: 0.75, depth: 0.25 },
            DIMS,
        )!;
        const box = new THREE.Box3().setFromBufferAttribute(
            cutter.getAttribute('position') as THREE.BufferAttribute,
        );
        expect(box.min.y).toBeCloseTo(-0.375, 4); // centreline y = 0, width 0.75
        expect(box.max.y).toBeCloseTo(0.375, 4);
        expect(box.min.z).toBeCloseTo(T / 2 - 0.25, 4); // floor of the dado
        expect(box.max.z).toBeGreaterThan(T / 2); // overshoots the front face
        expect(box.min.x).toBeLessThan(-L / 2); // a through run exits both ends
        expect(box.max.x).toBeGreaterThan(L / 2);
    });

    it('keeps a stopped channel inside the blank at its stopped end', () => {
        const cutter = channelCutterGeometry(
            { type: 'dado', face: 'front', axis: 'l', offset: 6, width: 0.75, depth: 0.25, from: 4, to: 10 },
            DIMS,
        )!;
        const box = new THREE.Box3().setFromBufferAttribute(
            cutter.getAttribute('position') as THREE.BufferAttribute,
        );
        expect(box.min.x).toBeCloseTo(-L / 2 + 4, 4);
        expect(box.max.x).toBeCloseTo(-L / 2 + 10, 4);
    });

    it('cuts a back-face groove up from the back', () => {
        const cutter = channelCutterGeometry(
            { type: 'groove', face: 'back', axis: 'w', offset: 12, width: 0.25, depth: 0.375 },
            DIMS,
        )!;
        const box = new THREE.Box3().setFromBufferAttribute(
            cutter.getAttribute('position') as THREE.BufferAttribute,
        );
        expect(box.min.z).toBeLessThan(-T / 2); // overshoots the back face
        expect(box.max.z).toBeCloseTo(-T / 2 + 0.375, 4);
        expect(box.min.x).toBeCloseTo(-0.125, 4); // centreline 12" from w0 = x 0
    });
});

describe('subtractOps — channels', () => {
    it('cuts a dado to the same depth the procedural slab path would', () => {
        const dado: Op = { type: 'dado', face: 'front', axis: 'l', offset: 6, width: 0.75, depth: 0.25 };
        const cut = subtractOps(blank(), { holes: [], channels: [dado] }, DIMS);
        const slabbed = buildPartGeometry(part([dado]), T);

        // Inside the dado: the floor sits 0.25" below the front face, on both paths.
        expect(topSurfaceZ(cut, 0, 0)).toBeCloseTo(T / 2 - 0.25, 3);
        expect(topSurfaceZ(slabbed, 0, 0)).toBeCloseTo(T / 2 - 0.25, 3);
        // Outside it: the front face is untouched.
        expect(topSurfaceZ(cut, 0, 4)).toBeCloseTo(T / 2, 3);
        expect(topSurfaceZ(slabbed, 0, 4)).toBeCloseTo(T / 2, 3);
    });

    it('runs a through dado out both ends of the blank', () => {
        const cut = subtractOps(
            blank(),
            {
                holes: [],
                channels: [{ type: 'dado', face: 'front', axis: 'l', offset: 6, width: 0.75, depth: 0.25 }],
            },
            DIMS,
        );
        expect(topSurfaceZ(cut, -L / 2 + 0.1, 0)).toBeCloseTo(T / 2 - 0.25, 3);
        expect(topSurfaceZ(cut, L / 2 - 0.1, 0)).toBeCloseTo(T / 2 - 0.25, 3);
    });

    it('stops a stopped dado short, leaving full thickness beyond it', () => {
        const cut = subtractOps(
            blank(),
            {
                holes: [],
                channels: [
                    {
                        type: 'dado',
                        face: 'front',
                        axis: 'l',
                        offset: 6,
                        width: 0.75,
                        depth: 0.25,
                        from: 4,
                        to: 10,
                    },
                ],
            },
            DIMS,
        );
        expect(topSurfaceZ(cut, -L / 2 + 7, 0)).toBeCloseTo(T / 2 - 0.25, 3); // inside the run
        expect(topSurfaceZ(cut, -L / 2 + 2, 0)).toBeCloseTo(T / 2, 3); // before it starts
        expect(topSurfaceZ(cut, -L / 2 + 14, 0)).toBeCloseTo(T / 2, 3); // after it ends
    });

    it('takes a rabbet off the named edge', () => {
        const rabbet: Op = { type: 'rabbet', edge: 'l0', width: 0.5, depth: 0.25 };
        const cut = subtractOps(blank(), { holes: [], channels: [rabbet] }, DIMS);
        // l0 is the low-Y edge: material within 0.5" of it is stepped down 0.25".
        expect(topSurfaceZ(cut, 0, -W / 2 + 0.25)).toBeCloseTo(T / 2 - 0.25, 3);
        expect(topSurfaceZ(cut, 0, -W / 2 + 1)).toBeCloseTo(T / 2, 3);
    });

    it('cuts channels and holes in one pass', () => {
        const cut = subtractOps(
            blank(),
            {
                holes: [{ face: 'front', x: 4, y: 3, diameter: 1 }],
                channels: [{ type: 'dado', face: 'front', axis: 'l', offset: 6, width: 0.75, depth: 0.25 }],
            },
            DIMS,
        );
        expect(topSurfaceZ(cut, -L / 2 + 4, -W / 2 + 3)).toBeNull(); // through the bore
        expect(topSurfaceZ(cut, 0, 0)).toBeCloseTo(T / 2 - 0.25, 3); // the dado floor
    });

    it('cuts the channel of a curved part out of its extruded blank (D72)', () => {
        const curved = part([
            { type: 'curve', edge: 'l1', kind: 'arc', height: 3 },
            { type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25 },
        ]);
        const base = buildPartGeometry(curved, T);
        const cut = subtractOps(
            base,
            {
                holes: [],
                channels: [{ type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25 }],
            },
            DIMS,
        );

        // The dado (centreline y = −3) is cut, and the domed l1 edge is still gone.
        expect(topSurfaceZ(cut, 0, -3)).toBeCloseTo(T / 2 - 0.25, 3);
        expect(topSurfaceZ(cut, 0, -1)).toBeCloseTo(T / 2, 3);
        expect(topSurfaceZ(cut, -L / 2 + 0.1, W / 2 - 0.1)).toBeNull(); // corner dropped by the arc
    });
});
