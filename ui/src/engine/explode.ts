/**
 * Exploded-view math — pure and framework-free so it's unit-testable without WebGL.
 *
 * The exploded view is a *presentation* transform (CLAUDE.md hard rule 1): parts translate
 * radially away from the assembly's centre, the spec's transforms are never touched, and a
 * factor of 0 restores every part to its authored position.
 */
import type { Vec3 } from './snapping';

/** How far a full explode (factor 1) pushes parts, as a multiple of their centre distance. */
export const EXPLODE_SPREAD = 1.5;

export interface ExplodeSource {
    id: string;
    /** Part centre in world inches (transform.pos — the local origin is the part centre, §3.1). */
    pos: Vec3;
}

/**
 * Scales every part centre away from the assembly centre (the bounding-box centre of the
 * part centres) by `1 + factor * EXPLODE_SPREAD`. Parts sitting exactly at the centre stay.
 */
export function explodedPositions(parts: readonly ExplodeSource[], factor: number): Map<string, Vec3> {
    const result = new Map<string, Vec3>();
    if (parts.length === 0) {
        return result;
    }

    const clamped = Math.max(0, factor);
    const min: Vec3 = [...parts[0].pos];
    const max: Vec3 = [...parts[0].pos];
    for (const part of parts) {
        for (const axis of [0, 1, 2] as const) {
            min[axis] = Math.min(min[axis], part.pos[axis]);
            max[axis] = Math.max(max[axis], part.pos[axis]);
        }
    }
    const centroid: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

    const scale = 1 + clamped * EXPLODE_SPREAD;
    for (const part of parts) {
        result.set(part.id, [
            centroid[0] + (part.pos[0] - centroid[0]) * scale,
            centroid[1] + (part.pos[1] - centroid[1]) * scale,
            centroid[2] + (part.pos[2] - centroid[2]) * scale,
        ]);
    }
    return result;
}
