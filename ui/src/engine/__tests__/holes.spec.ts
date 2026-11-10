import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { subtractHoles } from '@/engine/geometry/subtract';

function box(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(24, 12, 0.75);
}

/** Casts a ray along −Z through (x, y) and counts front/back surface hits on the geometry. */
function surfaceHits(geo: THREE.BufferGeometry, x: number, y: number): number {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(mesh).length;
}

describe('subtractHoles', () => {
    it('returns the base unchanged when there are no holes', () => {
        const base = box();
        expect(subtractHoles(base, [], { l: 24, w: 12, thickness: 0.75 })).toBe(base);
    });

    it('drills a through hole — the ray passes through the bore with no surface there', () => {
        const dims = { l: 24, w: 12, thickness: 0.75 };
        // Hole centred on the part: x from w0 (=l/2 in), y from l0 (=w/2 in).
        const holed = subtractHoles(box(), [{ face: 'front', x: 12, y: 6, diameter: 1 }], dims);

        // Through the bore centre: no front/back faces (2 fewer than solid).
        expect(surfaceHits(holed, 0, 0)).toBe(0);
        // Away from the hole: still two faces (front + back).
        expect(surfaceHits(holed, 10, 4)).toBe(2);
        // More triangles than a plain box (the bore wall was added).
        expect(holed.getAttribute('position').count).toBeGreaterThan(box().getAttribute('position').count);
    });

    it('drills a blind hole from the front — the back face remains', () => {
        const dims = { l: 24, w: 12, thickness: 0.75 };
        const holed = subtractHoles(box(), [{ face: 'front', x: 12, y: 6, diameter: 1, depth: 0.4 }], dims);
        // A ray down the axis still hits the back (and the bore bottom) — an odd, non-zero count.
        expect(surfaceHits(holed, 0, 0)).toBeGreaterThan(0);
    });

    it('keeps the outer bounding box after drilling', () => {
        const dims = { l: 24, w: 12, thickness: 0.75 };
        const holed = subtractHoles(box(), [{ face: 'front', x: 6, y: 3, diameter: 0.5 }], dims);
        const bb = new THREE.Box3().setFromBufferAttribute(
            holed.getAttribute('position') as THREE.BufferAttribute,
        );
        const size = bb.getSize(new THREE.Vector3());
        expect(size.x).toBeCloseTo(24, 1);
        expect(size.y).toBeCloseTo(12, 1);
        expect(size.z).toBeCloseTo(0.75, 1);
    });
});
