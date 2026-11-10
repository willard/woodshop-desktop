/**
 * Three.js adapter over the fastener placement math in `spec/fasteners.ts`. The math itself lives
 * in the spec layer because the linter needs it too and must stay three-free; this file only turns
 * the plain triples into vectors and matrices the renderer and planners work in.
 */
import * as THREE from 'three';
import type { Part } from '../spec/types';
import { fastenerSegments as localSegments, type FastenerOp } from '../spec/fasteners';

export type { FastenerOp };

export interface FastenerSegment {
    /** Where the head sits, in the part's local frame. */
    head: THREE.Vector3;
    /** Unit direction the screw travels (head → tip). */
    direction: THREE.Vector3;
    /** Modelled length, so the tip is `head + direction * length`. */
    length: number;
    tip: THREE.Vector3;
}

/** Every screw the op places, in the part's local frame. */
export function fastenerSegments(part: Part, thickness: number, op: FastenerOp): FastenerSegment[] {
    return localSegments(part, thickness, op).map((segment) => ({
        head: new THREE.Vector3(...segment.head),
        direction: new THREE.Vector3(...segment.direction),
        length: segment.length,
        tip: new THREE.Vector3(...segment.tip),
    }));
}

/** The part's local→world matrix (§3.1: intrinsic XYZ Euler degrees, then translation). */
export function partMatrix(part: Part): THREE.Matrix4 {
    const [rx, ry, rz] = part.transform.rot;
    const [px, py, pz] = part.transform.pos;
    const deg2rad = Math.PI / 180;
    return new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * deg2rad, ry * deg2rad, rz * deg2rad, 'XYZ')),
        new THREE.Vector3(1, 1, 1),
    );
}
