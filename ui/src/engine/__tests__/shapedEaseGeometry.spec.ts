/**
 * Eases on a SHAPED part (D73) — a curve or notch used to drop every ease on the part; the part is
 * now lofted from its own contour so the router pass follows the shape. The reference throughout is
 * the box path: a roundover must pull the same distance back at the face, and nothing may leave the
 * blank.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPartGeometry } from '@/engine/geometry/partGeometry';
import type { Op, Part } from '@/spec/types';

const T = 0.75;
const L = 24;
const W = 12;

function part(ops: Op[]): Part {
    return {
        id: 'p_a',
        name: 'A',
        materialId: 'mat_x',
        size: { l: L, w: W },
        grainAxis: 'l',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        ops,
        qty: 1,
        locked: false,
    } as Part;
}

function vertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i += 1) {
        out.push(new THREE.Vector3().fromBufferAttribute(position, i));
    }
    return out;
}

/** Vertices within `tol` of a given z, as a plane slice of the solid. */
function atZ(geometry: THREE.BufferGeometry, z: number, tol = 1e-5): THREE.Vector3[] {
    return vertices(geometry).filter((v) => Math.abs(v.z - z) < tol);
}

const roundover = (edge: string, radius: number): Op =>
    ({ type: 'ease', edge, profile: 'roundover', radius }) as Op;

const dome = (edge: string, height: number): Op => ({ type: 'curve', edge, kind: 'arc', height }) as Op;

const notch = (edge: string, from: number, to: number, depth: number): Op =>
    ({ type: 'notch', edge, from, to, depth }) as Op;

