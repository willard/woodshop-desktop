import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitDistance } from '@/engine/EditorEngine';
import { shadeGrain, END_GRAIN_SHADE, EDGE_SHADE } from '@/engine/materials';

/** Where the box's corners land on screen, as a share of the half-view (1 = the edge). */
function reach(box: THREE.Box3, direction: THREE.Vector3, fov: number, aspect: number, distance: number) {
    const centre = box.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 10_000);
    camera.position.copy(centre).addScaledVector(direction.clone().normalize(), distance);
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    let x = 0;
    let y = 0;
    for (const cx of [box.min.x, box.max.x])
        for (const cy of [box.min.y, box.max.y])
            for (const cz of [box.min.z, box.max.z]) {
                const p = new THREE.Vector3(cx, cy, cz).project(camera);
                x = Math.max(x, Math.abs(p.x));
                y = Math.max(y, Math.abs(p.y));
            }
    return { x, y };
}

describe('framing a design', () => {
    const cases: [string, THREE.Box3][] = [
        ['a tall cabinet', new THREE.Box3(new THREE.Vector3(-12, 0, -6), new THREE.Vector3(12, 72, 6))],
        ['a long low console', new THREE.Box3(new THREE.Vector3(-30, 0, -8), new THREE.Vector3(30, 20, 8))],
        ['a step stool', new THREE.Box3(new THREE.Vector3(-8, 0, -5), new THREE.Vector3(8, 10, 5))],
    ];
    const views: [string, THREE.Vector3][] = [
        ['three-quarter', new THREE.Vector3(1, 0.85, 1)],
        ['front', new THREE.Vector3(0, 0, 1)],
        ['side', new THREE.Vector3(1, 0, 0)],
    ];

    it.each(cases)('fills 60%% of the view with %s, from every preset', (_name, box) => {
        for (const [view, direction] of views) {
            for (const aspect of [1.5, 0.8]) {
                const d = fitDistance(box, box.getCenter(new THREE.Vector3()), direction, 45, aspect, 0.6);
                const { x, y } = reach(box, direction, 45, aspect, d);
                // Nothing spills past 60%, and the tighter axis is right at it.
                expect(Math.max(x, y), `${view} @ ${aspect}`).toBeLessThanOrEqual(0.6 + 1e-6);
                expect(Math.max(x, y), `${view} @ ${aspect}`).toBeGreaterThan(0.5);
            }
        }
    });
});

describe('grain shading', () => {
    it('darkens end grain most, long edges a little, and leaves the faces alone', () => {
        const box = new THREE.BoxGeometry(24, 6, 0.75); // length X, width Y, thickness Z
        shadeGrain(box, 'l');
        const colors = box.getAttribute('color');
        const normals = box.getAttribute('normal');
        for (let i = 0; i < normals.count; i += 1) {
            const shade = colors.getX(i);
            if (Math.abs(normals.getX(i)) > 0.9) expect(shade).toBeCloseTo(END_GRAIN_SHADE, 6);
            else if (Math.abs(normals.getY(i)) > 0.9) expect(shade).toBeCloseTo(EDGE_SHADE, 6);
            else expect(shade).toBe(1);
        }
    });

    it('follows the grain when it runs across the width', () => {
        const box = new THREE.BoxGeometry(24, 6, 0.75);
        shadeGrain(box, 'w');
        const colors = box.getAttribute('color');
        const normals = box.getAttribute('normal');
        for (let i = 0; i < normals.count; i += 1) {
            if (Math.abs(normals.getY(i)) > 0.9) expect(colors.getX(i)).toBeCloseTo(END_GRAIN_SHADE, 6);
        }
    });
});
