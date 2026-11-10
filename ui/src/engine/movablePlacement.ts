/**
 * Where a movable's hardware sits (§3.3, spec 1.12). Pure: it answers in each part's LOCAL frame
 * (§3.1), so the renderer can hang the metal off that part's mesh and have it ride every view
 * transform — drag, explode, and the door swing itself — for free, exactly as screws do.
 */
import type { Spec, Part, Movable, Vec3 } from '../spec/types';
import { extentAlong, frontNormal, hingeEdgeLength, hingeCountFor, movableAnchorId } from '../spec/movables';
import { hingeLineLocal } from './open';

/** One piece of hardware, placed in the local frame of the part it mounts on. */
export interface HardwarePlacement {
    partId: string;
    kind: 'hinge' | 'knob' | 'slideRail';
    pos: Vec3;
    /** Rotation about local Z, in radians — enough to lay a hinge barrel along the hinge line. */
    spinZ: number;
    /** Rail length; only meaningful for `slideRail`. */
    length?: number;
}

/** Hinges sit this far in from each end of the hinge edge. */
const HINGE_INSET = 3;

/** How far the knob sits in from the free edge. */
const KNOB_INSET = 1.5;

/**
 * Every piece of hardware a movable carries. Hinges ride the hinge line, the knob sits near the
 * free edge of the anchor's show face, and a drawer's two rails run back from the front's ends —
 * which is where a side-mount slide actually lives.
 */
export function hardwarePlacements(spec: Spec, movable: Movable): HardwarePlacement[] {
    const partsById = new Map<string, Part>(spec.parts.map((p) => [p.id, p]));
    const anchor = partsById.get(movableAnchorId(movable));
    if (anchor === undefined) {
        return [];
    }
    const thicknessOf = (part: Part): number =>
        spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;
    const thickness = thicknessOf(anchor);
    const placements: HardwarePlacement[] = [];

    if (movable.kind === 'door') {
        const line = hingeLineLocal(anchor, thickness, movable.hingeEdge);
        const span = hingeEdgeLength(anchor, movable.hingeEdge);
        const count = hingeCountFor(span);
        // Evenly spaced between the two inset positions; a middle hinge lands in the centre.
        const reach = Math.max(0, span / 2 - HINGE_INSET);
        const alongX = line.direction[0] !== 0;
        for (let i = 0; i < count; i += 1) {
            const t = count === 1 ? 0 : -1 + (2 * i) / (count - 1);
            const offset = t * reach;
            placements.push({
                partId: anchor.id,
                kind: 'hinge',
                pos: alongX
                    ? [line.point[0] + offset, line.point[1], line.point[2]]
                    : [line.point[0], line.point[1] + offset, line.point[2]],
                // The barrel is modelled along local Y; an l-edge hinge line runs along X.
                spinZ: alongX ? Math.PI / 2 : 0,
            });
        }
        placements.push(knobFor(anchor, thickness, movable.hingeEdge));
        return placements;
    }

    // Drawer: the knob centred on the front, and a rail down each side of the box.
    placements.push(knobFor(anchor, thickness, null));

    const members = movable.partIds
        .map((id: string) => partsById.get(id))
        .filter((part: Part | undefined): part is Part => part !== undefined);
    const depth = extentAlong(members, thicknessOf, frontNormal(anchor));
    const railInset = 0.1;
    for (const side of [-1, 1]) {
        placements.push({
            partId: anchor.id,
            kind: 'slideRail',
            // Running back from the front's inner face, at each end of it.
            pos: [side * (anchor.size.l / 2 - railInset), 0, -thickness / 2 - depth / 2],
            spinZ: 0,
            length: depth,
        });
    }
    return placements;
}

/** The knob: on the show face, in from the edge opposite the hinge (or centred on a drawer). */
function knobFor(
    anchor: Part,
    thickness: number,
    hingeEdge: 'l0' | 'l1' | 'w0' | 'w1' | null,
): HardwarePlacement {
    const halfL = anchor.size.l / 2;
    const halfW = anchor.size.w / 2;
    let x = 0;
    let y = 0;
    if (hingeEdge === 'w0') {
        x = halfL - KNOB_INSET;
    } else if (hingeEdge === 'w1') {
        x = -halfL + KNOB_INSET;
    } else if (hingeEdge === 'l0') {
        y = halfW - KNOB_INSET;
    } else if (hingeEdge === 'l1') {
        y = -halfW + KNOB_INSET;
    }

    return { partId: anchor.id, kind: 'knob', pos: [x, y, thickness / 2], spinZ: 0 };
}
