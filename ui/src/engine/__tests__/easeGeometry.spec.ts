import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPartGeometry } from '@/engine/geometry/partGeometry';
import type { Part, Op } from '@/spec/types';

const THICKNESS = 0.75;

function part(ops: Op[], size = { l: 24, w: 12 }): Part {
    return {
        id: 'p_top',
        name: 'Top',
        materialId: 'mat_pine',
        size,
        grainAxis: 'l',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        ops,
        qty: 1,
        locked: false,
    } as Part;
}

/** Every vertex of the geometry, in the part's local frame. */
function vertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
    const position = geometry.getAttribute('position');
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i += 1) {
        out.push(new THREE.Vector3().fromBufferAttribute(position as THREE.BufferAttribute, i));
    }
    return out;
}

const roundover = (edge: string, radius: number, face?: 'front' | 'back'): Op =>
    ({ type: 'ease', edge, profile: 'roundover', radius, ...(face ? { face } : {}) }) as Op;

describe('eased-edge geometry (spec 1.10)', () => {
    it('leaves a part with no ease op byte-for-byte on the old box path', () => {
        const plain = buildPartGeometry(part([]), THICKNESS);
        const box = new THREE.BoxGeometry(24, 12, THICKNESS);
        expect(plain.getAttribute('position').count).toBe(box.getAttribute('position').count);
    });

    it('keeps the blank: an eased part never grows past its cut size', () => {
        const geometry = buildPartGeometry(part([roundover('w1', 0.25)]), THICKNESS);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(box.max.x).toBeCloseTo(12, 6);
        expect(box.min.x).toBeCloseTo(-12, 6);
        expect(box.max.z).toBeCloseTo(THICKNESS / 2, 6);
        expect(box.min.z).toBeCloseTo(-THICKNESS / 2, 6);
    });

    it('pulls the eased edge back at the face and leaves it full at mid-thickness', () => {
        const r = 0.25;
        const geometry = buildPartGeometry(part([roundover('w1', r)]), THICKNESS);
        const all = vertices(geometry);

        // At the front face the edge has receded by the full radius…
        const atFace = all.filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);
        expect(Math.max(...atFace.map((v) => v.x))).toBeCloseTo(12 - r, 6);

        // …and below where the bit runs out (0.75" stock, 1/4" bit) the edge is full width again.
        const belowTheArc = all.filter((v) => Math.abs(v.z - (THICKNESS / 2 - r)) < 1e-6);
        expect(Math.max(...belowTheArc.map((v) => v.x))).toBeCloseTo(12, 6);
    });

    it('rounds one arris only when the op names a face', () => {
        const r = 0.25;
        const geometry = buildPartGeometry(part([roundover('w1', r, 'front')]), THICKNESS);
        const all = vertices(geometry);

        const front = all.filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);
        const back = all.filter((v) => Math.abs(v.z + THICKNESS / 2) < 1e-6);
        expect(Math.max(...front.map((v) => v.x))).toBeCloseTo(12 - r, 6);
        expect(Math.max(...back.map((v) => v.x))).toBeCloseTo(12, 6);
    });

    it('meets two eased edges at a corner cut by both bits', () => {
        const r = 0.25;
        const geometry = buildPartGeometry(part([roundover('w1', r), roundover('l1', r)]), THICKNESS);
        const atFace = vertices(geometry).filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);

        // The shared corner is pulled in on both axes — the intersection of the two quarter-rounds.
        const corner = atFace.filter((v) => v.x > 11 && v.y > 5);
        expect(Math.max(...corner.map((v) => v.x))).toBeCloseTo(12 - r, 6);
        expect(Math.max(...corner.map((v) => v.y))).toBeCloseTo(6 - r, 6);
    });

    it('rounds a bullnose to a semicircle of the stock thickness', () => {
        const geometry = buildPartGeometry(
            part([{ type: 'ease', edge: 'w1', profile: 'bullnose' } as Op]),
            THICKNESS,
        );
        const all = vertices(geometry);
        const atFace = all.filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);
        // Both arrises take half the thickness, so the face stops a half-thickness short…
        expect(Math.max(...atFace.map((v) => v.x))).toBeCloseTo(12 - THICKNESS / 2, 6);
        // …and the widest point is the middle of the edge, still at full width.
        const atMiddle = all.filter((v) => Math.abs(v.z) < 1e-6);
        expect(Math.max(...atMiddle.map((v) => v.x))).toBeCloseTo(12, 6);
    });

    it('eases a dadoed part, and skips the arris the dado already removed', () => {
        const r = 0.25;
        const dado: Op = { type: 'dado', face: 'front', axis: 'w', offset: 6, width: 0.75, depth: 0.25 };
        const geometry = buildPartGeometry(part([dado, roundover('l1', r)]), THICKNESS);
        const all = vertices(geometry);

        // The eased edge is still rounded on the untouched stretch of the front face…
        const atFace = all.filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);
        expect(Math.max(...atFace.map((v) => v.y))).toBeCloseTo(6 - r, 6);
        // …and the dado floor keeps its sharp corner: no arris left there to round.
        const atFloor = all.filter((v) => Math.abs(v.z - (THICKNESS / 2 - 0.25)) < 1e-6);
        expect(Math.max(...atFloor.map((v) => v.y))).toBeCloseTo(6, 6);
    });

    it('cuts the ease on a curved part — the outline is lofted, not extruded (D73)', () => {
        const r = 0.25;
        const curved = buildPartGeometry(
            part([{ type: 'curve', edge: 'l1', kind: 'arc', height: 2 } as Op, roundover('w1', r)]),
            THICKNESS,
        );
        const atFace = vertices(curved).filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);
        expect(Math.max(...atFace.map((v) => v.x))).toBeCloseTo(12 - r, 4);
        // Below the profile's reach the edge is still the full blank.
        expect(Math.max(...vertices(curved).map((v) => v.x))).toBeCloseTo(12, 4);
    });

    it('drops the ease on a mitered edge', () => {
        const mitered = buildPartGeometry(
            part([{ type: 'miter', edge: 'w1', angle: 45 } as Op, roundover('w1', 0.25)]),
            THICKNESS,
        );
        const miteredOnly = buildPartGeometry(
            part([{ type: 'miter', edge: 'w1', angle: 45 } as Op]),
            THICKNESS,
        );
        expect(mitered.getAttribute('position').count).toBe(miteredOnly.getAttribute('position').count);
    });

    it('still eases the other edges when one edge is mitered', () => {
        const geometry = buildPartGeometry(
            part([{ type: 'miter', edge: 'w1', angle: 45 } as Op, roundover('l1', 0.25)]),
            THICKNESS,
        );
        const atFace = vertices(geometry).filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);
        expect(Math.max(...atFace.map((v) => v.y))).toBeCloseTo(6 - 0.25, 6);
    });

    it('leaves the edge square where a stopped run stops, and rounds it where it runs', () => {
        const r = 0.25;
        // A leg that stays square for the top 4" where the apron lands (l0 datum runs +Y here:
        // w1 is a w-edge, so from/to measure from l0 across the 12" width).
        const stopped: Op = { type: 'ease', edge: 'w1', profile: 'roundover', radius: r, to: 8 } as Op;
        const geometry = buildPartGeometry(part([stopped]), THICKNESS);
        const atFace = vertices(geometry).filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);

        // The run is on the l0 datum, so `to: 8` on a 12"-wide part stops at y = 8 − 6 = 2.
        // Inside the run the front face is pulled back by the full radius…
        const inside = atFace.filter((v) => v.y < 1.7);
        expect(Math.max(...inside.map((v) => v.x))).toBeCloseTo(12 - r, 6);
        // …and past the stop the edge is untouched: full width, top to bottom.
        const past = atFace.filter((v) => v.y > 2.01);
        expect(past.length).toBeGreaterThan(0);
        expect(Math.max(...past.map((v) => v.x))).toBeCloseTo(12, 6);
        expect(Math.min(...past.map((v) => v.x))).toBeCloseTo(-12, 6);
    });

    it('tapers out of a stopped cut instead of ending it dead', () => {
        const r = 0.25;
        const stopped: Op = { type: 'ease', edge: 'w1', profile: 'roundover', radius: r, to: 8 } as Op;
        const geometry = buildPartGeometry(part([stopped]), THICKNESS);
        const atFace = vertices(geometry).filter((v) => Math.abs(v.z - THICKNESS / 2) < 1e-6);

        // Datum 8 is y = 8 - 6 = 2; the run-out starts one radius earlier, at y = 1.75.
        const atRunOutStart = atFace.filter((v) => Math.abs(v.y - 1.75) < 1e-6);
        const atStop = atFace.filter((v) => Math.abs(v.y - 2) < 1e-6);
        expect(Math.max(...atRunOutStart.map((v) => v.x))).toBeCloseTo(12 - r, 6);
        expect(Math.max(...atStop.map((v) => v.x))).toBeCloseTo(12, 6);
    });

    it('closes the solid: every edge of the mesh is shared by exactly two triangles', () => {
        const stopped: Op = {
            type: 'ease',
            edge: 'w1',
            profile: 'roundover',
            radius: 0.25,
            from: 3,
            to: 8,
        } as Op;
        const geometry = buildPartGeometry(part([stopped]), THICKNESS);
        const position = geometry.getAttribute('position');

        // Weld by position, then count how many triangles use each undirected edge. A watertight
        // solid — one a CNC or a printer would accept — shares every edge exactly twice.
        const key = (i: number): string =>
            [position.getX(i), position.getY(i), position.getZ(i)].map((n) => n.toFixed(5)).join(',');
        const counts = new Map<string, number>();
        for (let i = 0; i < position.count; i += 3) {
            const v = [key(i), key(i + 1), key(i + 2)];
            for (let k = 0; k < 3; k += 1) {
                const a = v[k];
                const b = v[(k + 1) % 3];
                if (a === b) {
                    continue; // degenerate sliver from a run-out clamped onto its corner
                }
                const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
                counts.set(edge, (counts.get(edge) ?? 0) + 1);
            }
        }
        expect([...counts.values()].filter((n) => n !== 2)).toEqual([]);
    });

    it('carries UVs so the grain texture still maps', () => {
        const geometry = buildPartGeometry(part([roundover('w1', 0.25)]), THICKNESS);
        const uv = geometry.getAttribute('uv');
        expect(uv).toBeDefined();
        expect(uv.count).toBe(geometry.getAttribute('position').count);
    });

    it('smooths the roundover but keeps the box corners sharp', () => {
        const geometry = buildPartGeometry(part([roundover('w1', 0.25)]), THICKNESS);
        const normals = geometry.getAttribute('normal');
        const positions = geometry.getAttribute('position');

        // Somewhere on the rounded arris a normal points diagonally out (neither +X nor +Z alone).
        let diagonal = 0;
        let axisAligned = 0;
        for (let i = 0; i < normals.count; i += 1) {
            if (positions.getX(i) < 11.5) {
                continue;
            }
            const n = new THREE.Vector3().fromBufferAttribute(normals as THREE.BufferAttribute, i);
            if (n.x > 0.2 && n.z > 0.2) {
                diagonal += 1;
            } else if (Math.abs(n.x - 1) < 1e-3 || Math.abs(n.z - 1) < 1e-3) {
                axisAligned += 1;
            }
        }
        expect(diagonal).toBeGreaterThan(0);
        expect(axisAligned).toBeGreaterThan(0);
    });
});
