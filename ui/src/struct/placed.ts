/**
 * Per-part world placement, computed once per assessment and shared by every check.
 * Analyzes placed instances only — `qty > 1` duplicates have no transform of their own.
 */
import type { Spec, Part, Material, Vec3 } from '../spec/types';
import { worldAABB, localAxesWorld, type Box } from '../spec/geometry';

export const EPS = 1e-6;

export interface PlacedPart {
    readonly part: Part;
    readonly material: Material;
    readonly thickness: number;
    readonly box: Box;
    /** World directions of the part's local X (length), Y (width), Z (thickness) axes. */
    readonly axes: [Vec3, Vec3, Vec3];
}

/** Parts referencing a missing material are skipped — the linter already errors on those. */
export function placeParts(spec: Spec): PlacedPart[] {
    const materialsById = new Map<string, Material>(spec.materials.map((m) => [m.id, m]));
    const placed: PlacedPart[] = [];
    for (const part of spec.parts) {
        const material = materialsById.get(part.materialId);
        if (material === undefined) {
            continue;
        }
        placed.push({
            part,
            material,
            thickness: material.thickness,
            box: worldAABB(part, material.thickness),
            axes: localAxesWorld(part),
        });
    }
    return placed;
}

export function extent(box: Box, axis: number): number {
    return box.max[axis] - box.min[axis];
}

/** Union AABB of every placed part; null when there are none. */
export function unionBox(placed: PlacedPart[]): Box | null {
    if (placed.length === 0) {
        return null;
    }
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const { box } of placed) {
        for (let i = 0; i < 3; i += 1) {
            min[i] = Math.min(min[i], box.min[i]);
            max[i] = Math.max(max[i], box.max[i]);
        }
    }
    return { min, max };
}
