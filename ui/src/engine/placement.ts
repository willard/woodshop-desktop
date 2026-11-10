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
