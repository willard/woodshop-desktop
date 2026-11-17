/**
 * Click-to-place math — pure and framework-free (testable without WebGL).
 *
 * Converts a raycast hit in a part's LOCAL frame into §3.1 op coordinates: `x` measured
 * from the w0 edge (x = −l/2) and `y` from the l0 edge (y = −w/2), grid-snapped and
 * clamped to the face. Because the inputs are mesh-local, rotated parts need no special
 * casing — `mesh.worldToLocal` has already done the work.
 */
import type { Vec3 } from './snapping';

export interface FaceHit {
    face: 'front' | 'back';
    /** Op coords in inches from the low edges (§3.1). */
    x: number;
    y: number;
}

/** How aligned the local hit normal must be with ±Z to count as a front/back face. */
const FACE_NORMAL_MIN = 0.99;

/**
 * Maps a local-space hit (point + geometric normal) to op coordinates on the front or
 * back face. Returns null for edge faces, mitered bevels, and curved rims — ops may only
 * reference front/back (§3.1).
 */
export function faceHitToOpCoords(
    size: { l: number; w: number },
    localPoint: Vec3,
    localNormal: Vec3,
    gridSize: number,
): FaceHit | null {
    const nz = localNormal[2];
    const planar = Math.hypot(localNormal[0], localNormal[1]);
    if (Math.abs(nz) / (Math.hypot(planar, nz) || 1) < FACE_NORMAL_MIN) {
        return null;
    }

    const snap = (value: number): number => (gridSize > 0 ? Math.round(value / gridSize) * gridSize : value);
    const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

    return {
        face: nz > 0 ? 'front' : 'back',
        x: clamp(snap(localPoint[0] + size.l / 2), size.l),
        y: clamp(snap(localPoint[1] + size.w / 2), size.w),
    };
}

export type Edge = 'l0' | 'l1' | 'w0' | 'w1';

/**
 * Maps a front/back-face hit to the nearest of the part's four edges (§3.1): l0 at
 * y = −w/2, l1 at y = +w/2, w0 at x = −l/2, w1 at x = +l/2. Used to place edge-referencing
 * ops (pocket holes) by pointing at the broad face near the edge you want. Returns null on
 * edge faces and slanted normals, matching faceHitToOpCoords.
 */
export function faceHitToEdge(
    size: { l: number; w: number },
    localPoint: Vec3,
    localNormal: Vec3,
): Edge | null {
    const nz = localNormal[2];
    const planar = Math.hypot(localNormal[0], localNormal[1]);
    if (Math.abs(nz) / (Math.hypot(planar, nz) || 1) < FACE_NORMAL_MIN) {
        return null;
    }
    const distances: Array<{ edge: Edge; d: number }> = [
        { edge: 'w0', d: Math.abs(localPoint[0] + size.l / 2) },
        { edge: 'w1', d: Math.abs(size.l / 2 - localPoint[0]) },
        { edge: 'l0', d: Math.abs(localPoint[1] + size.w / 2) },
        { edge: 'l1', d: Math.abs(size.w / 2 - localPoint[1]) },
    ];
    return distances.reduce((nearest, cur) => (cur.d < nearest.d ? cur : nearest)).edge;
}

export type Side = 'front' | 'back' | Edge;

export interface SideHit {
    side: Side;
    /** The side's own coordinates, as a mount stores them (see `mountFrame`). */
    x: number;
    y: number;
}

/**
 * Maps a local-space hit on ANY of a part's six sides to a hardware mount's side and `(x, y)`:
 * faces as `faceHitToOpCoords`, the long edges (l0/l1) with `x` along the length and `y` across
 * the thickness from the back, the ends (w0/w1) with `x` along the width. Across a thickness, the
 * centre line wins when the pointer is near it, since that is where hardware on an edge goes.
 * Returns null on a slanted or curved surface.
 */
export function hitToSide(
    size: { l: number; w: number },
    thickness: number,
    localPoint: Vec3,
    localNormal: Vec3,
    gridSize: number,
): SideHit | null {
    const length = Math.hypot(...localNormal) || 1;
    const n = localNormal.map((v) => v / length);
    const axis = n.findIndex((v) => Math.abs(v) >= FACE_NORMAL_MIN);
    if (axis === -1) {
        return null;
    }
    const snap = (value: number): number => (gridSize > 0 ? Math.round(value / gridSize) * gridSize : value);
    const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);
    const across = (value: number): number => {
        const centre = thickness / 2;
        return Math.abs(value - centre) <= thickness * 0.25 ? centre : clamp(snap(value), thickness);
    };
    const [px, py, pz] = localPoint;
    const positive = n[axis] > 0;
    if (axis === 2) {
        return {
            side: positive ? 'front' : 'back',
            x: clamp(snap(px + size.l / 2), size.l),
            y: clamp(snap(py + size.w / 2), size.w),
        };
    }
    if (axis === 1) {
        return {
            side: positive ? 'l1' : 'l0',
            x: clamp(snap(px + size.l / 2), size.l),
            y: across(pz + thickness / 2),
        };
    }
    return {
        side: positive ? 'w1' : 'w0',
        x: clamp(snap(py + size.w / 2), size.w),
        y: across(pz + thickness / 2),
    };
}
