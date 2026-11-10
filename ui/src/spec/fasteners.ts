/**
 * Fastener sizing — the shop's tables (screw lengths, pocket-screw table, thread and gauge rules)
 * and where each screw lands. Implemented in Rust (`woodshop-core::fasteners`) so the renderer,
 * the hardware list and the linter agree on every screw.
 */
import { wasm } from '@/domain';
import type { Material, Species, Part, Op, Vec3 } from './types';
import { localAxesWorld } from './geometry';

/** Lengths shops actually stock, ascending (inches) — for pickers. */
export const STOCK_SCREW_LENGTHS: readonly number[] = [0.625, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

/** Share of a pocket screw's length that ends up in the mate (the renderer draws the same split). */
export const POCKET_BITE_FRACTION = 0.45;

/** Species that want a fine thread; everything else (and every sheet good) takes coarse. */
export const HARDWOOD_SPECIES: readonly Species[] = ['oak', 'maple', 'walnut', 'cherry'];

export type ScrewGauge = '#6' | '#8' | '#10';
export type ScrewThread = 'coarse' | 'fine';

/** The 2/3 rule with a hard stop, rounded down to a stocked length. */
export function woodScrewLength(hostThickness: number, mateThickness: number): number {
    return wasm.woodScrewLength(hostThickness, mateThickness);
}

/** Pocket-screw length for a host thickness; clamped so the bite fits a mate when one is given. */
export function pocketScrewLength(hostThickness: number, mateThickness?: number): number {
    return wasm.pocketScrewLength(hostThickness, mateThickness);
}

/** Coarse bites softwood and sheet goods; fine holds in hardwood without splitting it. */
export function pocketScrewThread(mate: Material | undefined): ScrewThread {
    return wasm.pocketScrewThread(mate) as ScrewThread;
}

/** #6 in thin stock, #8 everywhere else — #10 is only ever an explicit override. */
export function screwGauge(mateThickness: number): ScrewGauge {
    return wasm.screwGauge(mateThickness) as ScrewGauge;
}

/** Pocket screws are driven at this angle off the face — the jig's angle. */
export const POCKET_ANGLE = (15 * Math.PI) / 180;

export type FastenerOp = Extract<Op, { type: 'pocketHoles' | 'screws' }>;

/** One screw, in the part's local frame. */
export interface FastenerSegment {
    head: Vec3;
    /** Unit direction the screw travels, head → tip. */
    direction: Vec3;
    length: number;
    tip: Vec3;
}

/** Every screw an op places, in the part's local frame. */
export function fastenerSegments(part: Part, thickness: number, op: FastenerOp): FastenerSegment[] {
    return wasm.fastenerSegments(part, thickness, op) as FastenerSegment[];
}

/** A point in a part's local frame, placed in world space (§3.1 transform). */
export function localToWorld(part: Part, local: Vec3): Vec3 {
    const [xAxis, yAxis, zAxis] = localAxesWorld(part);
    const [px, py, pz] = part.transform.pos;
    return [
        px + xAxis[0] * local[0] + yAxis[0] * local[1] + zAxis[0] * local[2],
        py + xAxis[1] * local[0] + yAxis[1] * local[1] + zAxis[1] * local[2],
        pz + xAxis[2] * local[0] + yAxis[2] * local[1] + zAxis[2] * local[2],
    ];
}
