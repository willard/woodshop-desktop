/**
 * Auto-notch ("notch around part") math — pure, framework-free (no Vue, no DOM).
 *
 * Given two interpenetrating parts, computes the notch op that clears the insert out of
 * the host: intersection of world AABBs, expressed in the host's local face frame, mapped
 * to §3.1 notch coords (from/to along the touched edge, depth into the span) plus a slip
 * clearance. Non-axis-aligned inserts are conservative (the AABB of their footprint);
 * 90°-multiple rotations — every template — are exact.
 */
import * as THREE from 'three';
import type { Spec, Part, Op } from '../spec/types';
import { aabbFromPart, type AABB } from './snapping';

type NotchOp = Extract<Op, { type: 'notch' }>;

const DEG2RAD = Math.PI / 180;
/** Minimum interpenetration before parts count as overlapping (touching faces don't). */
const OVERLAP_EPS = 1e-3;
/** How close the intersection rect must come to an edge to count as reaching it. */
const EDGE_TOL = 1e-3;

export interface OverlapCandidate {
    part: Part;
    /** The world-space intersection box (handy for future highlighting). */
    worldBox: AABB;
}

/** Parts whose world AABB genuinely interpenetrates the host's. */
export function overlappingParts(spec: Spec, hostId: string): OverlapCandidate[] {
    const host = spec.parts.find((p) => p.id === hostId);
    if (host === undefined) {
        return [];
    }
    const thickness = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const hostBox = aabbFromPart(host, thickness.get(host.materialId) ?? 0.75);

    const hits: OverlapCandidate[] = [];
    for (const part of spec.parts) {
        if (part.id === hostId) {
            continue;
        }
        const box = aabbFromPart(part, thickness.get(part.materialId) ?? 0.75);
        const intersection: AABB = { min: [0, 0, 0], max: [0, 0, 0] };
        let overlaps = true;
        for (const axis of [0, 1, 2]) {
            intersection.min[axis] = Math.max(hostBox.min[axis], box.min[axis]);
            intersection.max[axis] = Math.min(hostBox.max[axis], box.max[axis]);
            if (intersection.max[axis] - intersection.min[axis] <= OVERLAP_EPS) {
                overlaps = false;
                break;
            }
        }
        if (overlaps) {
            hits.push({ part, worldBox: intersection });
        }
    }
    return hits;
}

/** Rounds to the nearest 1/64" so ops display as clean fractions. */
function to64th(v: number): number {
    return Math.round(v * 64) / 64;
}

/**
 * The notch op that clears `insert` out of `host`, or null when the overlap isn't
 * notch-shaped: no overlap, interior only (a mortise), or the bite would sever the part.
 */
export function notchForOverlap(
    host: Part,
    hostThickness: number,
    insert: Part,
    insertThickness: number,
    clearance: number,
): NotchOp | null {
    // Insert's world box → the host's local frame (inverse of the aabbFromPart compose).
    const insertBox = aabbFromPart(insert, insertThickness);
    const [rx, ry, rz] = host.transform.rot;
    const [px, py, pz] = host.transform.pos;
    const hostMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ')),
        new THREE.Vector3(1, 1, 1),
    );
    const inverse = hostMatrix.clone().invert();

    const local = new THREE.Box3();
    const corner = new THREE.Vector3();
    for (const x of [insertBox.min[0], insertBox.max[0]]) {
        for (const y of [insertBox.min[1], insertBox.max[1]]) {
            for (const z of [insertBox.min[2], insertBox.max[2]]) {
                local.expandByPoint(corner.set(x, y, z).applyMatrix4(inverse));
            }
        }
    }

    // Intersect with the host's local box.
    const { l, w } = host.size;
    const x0 = Math.max(local.min.x, -l / 2);
    const x1 = Math.min(local.max.x, l / 2);
    const y0 = Math.max(local.min.y, -w / 2);
    const y1 = Math.min(local.max.y, w / 2);
    const z0 = Math.max(local.min.z, -hostThickness / 2);
    const z1 = Math.min(local.max.z, hostThickness / 2);
    if (x1 - x0 <= OVERLAP_EPS || y1 - y0 <= OVERLAP_EPS || z1 - z0 <= OVERLAP_EPS) {
        return null;
    }

    // Op coords (from the low edges) and which edges the rect reaches.
    const rx0 = x0 + l / 2;
    const rx1 = x1 + l / 2;
    const ry0 = y0 + w / 2;
    const ry1 = y1 + w / 2;
    const reaches: { edge: NotchOp['edge']; penetration: number; span: number }[] = [];
    if (rx0 <= EDGE_TOL) {
        reaches.push({ edge: 'w0', penetration: rx1, span: l });
    }
    if (rx1 >= l - EDGE_TOL) {
        reaches.push({ edge: 'w1', penetration: l - rx0, span: l });
    }
    if (ry0 <= EDGE_TOL) {
        reaches.push({ edge: 'l0', penetration: ry1, span: w });
    }
    if (ry1 >= w - EDGE_TOL) {
        reaches.push({ edge: 'l1', penetration: w - ry0, span: w });
    }
    if (reaches.length === 0) {
        return null; // interior overlap — that's a mortise, not a notch
    }

    // A corner overlap reaches two edges: the deeper one is the run, the shallower the
    // bite. Pick the shallowest touched edge; a full-span bite would sever the part.
    reaches.sort((a, b) => a.penetration - b.penetration);
    const pick = reaches[0];
    if (pick.penetration >= pick.span - OVERLAP_EPS) {
        return null;
    }

    // Run extents along the picked edge (its datum axis is the perpendicular pair's axis).
    const chord = pick.edge === 'l0' || pick.edge === 'l1' ? l : w;
    const run: [number, number] = pick.edge === 'l0' || pick.edge === 'l1' ? [rx0, rx1] : [ry0, ry1];

    const from = to64th(Math.max(0, run[0] - clearance));
    const to = to64th(Math.min(chord, run[1] + clearance));
    const depth = to64th(pick.penetration + clearance);
    if (depth >= pick.span - OVERLAP_EPS || to - from <= 0) {
        return null;
    }
    return { type: 'notch', edge: pick.edge, from, to, depth };
}
