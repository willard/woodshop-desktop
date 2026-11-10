/**
 * Dowel-joint planning (§3.2 — joints are annotations, not constraints). Given two abutting
 * parts, the one whose thickness axis matches the contact normal receives blind dowel holes
 * (purpose `dowel`) along the contact centerline on its mating face; the mate's edge holes
 * are not representable in the schema (holes are front/back-face only, §3.1) and are implied
 * by the recorded `dowel` joint (D39). Pure planning — the AddDowelJoint command applies it.
 */
import type { Spec, Op } from '../spec/types';
import { worldAABB, TOUCH_TOL, type Box } from '../spec/geometry';
import { faceContact, isContactError } from './contact';
import { DEFAULT_DOWEL_CONFIG, type DowelConfig } from './config';

type HoleOp = Extract<Op, { type: 'hole' }>;

export interface DowelPlan {
    /** The part that receives the face holes (not necessarily the selected part). */
    partId: string;
    matePartId: string;
    holes: HoleOp[];
}

export type DowelResult = DowelPlan | { error: string };

const ROUND = 1 / 64; // clean fractions, matching auto-notch

const snap = (v: number): number => Math.round(v / ROUND) * ROUND;

/**
 * Plans dowel holes joining `preferredId` and `mateId`. The preferred part gets the holes
 * when both faces qualify (face-to-face lamination); otherwise whichever part's face meets
 * the joint. Returns `{ error }` with a user-facing message when the pair can't be dowelled.
 */
export function planDowels(
    spec: Spec,
    preferredId: string,
    mateId: string,
    config: DowelConfig = DEFAULT_DOWEL_CONFIG,
): DowelResult {
    const contact = faceContact(spec, preferredId, mateId);
    if (isContactError(contact)) {
        // Keep the dowel-specific wording the inspector already shows.
        return {
            error:
                contact.error === 'Parts must touch to fasten them.'
                    ? 'Parts must touch to dowel them.'
                    : contact.error === 'Neither part has a face on the joint.'
                      ? 'Neither part has a face on the joint — dowels need a face-to-edge or face-to-face contact.'
                      : contact.error,
        };
    }
    const { host: face, mate, face: faceName, rect } = contact;
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const tF = thicknessOf.get(face.materialId) ?? 0;

    const { x0: dx0, x1: dx1, y0: dy0, y1: dy1 } = rect;
    if (Math.min(dx1 - dx0, dy1 - dy0) < config.diameter) {
        return { error: 'Contact area is too small for dowels.' };
    }

    // Dowels run along the longer side of the contact rect, centered across the shorter.
    const alongX = dx1 - dx0 >= dy1 - dy0;
    const [run0, run1] = alongX ? [dx0, dx1] : [dy0, dy1];
    const cross = alongX ? (dy0 + dy1) / 2 : (dx0 + dx1) / 2;
    const depth = Math.max(tF - config.reveal, tF / 2);

    const holes: HoleOp[] = positions(run0, run1, config).map((at) => ({
        type: 'hole',
        face: faceName,
        x: snap(alongX ? at : cross),
        y: snap(alongX ? cross : at),
        diameter: config.diameter,
        depth: snap(depth),
        purpose: 'dowel',
    }));
    return { partId: face.id, matePartId: mate.id, holes };
}

/** Evenly spaced centers along the run, inset from the ends; short runs get one center dowel. */
function positions(run0: number, run1: number, config: DowelConfig): number[] {
    const run = run1 - run0;
    const inset = Math.min(config.endInset, run / 4);
    const usable = run - 2 * inset;
    if (usable <= 0 || run < 3) {
        return [run0 + run / 2];
    }
    const count = Math.max(2, Math.min(12, Math.floor(usable / config.spacing) + 1));
    const step = usable / (count - 1);
    return Array.from({ length: count }, (_, i) => run0 + inset + i * step);
}

/** Parts abutting `partId` (gap within ±TOUCH_TOL) — candidates for the Inspector's dowel action. */
export function touchingParts(spec: Spec, partId: string): Array<{ partId: string; name: string }> {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const part = spec.parts.find((p) => p.id === partId);
    if (part === undefined) {
        return [];
    }
    const box = worldAABB(part, thicknessOf.get(part.materialId) ?? 0);
    const touching: Array<{ partId: string; name: string }> = [];
    for (const other of spec.parts) {
        if (other.id === partId) {
            continue;
        }
        const sep = boxSeparation(box, worldAABB(other, thicknessOf.get(other.materialId) ?? 0));
        if (Math.abs(sep) <= TOUCH_TOL) {
            touching.push({ partId: other.id, name: other.name });
        }
    }
    return touching;
}

function boxSeparation(a: Box, b: Box): number {
    let sep = -Infinity;
    for (let i = 0; i < 3; i += 1) {
        sep = Math.max(sep, a.min[i] - b.max[i], b.min[i] - a.max[i]);
    }
    return sep;
}
