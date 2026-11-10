/**
 * Movables — doors and drawers (§3.3, spec 1.12). The shop tables and derivation helpers shared
 * by the cut list (hardware rows), the linter (both sides mirror these numbers), the renderer
 * (hinge/slide placement), and the presets (opening sizing). Pure TS, three-free, like
 * fasteners.ts: one definition of "how many hinges does this door take", not four.
 *
 * A movable is an annotation, not a constraint (§3.2 family): the spec stores the CLOSED
 * geometry, `transform` stays authoritative, and opening is a view-time transform that never
 * touches the document.
 */
import type { Spec, Part, Movable, Vec3 } from './types';
import { localAxesWorld } from './geometry';

/** How far an overlay door/drawer front laps the opening, per side. */
export const OVERLAY_ALLOWANCE = 0.5;

/** The gap an inset door leaves to the opening, per side. */
export const INSET_REVEAL = 0.0625;

/** Side clearance a drawer box leaves for its slides, per side. */
export const SLIDE_CLEARANCE = 0.5;

/** Stock side-mount slide lengths (inches). */
export const SLIDE_LENGTHS = [10, 12, 14, 16, 18, 20, 22, 24] as const;

/** A movable whose every member is farther than this from the rest of the assembly has nothing
 *  to mount its hardware on (`movable.adrift`). */
export const HARDWARE_REACH = 1;

/** Hinges per door: two, and a third once the hinge edge runs past 40". */
export function hingeCountFor(hingeEdgeLength: number): number {
    return hingeEdgeLength > 40 ? 3 : 2;
}

/** Longest stock slide that fits the box depth; the shortest stock size when nothing does. */
export function slideLengthFor(boxDepth: number): number {
    let best: number = SLIDE_LENGTHS[0];
    for (const length of SLIDE_LENGTHS) {
        if (length <= boxDepth) {
            best = length;
        }
    }
    return best;
}

/** The member whose local frame defines the movable's motion (§3.3). */
export function movableAnchorId(movable: Movable): string {
    return movable.kind === 'door' ? movable.panelPartId : movable.frontPartId;
}

/** Length of the panel edge the hinges mount on (its chord, §3.1). */
export function hingeEdgeLength(panel: Part, hingeEdge: 'l0' | 'l1' | 'w0' | 'w1'): number {
    return hingeEdge === 'l0' || hingeEdge === 'l1' ? panel.size.l : panel.size.w;
}

/** The anchor part's world front normal (local +Z, §3.1) — a drawer's pull-out direction. */
export function frontNormal(anchor: Part): Vec3 {
    return localAxesWorld(anchor)[2];
}

/**
 * Extent of a set of parts along a world direction: every member's oriented box projected onto
 * the axis, max minus min. This is a drawer's depth when the axis is its front normal.
 */
export function extentAlong(parts: readonly Part[], thicknessOf: (part: Part) => number, axis: Vec3): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const part of parts) {
        const [ax, ay, az] = localAxesWorld(part);
        const half = [part.size.l / 2, part.size.w / 2, thicknessOf(part) / 2];
        const centre =
            part.transform.pos[0] * axis[0] +
            part.transform.pos[1] * axis[1] +
            part.transform.pos[2] * axis[2];
        // |projection| of each half-extent onto the axis; the box's reach is their sum.
        const reach =
            Math.abs((ax[0] * axis[0] + ax[1] * axis[1] + ax[2] * axis[2]) * half[0]) +
            Math.abs((ay[0] * axis[0] + ay[1] * axis[1] + ay[2] * axis[2]) * half[1]) +
            Math.abs((az[0] * axis[0] + az[1] * axis[1] + az[2] * axis[2]) * half[2]);
        lo = Math.min(lo, centre - reach);
        hi = Math.max(hi, centre + reach);
    }
    return parts.length === 0 ? 0 : hi - lo;
}

/** partId → the movable it belongs to. Movables are flat: first wins, the linter errors dupes. */
export function movableMemberOf(spec: Spec): Map<string, Movable> {
    const byPart = new Map<string, Movable>();
    for (const movable of spec.movables ?? []) {
        for (const partId of movable.partIds) {
            if (!byPart.has(partId)) {
                byPart.set(partId, movable);
            }
        }
    }
    return byPart;
}
