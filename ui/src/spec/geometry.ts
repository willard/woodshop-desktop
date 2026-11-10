/**
 * Spec-space frame math for interactive work (snapping, contact, focus) — world AABBs and box
 * separation, the same Euler-XYZ convention as `woodshop-core::geometry::frame`. The rules that
 * judge a design (linter, cut list) run in the Rust core; this is the renderer's arithmetic.
 */
import { wasm } from '@/domain';
import type { Part, Spec, Vec3 } from './types';

export type Box = { min: [number, number, number]; max: [number, number, number] };

export const DEG2RAD = Math.PI / 180;

/** Inches — parts closer than this count as connected (touching). */
export const TOUCH_TOL = 0.02;

/** Rows of the Euler-'XYZ' rotation matrix (matches three.js makeRotationFromEuler). */
function rotationMatrix(part: Part): number[][] {
    const [rx, ry, rz] = part.transform.rot.map((d) => d * DEG2RAD);
    const c1 = Math.cos(rx);
    const s1 = Math.sin(rx);
    const c2 = Math.cos(ry);
    const s2 = Math.sin(ry);
    const c3 = Math.cos(rz);
    const s3 = Math.sin(rz);
    return [
        [c2 * c3, -c2 * s3, s2],
        [c1 * s3 + c3 * s1 * s2, c1 * c3 - s1 * s2 * s3, -c2 * s1],
        [s1 * s3 - c1 * c3 * s2, c3 * s1 + c1 * s2 * s3, c1 * c2],
    ];
}

/**
 * World-space AABB of a part. Rotation matches the renderer's Euler 'XYZ' convention
 * (§3.1); local frame is length=+X, width=+Y, thickness=+Z, origin at center.
 */
export function worldAABB(part: Part, thickness: number): Box {
    const m = rotationMatrix(part);
    const hx = part.size.l / 2;
    const hy = part.size.w / 2;
    const hz = thickness / 2;
    const [px, py, pz] = part.transform.pos;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const sx of [-hx, hx]) {
        for (const sy of [-hy, hy]) {
            for (const sz of [-hz, hz]) {
                const p = [px, py, pz];
                for (let i = 0; i < 3; i += 1) {
                    const v = p[i] + m[i][0] * sx + m[i][1] * sy + m[i][2] * sz;
                    if (v < min[i]) {
                        min[i] = v;
                    }
                    if (v > max[i]) {
                        max[i] = v;
                    }
                }
            }
        }
    }
    return { min, max };
}

/**
 * World-space unit directions of a part's local X (length), Y (width), Z (thickness)
 * axes — the columns of the same Euler-'XYZ' matrix worldAABB rotates by.
 */
export function localAxesWorld(part: Part): [Vec3, Vec3, Vec3] {
    const m = rotationMatrix(part);
    return [
        [m[0][0], m[1][0], m[2][0]],
        [m[0][1], m[1][1], m[2][1]],
        [m[0][2], m[1][2], m[2][2]],
    ];
}

/**
 * Per-axis intersection interval of two boxes. `max - min` is the overlap depth on that
 * axis (negative = separated on it); the boxes share volume only when all three are positive.
 */
export function overlapExtents(
    a: Box,
    b: Box,
): [{ min: number; max: number }, { min: number; max: number }, { min: number; max: number }] {
    return [0, 1, 2].map((i) => ({
        min: Math.max(a.min[i], b.min[i]),
        max: Math.min(a.max[i], b.max[i]),
    })) as [{ min: number; max: number }, { min: number; max: number }, { min: number; max: number }];
}

/** Largest per-axis gap between two boxes: >0 = separated, ≤0 = touching/overlapping. */
export function separation(a: Box, b: Box): number {
    let sep = -Infinity;
    for (let i = 0; i < 3; i += 1) {
        sep = Math.max(sep, a.min[i] - b.max[i], b.min[i] - a.max[i]);
    }
    return sep;
}

/**
 * Minimum penetration depth (inches) between two parts' *oriented* boxes via the separating-
 * axis theorem (15 axes: 3 per box + 9 edge cross products). ≤ 0 means the bodies are
 * separated or merely touching face-to-face; > 0 is a true interpenetration by that depth.
 * Used to confirm an AABB pierce hit is real: a tilted part's AABB is inflated, so a flush
 * tilted face-mount overlaps as axis-aligned boxes while the actual bodies only touch.
 */
export function obbPenetration(a: Part, thicknessA: number, b: Part, thicknessB: number): number {
    const axesA = localAxesWorld(a);
    const axesB = localAxesWorld(b);
    const hA: Vec3 = [a.size.l / 2, a.size.w / 2, thicknessA / 2];
    const hB: Vec3 = [b.size.l / 2, b.size.w / 2, thicknessB / 2];
    const d: Vec3 = [
        b.transform.pos[0] - a.transform.pos[0],
        b.transform.pos[1] - a.transform.pos[1],
        b.transform.pos[2] - a.transform.pos[2],
    ];
    const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cross = (u: Vec3, v: Vec3): Vec3 => [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];

    const candidateAxes: Vec3[] = [...axesA, ...axesB];
    for (const u of axesA) {
        for (const v of axesB) {
            candidateAxes.push(cross(u, v));
        }
    }

    let minOverlap = Infinity;
    for (const axis of candidateAxes) {
        const len = Math.hypot(axis[0], axis[1], axis[2]);
        if (len < 1e-6) {
            continue; // parallel edges — this cross product is degenerate, not a real axis
        }
        const L: Vec3 = [axis[0] / len, axis[1] / len, axis[2] / len];
        const rA =
            hA[0] * Math.abs(dot(axesA[0], L)) +
            hA[1] * Math.abs(dot(axesA[1], L)) +
            hA[2] * Math.abs(dot(axesA[2], L));
        const rB =
            hB[0] * Math.abs(dot(axesB[0], L)) +
            hB[1] * Math.abs(dot(axesB[1], L)) +
            hB[2] * Math.abs(dot(axesB[2], L));
        const overlap = rA + rB - Math.abs(dot(d, L));
        if (overlap <= 0) {
            return overlap; // found a separating axis — bodies do not interpenetrate
        }
        if (overlap < minOverlap) {
            minOverlap = overlap;
        }
    }
    return minOverlap;
}

/** The assembled piece's overall size in world inches. */
export interface OverallSize {
    width: number;
    depth: number;
    height: number;
}

/**
 * How big the finished piece is (x = width, z = depth, y = height), from the Rust core so the
 * editor, the PDF and an MCP agent quote the same figures. Null when there are no parts.
 */
export function overallSize(spec: Spec): OverallSize | null {
    if (spec.parts.length === 0) {
        return null;
    }
    return (wasm.overallSize(spec) as OverallSize | undefined) ?? null;
}
