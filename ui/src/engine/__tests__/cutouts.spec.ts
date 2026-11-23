import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { subtractOps } from '@/engine/geometry/subtract';

const dims = { l: 36, w: 24, thickness: 0.75 };

/** Casts a ray along −Z through (x, y) and counts the surfaces it crosses. */
function surfaceHits(geo: THREE.BufferGeometry, x: number, y: number): number {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(mesh).length;
}

function cut(cutout: Parameters<typeof subtractOps>[1]['cutouts']): THREE.BufferGeometry {
    return subtractOps(
        new THREE.BoxGeometry(36, 24, 0.75),
        { holes: [], channels: [], cutouts: cutout },
        dims,
    );
}

describe('cutouts (spec 1.22)', () => {
    it('opens a saw well right through the top, centred where it says', () => {
        // Centred 6" right of the middle: x from w0 = 18 + 6.
        const top = cut([{ face: 'front', x: 24, y: 12, length: 10, width: 6, radius: 1 }]);
        expect(surfaceHits(top, 6, 0)).toBe(0); // in the opening
        expect(surfaceHits(top, -6, 0)).toBe(2); // solid wood
        // A rounded corner keeps its wood: just inside the box's corner, outside the arc.
        expect(surfaceHits(top, 6 + 4.9, 2.9)).toBe(2);
    });

    it('cuts a pocket only part way, from the face it names', () => {
        const pocket = cut([{ face: 'front', x: 18, y: 12, length: 8, width: 4, depth: 0.25 }]);
        const hits = surfaceHits(pocket, 0, 0);
        expect(hits).toBeGreaterThan(0); // the floor and the back are still there
        const front = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
        const first = front.intersectObject(
            new THREE.Mesh(pocket, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
        )[0];
        expect(first.point.z).toBeCloseTo(0.375 - 0.25, 2); // the pocket floor, 1/4" down
    });
});
