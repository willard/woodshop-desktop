import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { faceHitToOpCoords, faceHitToEdge } from '@/engine/placement';
import { buildPartMesh } from '@/engine/buildScene';
import { createFlatWoodMaterial } from '@/engine/materials';
import { makePart } from '@/engine/commands';
import type { Material } from '@/spec/types';

const size = { l: 24, w: 12 };

describe('faceHitToOpCoords', () => {
    it('maps a front-face hit to §3.1 coords from the low edges', () => {
        // Local origin is the part centre; op coords measure from w0 (x=−l/2) and l0 (y=−w/2).
        const hit = faceHitToOpCoords(size, [-12, -6, 0.375], [0, 0, 1], 0.125);
        expect(hit).toEqual({ face: 'front', x: 0, y: 0 });

        const centre = faceHitToOpCoords(size, [0, 0, 0.375], [0, 0, 1], 0.125);
        expect(centre).toEqual({ face: 'front', x: 12, y: 6 });
    });

    it('detects the back face from the normal sign', () => {
        const hit = faceHitToOpCoords(size, [3, 2, -0.375], [0, 0, -1], 0.125);
        expect(hit?.face).toBe('back');
    });

    it('snaps to the grid', () => {
        const hit = faceHitToOpCoords(size, [-11.97, -5.81, 0.375], [0, 0, 1], 0.125);
        expect(hit?.x).toBeCloseTo(0, 6);
        expect(hit?.y).toBeCloseTo(0.25, 6);
    });

    it('clamps to the face after snapping', () => {
        const hit = faceHitToOpCoords(size, [12.06, 6.05, 0.375], [0, 0, 1], 0.125);
        expect(hit?.x).toBeLessThanOrEqual(24);
        expect(hit?.y).toBeLessThanOrEqual(12);
    });

    it('rejects edge faces and slanted normals', () => {
        expect(faceHitToOpCoords(size, [12, 0, 0], [1, 0, 0], 0.125)).toBeNull();
        expect(faceHitToOpCoords(size, [0, 6, 0], [0, 1, 0], 0.125)).toBeNull();
        expect(faceHitToOpCoords(size, [0, 0, 0.3], [0, 0.4, 0.6], 0.125)).toBeNull();
    });

    it('gives exact coordinates when the grid is disabled (0)', () => {
        const hit = faceHitToOpCoords(size, [-11.97, -5.81, 0.375], [0, 0, 1], 0);
        expect(hit?.x).toBeCloseTo(0.03, 6);
        expect(hit?.y).toBeCloseTo(0.19, 6);
    });

    it('round-trips a world raycast on a rotated part via worldToLocal', () => {
        const material: Material = {
            id: 'mat_x',
            type: 'sheet',
            name: 'Ply',
            thickness: 0.75,
            sheetSize: { l: 96, w: 48 },
            grain: true,
        };
        // A shelf lying flat: rotated 90° about X (local +Y → world +Z, local +Z → world −Y,
        // so the front face points down in the world).
        const part = {
            ...makePart({ id: 'p_shelf', name: 'Shelf', materialId: 'mat_x', size }),
            transform: { pos: [5, 20, -3], rot: [90, 0, 0] },
        };
        const mesh = buildPartMesh(part, material, () => createFlatWoodMaterial(material));
        mesh.updateMatrixWorld(true);

        // Local (x=2, y=3, z=+t/2) → world offset (2, −t/2, 3) from the centre.
        const world = new THREE.Vector3(7, 19.625, 0);
        const local = mesh.worldToLocal(world.clone());
        expect(local.x).toBeCloseTo(2, 4);
        expect(local.y).toBeCloseTo(3, 4);
        expect(local.z).toBeCloseTo(0.375, 4);

        const hit = faceHitToOpCoords(size, [local.x, local.y, local.z], [0, 0, 1], 0.125);
        expect(hit).toEqual({ face: 'front', x: 14, y: 9 });
    });
});

describe('faceHitToEdge', () => {
    const front: [number, number, number] = [0, 0, 1];

    it('resolves a front-face hit to the nearest of the four edges', () => {
        // size is 24 (l, x) × 12 (w, y); edges: w0 x=−12, w1 x=+12, l0 y=−6, l1 y=+6.
        expect(faceHitToEdge(size, [11, 0, 0.375], front)).toBe('w1');
        expect(faceHitToEdge(size, [-11, 0, 0.375], front)).toBe('w0');
        expect(faceHitToEdge(size, [0, 5, 0.375], front)).toBe('l1');
        expect(faceHitToEdge(size, [0, -5, 0.375], front)).toBe('l0');
    });

    it('picks the closer edge when a corner hit is ambiguous', () => {
        // Near the +x/+y corner but closer to the x edge (dx 1 < dy 2) → w1.
        expect(faceHitToEdge(size, [11, 4, 0.375], front)).toBe('w1');
        // Closer to the y edge (dy 1 < dx 3) → l1.
        expect(faceHitToEdge(size, [9, 5, 0.375], front)).toBe('l1');
    });

    it('works off the back face too (edges are in-plane)', () => {
        expect(faceHitToEdge(size, [-11, 0, -0.375], [0, 0, -1])).toBe('w0');
    });

    it('rejects edge faces and slanted normals', () => {
        expect(faceHitToEdge(size, [12, 0, 0], [1, 0, 0])).toBeNull();
        expect(faceHitToEdge(size, [0, 0, 0], [0, 0.5, 0.5])).toBeNull();
    });
});
