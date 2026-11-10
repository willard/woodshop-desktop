/**
 * Snapping math (build-plan §4.2). Pure — no DOM, no Vue — so it's unit tested (CLAUDE.md
 * TDD for snapping). Operates on world-space axis-aligned boxes and adjusts a dragged part's
 * candidate centre. Priority order per axis: face-to-face → edge/centre alignment → grid.
 *
 * All distances are decimal inches. Rotation is fixed during a drag, so the moving part's
 * half-extents are constant and its AABB is centre ± halfExtents.
 */
import * as THREE from 'three';
import type { Part } from '../spec/types';
import type { SnapConfig } from './config';

export type Vec3 = [number, number, number];

export interface AABB {
    min: Vec3;
    max: Vec3;
}

export type SnapKind = 'face' | 'align' | 'grid';

export interface AxisSnap {
    axis: number; // 0=x, 1=y, 2=z
    kind: SnapKind;
    /** World coordinate of the snap plane on this axis (for guide lines). */
    at: number;
    otherIndex: number; // index into `others`, or -1 for grid
}

export interface SnapResult {
    center: Vec3;
    snaps: AxisSnap[];
}

const DEG2RAD = Math.PI / 180;

/** World-space AABB of a part (box l×w×thickness, transformed by pos + rot). */
export function aabbFromPart(part: Part, thickness: number): AABB {
    const box = new THREE.Box3(
        new THREE.Vector3(-part.size.l / 2, -part.size.w / 2, -thickness / 2),
        new THREE.Vector3(part.size.l / 2, part.size.w / 2, thickness / 2),
    );
    const [rx, ry, rz] = part.transform.rot;
    const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ'),
    );
    const [px, py, pz] = part.transform.pos;
    const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        quat,
        new THREE.Vector3(1, 1, 1),
    );
    box.applyMatrix4(matrix);
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/** Half-extents (per axis) of an AABB. */
export function halfExtentsOf(box: AABB): Vec3 {
    return [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
}

/**
 * Clamps a drag cohort's anchor centre so every member's centre stays inside the
 * workspace (spec transform.pos allows ±bound per axis). `offsetMin`/`offsetMax` are
 * the per-axis extremes of member offsets from the anchor (all zeros for a lone part).
 * Members are within bounds at drag start, so the range can never be empty.
 */
export function clampAnchorToWorkspace(center: Vec3, offsetMin: Vec3, offsetMax: Vec3, bound: number): Vec3 {
    const clamped: Vec3 = [...center];
    for (let axis = 0; axis < 3; axis += 1) {
        const lo = -bound - offsetMin[axis];
        const hi = bound - offsetMax[axis];
        clamped[axis] = Math.min(hi, Math.max(lo, clamped[axis]));
    }
    return clamped;
}

/** Do two AABBs overlap on both axes other than `axis` (i.e. a face contact would be real)? */
function overlapsPerpendicular(a: AABB, b: AABB, axis: number, tol: number): boolean {
    for (let ax = 0; ax < 3; ax += 1) {
        if (ax === axis) {
            continue;
        }
        if (a.min[ax] > b.max[ax] + tol || b.min[ax] > a.max[ax] + tol) {
            return false;
        }
    }
    return true;
}

/**
 * Snaps a dragged part's candidate centre against the other parts and the grid.
 * `dragAxes` limits which axes may move (default X and Z — horizontal work plane).
 */
export function computeSnap(
    candidateCenter: Vec3,
    halfExtents: Vec3,
    others: readonly AABB[],
    config: SnapConfig,
    dragAxes: readonly number[] = [0, 2],
): SnapResult {
    const center: Vec3 = [...candidateCenter];
    const snaps: AxisSnap[] = [];

    for (const axis of dragAxes) {
        const half = halfExtents[axis];
        const movingMin = center[axis] - half;
        const movingMax = center[axis] + half;
        // Rebuild moving AABB at the candidate for perpendicular-overlap tests.
        const movingBox: AABB = {
            min: [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
            max: [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]],
        };

        let best: { delta: number; kind: SnapKind; at: number; otherIndex: number } | null = null;
        const consider = (
            delta: number,
            kind: SnapKind,
            at: number,
            otherIndex: number,
            threshold: number,
        ): void => {
            if (Math.abs(delta) > threshold) {
                return;
            }
            // Face beats align beats grid; within a tier the smallest move wins.
            const rank = (k: SnapKind): number => (k === 'face' ? 0 : k === 'align' ? 1 : 2);
            if (
                best === null ||
                rank(kind) < rank(best.kind) ||
                (rank(kind) === rank(best.kind) && Math.abs(delta) < Math.abs(best.delta))
            ) {
                best = { delta, kind, at, otherIndex };
            }
        };

        others.forEach((other, i) => {
            const touching = overlapsPerpendicular(movingBox, other, axis, config.alignThreshold);

            if (config.faceSnap && touching) {
                // Face-to-face: bring surfaces flush.
                consider(other.min[axis] - movingMax, 'face', other.min[axis], i, config.faceThreshold);
                consider(other.max[axis] - movingMin, 'face', other.max[axis], i, config.faceThreshold);
                // Even-gap detent (slats): hold the configured gap off each neighbour face. Kept
                // alongside flush — whichever move is smaller wins, so you pull in for the gap or
                // push closer for flush. The guide still marks the neighbour face (`at`).
                if (config.faceGap > 0) {
                    consider(
                        other.min[axis] - movingMax - config.faceGap,
                        'face',
                        other.min[axis],
                        i,
                        config.faceThreshold,
                    );
                    consider(
                        other.max[axis] - movingMin + config.faceGap,
                        'face',
                        other.max[axis],
                        i,
                        config.faceThreshold,
                    );
                }
            }
            if (config.alignSnap) {
                // Coplanar edges and centre alignment.
                const otherCenter = (other.min[axis] + other.max[axis]) / 2;
                consider(other.min[axis] - movingMin, 'align', other.min[axis], i, config.alignThreshold);
                consider(other.max[axis] - movingMax, 'align', other.max[axis], i, config.alignThreshold);
                consider(otherCenter - center[axis], 'align', otherCenter, i, config.alignThreshold);
            }
        });

        if (best === null && config.gridSnap && config.gridSize > 0) {
            const snapped = Math.round(center[axis] / config.gridSize) * config.gridSize;
            best = { delta: snapped - center[axis], kind: 'grid', at: snapped, otherIndex: -1 };
        }

        if (best !== null) {
            const chosen: { delta: number; kind: SnapKind; at: number; otherIndex: number } = best;
            center[axis] += chosen.delta;
            if (chosen.kind !== 'grid') {
                snaps.push({ axis, kind: chosen.kind, at: chosen.at, otherIndex: chosen.otherIndex });
            }
        }
    }

    return { center, snaps };
}

/**
 * Calculates the shortest displacement vector required to move `movingBox` out of `staticBox`
 * so they touch (0 distance) without overlapping. Returns null if they do not overlap.
 */
export function pushOutDelta(movingBox: AABB, staticBox: AABB): Vec3 | null {
    let minOverlap = Infinity;
    let pushOut: Vec3 | null = null;

    for (let axis = 0; axis < 3; axis += 1) {
        // Distance to push in positive direction to clear the static box
        const pushPos = staticBox.max[axis] - movingBox.min[axis];
        // Distance to push in negative direction to clear the static box
        const pushNeg = staticBox.min[axis] - movingBox.max[axis];

        // If on any axis they don't overlap, then the 3D boxes don't intersect.
        if (pushPos <= 0 || pushNeg >= 0) {
            return null;
        }

        // We want to pick the shortest distance out of pushPos or pushNeg
        if (Math.abs(pushPos) < minOverlap) {
            minOverlap = Math.abs(pushPos);
            pushOut = [0, 0, 0];
            pushOut[axis] = pushPos;
        }
        if (Math.abs(pushNeg) < minOverlap) {
            minOverlap = Math.abs(pushNeg);
            pushOut = [0, 0, 0];
            pushOut[axis] = pushNeg;
        }
    }

    return pushOut;
}
