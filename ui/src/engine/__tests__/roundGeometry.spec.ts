import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPartGeometry } from '../geometry/partGeometry';
import type { Part } from '../../spec/types';

function dowel(length = 22.5): Part {
    return {
        id: 'p_rod',
        name: 'Rod',
        materialId: 'mat_dowel',
        size: { l: length, w: 0.75 },
        grainAxis: 'l',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
    } as unknown as Part;
}

function bounds(geometry: THREE.BufferGeometry): THREE.Vector3 {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;

    return box.max.clone().sub(box.min);
}

describe('round part geometry (D60)', () => {
    it('lies along local +X, the §3.1 length axis', () => {
        const size = bounds(buildPartGeometry(dowel(22.5), 0.75, true));

        expect(size.x).toBeCloseTo(22.5, 6);
        expect(size.y).toBeCloseTo(0.75, 6);
        expect(size.z).toBeCloseTo(0.75, 6);
    });

    it('is round, not a box: its cross-section fits inside the blank', () => {
        const geometry = buildPartGeometry(dowel(), 0.75, true);
        const position = geometry.getAttribute('position');
        const radius = 0.75 / 2;

        for (let i = 0; i < position.count; i += 1) {
            const y = position.getY(i);
            const z = position.getZ(i);
            expect(Math.hypot(y, z)).toBeLessThanOrEqual(radius + 1e-6);
        }
        // A box would put its eight corners at the full diagonal; a cylinder never does.
        let onCorner = 0;
        for (let i = 0; i < position.count; i += 1) {
            if (Math.hypot(position.getY(i), position.getZ(i)) > radius * 1.2) {
                onCorner += 1;
            }
        }
        expect(onCorner).toBe(0);
    });

    it('still builds a box when the material is not round', () => {
        const size = bounds(buildPartGeometry(dowel(22.5), 0.75, false));
        const geometry = buildPartGeometry(dowel(), 0.75, false);
        const position = geometry.getAttribute('position');

        expect(size.x).toBeCloseTo(22.5, 6);
        // The square blank does reach its corners.
        let corners = 0;
        for (let i = 0; i < position.count; i += 1) {
            if (Math.hypot(position.getY(i), position.getZ(i)) > (0.75 / 2) * 1.2) {
                corners += 1;
            }
        }
        expect(corners).toBeGreaterThan(0);
    });

    it('scales its length with the part, keeping the diameter from the material', () => {
        const size = bounds(buildPartGeometry(dowel(36), 1.25, true));

        expect(size.x).toBeCloseTo(36, 6);
        expect(size.y).toBeCloseTo(1.25, 6);
        expect(size.z).toBeCloseTo(1.25, 6);
    });
});
