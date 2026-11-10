/**
 * Measurement math — pure and framework-free so it's unit-testable without WebGL, mirroring
 * explode.ts. Measurement is a *presentation* overlay (CLAUDE.md hard rule 1): it reads part
 * geometry and produces dimension lines to draw, but never touches the spec.
 *
 * A `Dimension` is the single primitive every ruler feature reduces to: two world points and
 * the straight-line distance between them (decimal inches, hard rule 3). The caller draws a
 * line a→b and labels it — formatting via lib/fraction, never here.
 */
import type { Part } from '../spec/types';
import type { Box } from '../spec/geometry';
import { localAxesWorld } from '../spec/geometry';
import type { Vec3 } from './snapping';

export interface Dimension {
    a: Vec3;
    b: Vec3;
    /** Straight-line distance in inches. */
    distance: number;
}

/** Straight-line distance between two world points. */
export function pointDistance(a: Vec3, b: Vec3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Freeform point-to-point dimension. */
export function pointDimension(a: Vec3, b: Vec3): Dimension {
    return { a, b, distance: pointDistance(a, b) };
}

/** Midpoint of a dimension (where its label is anchored). */
export function midpoint(d: Dimension): Vec3 {
    return [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2, (d.a[2] + d.b[2]) / 2];
}

/**
 * Vertical height of a part above the ground (y = 0): a line from the centre of its top face
 * straight down to the floor. Answers "how high does the seat sit".
 */
export function heightDimension(box: Box): Dimension {
    const cx = (box.min[0] + box.max[0]) / 2;
    const cz = (box.min[2] + box.max[2]) / 2;
    return { a: [cx, box.max[1], cz], b: [cx, 0, cz], distance: box.max[1] };
}

/**
 * Clearance between two parts' axis-aligned boxes: the dimension spans their nearest facing
 * faces along the axis of greatest separation (the same face-to-face notion the drag readout
 * uses). Overlapping or touching boxes return distance 0 with the line on the contact plane.
 */
export function gapDimension(a: Box, b: Box): Dimension {
    let axis = 1;
    let best = -Infinity;
    let aIsLow = true;
    for (let k = 0; k < 3; k += 1) {
        const aBelow = b.min[k] - a.max[k]; // gap when a sits on the low side of the axis
        const bBelow = a.min[k] - b.max[k]; // gap when b sits on the low side
        const gap = Math.max(aBelow, bBelow);
        if (gap > best) {
            best = gap;
            axis = k;
            aIsLow = aBelow >= bBelow;
        }
    }

    // The facing planes on the gap axis, and the shared footprint centre on the other two axes.
    const lowMax = aIsLow ? a.max[axis] : b.max[axis];
    const highMin = aIsLow ? b.min[axis] : a.min[axis];
    const pa: Vec3 = [0, 0, 0];
    const pb: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
        if (k === axis) {
            pa[k] = lowMax;
            pb[k] = highMin;
        } else {
            const lo = Math.max(a.min[k], b.min[k]);
            const hi = Math.min(a.max[k], b.max[k]);
            const mid = lo <= hi ? (lo + hi) / 2 : (a.min[k] + a.max[k] + b.min[k] + b.max[k]) / 4;
            pa[k] = mid;
            pb[k] = mid;
        }
    }
    return { a: pa, b: pb, distance: Math.max(0, best) };
}

/** One dimension per local edge (length, width, thickness) traced from a shared corner. */
export interface SizeDimensions {
    length: Dimension;
    width: Dimension;
    thickness: Dimension;
}

/**
 * A part's own size as three dimensions along its oriented bounding-box edges, meeting at one
 * corner — the classic length × width × thickness callout that stays correct when the part is
 * rotated (edges follow the part's local axes, not the world axes).
 */
export function sizeDimensions(part: Part, thickness: number): SizeDimensions {
    const [ux, uy, uz] = localAxesWorld(part);
    const [px, py, pz] = part.transform.pos;
    const hl = part.size.l / 2;
    const hw = part.size.w / 2;
    const ht = thickness / 2;
    // Corner = centre minus half of each local axis; edges run outward from there.
    const corner: Vec3 = [
        px - ux[0] * hl - uy[0] * hw - uz[0] * ht,
        py - ux[1] * hl - uy[1] * hw - uz[1] * ht,
        pz - ux[2] * hl - uy[2] * hw - uz[2] * ht,
    ];
    const along = (axis: readonly [number, number, number], len: number): Dimension => ({
        a: corner,
        b: [corner[0] + axis[0] * len, corner[1] + axis[1] * len, corner[2] + axis[2] * len],
        distance: len,
    });
    return {
        length: along(ux, part.size.l),
        width: along(uy, part.size.w),
        thickness: along(uz, thickness),
    };
}