describe('eased shaped parts (D73)', () => {
    it('a shaped part with no ease still takes the plain extrude path', () => {
        const extruded = buildPartGeometry(part([dome('l1', 3)]), T);
        // ExtrudeGeometry emits no uv-less loft; the marker is that our loft always carries uvs
        // AND many z-layers. The extrude has exactly two distinct z values.
        const zs = new Set(vertices(extruded).map((v) => v.z.toFixed(4)));
        expect([...zs].sort()).toEqual([(-T / 2).toFixed(4), (T / 2).toFixed(4)]);
    });

    it('keeps the blank: an eased curved part never grows past its cut size', () => {
        const geometry = buildPartGeometry(part([dome('l1', 3), roundover('l1', 0.25)]), T);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(box.max.x).toBeLessThanOrEqual(L / 2 + 1e-6);
        expect(box.min.x).toBeGreaterThanOrEqual(-L / 2 - 1e-6);
        expect(box.max.y).toBeLessThanOrEqual(W / 2 + 1e-6);
        expect(box.max.z).toBeCloseTo(T / 2, 6);
        expect(box.min.z).toBeCloseTo(-T / 2, 6);
    });

    it('rounds over the domed edge itself: the arc shrinks by the radius at the face', () => {
        const r = 0.25;
        const height = 3;
        const geometry = buildPartGeometry(part([dome('l1', height), roundover('l1', r)]), T);

        // The dome's apex is the top of the outline (y = +w/2). Below the profile's reach it is
        // untouched; at the face the whole arc has been pulled r inward along its own normal.
        const deepest = Math.max(...vertices(geometry).map((v) => v.y));
        const faceY = Math.max(...atZ(geometry, T / 2).map((v) => v.y));
        expect(deepest).toBeCloseTo(W / 2, 4);
        expect(faceY).toBeCloseTo(W / 2 - r, 3);
    });

    it('rounds both faces of the dome, symmetrically', () => {
        const r = 0.25;
        const geometry = buildPartGeometry(part([dome('l1', 3), roundover('l1', r)]), T);
        const front = Math.max(...atZ(geometry, T / 2).map((v) => v.y));
        const back = Math.max(...atZ(geometry, -T / 2).map((v) => v.y));
        expect(front).toBeCloseTo(back, 6);
    });

    it('leaves the edges it was not asked to ease alone', () => {
        const geometry = buildPartGeometry(part([dome('l1', 3), roundover('l1', 0.25)]), T);
        // w0/w1 carry no pass, so the part is still full length at both faces.
        const face = atZ(geometry, T / 2);
        expect(Math.max(...face.map((v) => v.x))).toBeCloseTo(L / 2, 4);
        expect(Math.min(...face.map((v) => v.x))).toBeCloseTo(-L / 2, 4);
    });

    it('eases a straight edge of a notched part, and follows the notch when asked', () => {
        const r = 0.25;
        const plain = buildPartGeometry(part([notch('l1', 0, 4, 2), roundover('l0', r)]), T);
        // l0 is the straight low-Y edge: pulled back r at the face, still full below the profile.
        expect(Math.min(...atZ(plain, T / 2).map((v) => v.y))).toBeCloseTo(-W / 2 + r, 4);
        expect(Math.min(...vertices(plain).map((v) => v.y))).toBeCloseTo(-W / 2, 4);

        // Easing the notched edge itself softens the notch's own walls and floor — the contour is
        // what the bearing follows, so the floor at y = w/2 − depth recedes by r too.
        const notched = buildPartGeometry(part([notch('l1', 0, 4, 2), roundover('l1', r)]), T);
        const floorAtFace = atZ(notched, T / 2).filter((v) => v.x < -L / 2 + 4 - r && v.y < W / 2 - 1);
        expect(Math.max(...floorAtFace.map((v) => v.y))).toBeCloseTo(W / 2 - 2 - r, 3);
    });

    it('a stopped pass on a shaped part only cuts its own run', () => {
        const r = 0.25;
        const stopped = { type: 'ease', edge: 'l0', profile: 'roundover', radius: r, from: 8, to: 16 } as Op;
        const geometry = buildPartGeometry(part([dome('l1', 3), stopped]), T);
        // Only the l0 edge is in play; the dome lives at the other end of the part.
        const face = atZ(geometry, T / 2).filter((v) => v.y < 0);

        // The deepest the pass ever cuts is r, and it happens inside its own run (8"–16" from w0,
        // i.e. x between −4 and 4). Outside the run the edge is still at −w/2 — including at the
        // part's own corners, which the pass never reaches.
        // (Cutting pulls the l0 edge INWARD, so the most-cut vertex is the one with the largest y.)
        const inside = face.filter((v) => Math.abs(v.x) < 4 + 1e-6);
        const outside = face.filter((v) => v.x < -L / 2 + 4);
        expect(Math.max(...inside.map((v) => v.y))).toBeCloseTo(-W / 2 + r, 3);
        expect(Math.max(...outside.map((v) => v.y))).toBeCloseTo(-W / 2, 4);
    });

    it('produces a closed, finite solid — no NaN vertices, no collapsed volume', () => {
        const geometry = buildPartGeometry(
            part([dome('l1', 3), notch('l0', 0, 4, 2), roundover('l0', 0.25), roundover('l1', 0.25)]),
            T,
        );
        const all = vertices(geometry);
        expect(all.length).toBeGreaterThan(100);
        expect(all.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))).toBe(
            true,
        );
        geometry.computeBoundingBox();
        const size = geometry.boundingBox!.getSize(new THREE.Vector3());
        expect(size.z).toBeCloseTo(T, 6);
        expect(size.x).toBeGreaterThan(L - 1);
    });

    it('clamps rather than folding when the profile is deeper than the feature is wide', () => {
        // A 1/2" roundover into a 3/8"-wide notch would turn the contour inside out.
        const geometry = buildPartGeometry(part([notch('l1', 6, 6.375, 2), roundover('l1', 0.375)]), T);
        const all = vertices(geometry);
        expect(all.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
        geometry.computeBoundingBox();
        expect(geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeCloseTo(T, 6);
    });
});
