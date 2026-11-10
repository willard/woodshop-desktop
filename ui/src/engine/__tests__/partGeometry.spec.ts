import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { partSlabs, buildPartGeometry } from '@/engine/geometry/partGeometry';
import { parseSpec } from '@/spec';
import type { Part } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const T = 0.709; // Baltic Birch thickness used by the fixture

function part(id: string): Part {
    return parseSpec(recordStand).parts.find((p) => p.id === id)!;
}

describe('partSlabs — decomposition', () => {
    it('returns null for a part with no channel ops', () => {
        expect(partSlabs(part('p_top'), T)).toBeNull();
    });

    it('splits a front dado into three slabs with a reduced middle', () => {
        // Left Side: dado axis "l" (runs +X), offset 17 on a 34" width → centreline at y=0,
        // width 0.709, depth 0.25 from the front.
        const result = partSlabs(part('p_side_l'), T)!;
        expect(result.runAxis).toBe('x');
        expect(result.runLength).toBe(19); // channel runs the full length
        expect(result.slabs).toHaveLength(3);

        const [left, middle, right] = result.slabs;
        // Outer slabs keep full thickness.
        expect(left.zTop - left.zBottom).toBeCloseTo(T);
        expect(right.zTop - right.zBottom).toBeCloseTo(T);
        // Middle slab is the groove floor: front reduced by the 0.25 depth.
        expect(middle.zTop).toBeCloseTo(T / 2 - 0.25);
        expect(middle.zBottom).toBeCloseTo(-T / 2);
        expect(middle.hi - middle.lo).toBeCloseTo(0.709); // channel width
    });

    it('stops a dado short of the run edges (§3.1 from/to)', () => {
        // 19"-long panel; channel starts 0.75" in from the low run edge (w0) and runs out
        // the far edge — the groove must not exist in the first 0.75" of the run.
        const p: Part = {
            ...part('p_side_l'),
            ops: [
                {
                    type: 'dado',
                    face: 'front',
                    axis: 'l',
                    offset: 17,
                    width: 0.709,
                    depth: 0.25,
                    from: 0.75,
                    to: 19,
                },
            ],
        };
        const result = partSlabs(p, T)!;
        expect(result.runAxis).toBe('x');

        // The run splits at from=0.75 (local x = -9.5 + 0.75 = -8.75).
        const stopX = -19 / 2 + 0.75;
        // Before the stop: one full-thickness slab covering the whole span.
        const before = result.slabs.filter((s) => s.runHi <= stopX + 1e-9);
        expect(before).toHaveLength(1);
        expect(before[0].zTop - before[0].zBottom).toBeCloseTo(T);
        expect(before[0].hi - before[0].lo).toBeCloseTo(34); // full span, no groove

        // After the stop: the usual three-slab groove profile.
        const after = result.slabs.filter((s) => s.runLo >= stopX - 1e-9);
        expect(after).toHaveLength(3);
        const grooved = after.find((s) => s.zTop < T / 2 - 1e-9)!;
        expect(grooved.zTop).toBeCloseTo(T / 2 - 0.25);
        expect(grooved.hi - grooved.lo).toBeCloseTo(0.709);
    });

    it('cuts a rabbet from the front along the named low edge', () => {
        const p: Part = {
            ...part('p_top'),
            ops: [{ type: 'rabbet', edge: 'l0', width: 0.5, depth: 0.25 }],
        };
        const result = partSlabs(p, T)!;
        expect(result.runAxis).toBe('x');
        // Two slabs: the rabbeted edge strip (front reduced) and the full remainder.
        const rabbeted = result.slabs.find((s) => s.zTop < T / 2 - 1e-9)!;
        expect(rabbeted.zTop).toBeCloseTo(T / 2 - 0.25);
        expect(rabbeted.zBottom).toBeCloseTo(-T / 2); // rabbet only cuts the front
        expect(rabbeted.lo).toBeCloseTo(-part('p_top').size.w / 2);
    });
});

describe('buildPartGeometry — miter', () => {
    function miterPart(edge: 'w0' | 'w1' | 'l0' | 'l1'): Part {
        return { ...part('p_top'), size: { l: 24, w: 12 }, ops: [{ type: 'miter', edge, angle: 45 }] };
    }

    it('bevels the back of the named width-edge, keeping the front full length', () => {
        const geo = buildPartGeometry(miterPart('w1'), 0.75);
        const pos = geo.getAttribute('position');
        let frontMaxX = -Infinity;
        let backMaxX = -Infinity;
        for (let i = 0; i < pos.count; i += 1) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            if (z > 0.3) {
                frontMaxX = Math.max(frontMaxX, x);
            } else if (z < -0.3) {
                backMaxX = Math.max(backMaxX, x);
            }
        }
        // Front face still reaches +l/2; the back has receded by ~thickness (tan45 = 1).
        expect(frontMaxX).toBeCloseTo(12);
        expect(backMaxX).toBeCloseTo(12 - 0.75, 2);
    });

    it('leaves the opposite edge untouched', () => {
        const geo = buildPartGeometry(miterPart('w1'), 0.75);
        const pos = geo.getAttribute('position');
        let minX = Infinity;
        for (let i = 0; i < pos.count; i += 1) {
            minX = Math.min(minX, pos.getX(i));
        }
        expect(minX).toBeCloseTo(-12); // w0 edge unchanged
    });
});

describe('buildPartGeometry', () => {
    it('returns a plain box for an un-notched part with correct outer dimensions', () => {
        const p = part('p_top');
        const geo = buildPartGeometry(p, T);
        const box = new THREE.Box3().setFromBufferAttribute(
            geo.getAttribute('position') as THREE.BufferAttribute,
        );
        const size = box.getSize(new THREE.Vector3());
        expect(size.x).toBeCloseTo(p.size.l);
        expect(size.y).toBeCloseTo(p.size.w);
        expect(size.z).toBeCloseTo(T);
    });

    it('keeps the same outer bounding box after cutting a dado', () => {
        const p = part('p_side_l');
        const geo = buildPartGeometry(p, T);
        const box = new THREE.Box3().setFromBufferAttribute(
            geo.getAttribute('position') as THREE.BufferAttribute,
        );
        const size = box.getSize(new THREE.Vector3());
        expect(size.x).toBeCloseTo(p.size.l);
        expect(size.y).toBeCloseTo(p.size.w);
        expect(size.z).toBeCloseTo(T);
        // A merged multi-box solid has more vertices than a single box (24).
        expect(geo.getAttribute('position').count).toBeGreaterThan(24);
    });
});
