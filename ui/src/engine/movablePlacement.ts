/**
 * Where a movable's hardware sits (§3.3, spec 1.12). Pure: it answers in each part's LOCAL frame
 * (§3.1), so the renderer can hang the metal off that part's mesh and have it ride every view
 * transform — drag, explode, and the door swing itself — for free, exactly as screws do.
 */
import type { Spec, Part, Movable, Vec3 } from '../spec/types';
import { extentAlong, frontNormal, hingeEdgeLength, hingeCountFor, movableAnchorId } from '../spec/movables';
import { hingeLineLocal } from './open';
import { findItem } from '@/hardware/catalog';

/** One piece of hardware, placed in the local frame of the part it mounts on. */
export interface HardwarePlacement {
    partId: string;
    kind: 'hinge' | 'knob' | 'slideRail';
    pos: Vec3;
    /** Rotation about local Z, in radians — enough to lay a hinge barrel along the hinge line. */
    spinZ: number;
    /** Rail length (`slideRail`), or the hinge length for one cut to fit (a piano hinge). */
    length?: number;
    /** The catalog item to draw (spec 1.15). Absent: the plain default geometry for `kind`. */
    itemId?: string;
    /**
     * For a catalog item: where its long axis (`x`) and its outward direction (`z`) point in the
     * part's local frame. Replaces `spinZ`.
     */
    basis?: { x: Vec3; z: Vec3 };
}

/** From each hinge edge toward the middle of the panel. */
const INWARD: Record<'l0' | 'l1' | 'w0' | 'w1', Vec3> = {
    l0: [0, 1, 0],
    l1: [0, -1, 0],
    w0: [1, 0, 0],
    w1: [-1, 0, 0],
};
const FRONT: Vec3 = [0, 0, 1];
const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

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
        const hinge = findItem(movable.hinge);
        const hingeItem = hinge?.role === 'hinge' ? hinge : undefined;
        const shape = hingeItem?.model.shape;
        const inward = INWARD[movable.hingeEdge as keyof typeof INWARD];
        if (hingeItem !== undefined && shape === 'pianoHinge') {
            // One continuous hinge, cut to the edge.
            placements.push({
                partId: anchor.id,
                kind: 'hinge',
                pos: line.point,
                spinZ: 0,
                length: Math.max(1, span - 1),
                itemId: hingeItem.id,
                basis: { x: line.direction, z: FRONT },
            });
        } else {
            for (let i = 0; i < count; i += 1) {
                const t = count === 1 ? 0 : -1 + (2 * i) / (count - 1);
                const offset = t * reach;
                const onLine: Vec3 = alongX
                    ? [line.point[0] + offset, line.point[1], line.point[2]]
                    : [line.point[0], line.point[1] + offset, line.point[2]];
                if (hingeItem === undefined) {
                    placements.push({
                        partId: anchor.id,
                        kind: 'hinge',
                        pos: onLine,
                        // The barrel is modelled along local Y; an l-edge hinge line runs along X.
                        spinZ: alongX ? Math.PI / 2 : 0,
                    });
                } else if (shape === 'euroHinge') {
                    // Concealed: the cup sits in the door's inside face, bored in from the edge,
                    // and the arm reaches back past that edge to the cabinet side.
                    const boring =
                        typeof hingeItem.model.boring === 'number' ? hingeItem.model.boring : 0.886;
                    placements.push({
                        partId: anchor.id,
                        kind: 'hinge',
                        pos: [onLine[0] + inward[0] * boring, onLine[1] + inward[1] * boring, -thickness / 2],
                        spinZ: 0,
                        itemId: hingeItem.id,
                        basis: { x: neg(inward), z: neg(FRONT) },
                    });
                } else {
                    // Surface hinges: the knuckle on the hinge line. A T-hinge's strap reaches
                    // across the door; a butt hinge's leaves lie either side of the line.
                    placements.push({
                        partId: anchor.id,
                        kind: 'hinge',
                        pos: onLine,
                        spinZ: 0,
                        itemId: hingeItem.id,
                        basis: { x: shape === 'teeHinge' ? inward : line.direction, z: FRONT },
                    });
                }
            }
        }
        // A bar pull on a door stands parallel to the hinge edge.
        pushPull(placements, movable.pull, knobFor(anchor, thickness, movable.hingeEdge), line.direction);
        return placements;
    }

    // Drawer: the knob centred on the front, and a rail down each side of the box.
    pushPull(placements, movable.pull, knobFor(anchor, thickness, null), [1, 0, 0]);

    const members = movable.partIds
        .map((id: string) => partsById.get(id))
        .filter((part: Part | undefined): part is Part => part !== undefined);
    const depth = extentAlong(members, thicknessOf, frontNormal(anchor));
    const slide = findItem(movable.slide);
    const slideItem = slide?.role === 'slide' ? slide : undefined;
    const railInset = 0.1;
    for (const side of [-1, 1]) {
        placements.push({
            ...(slideItem === undefined ? {} : { itemId: slideItem.id }),
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

/** The pull a movable opens with: its chosen catalog item, the plain knob, or nothing. */
function pushPull(
    placements: HardwarePlacement[],
    pull: string | undefined,
    at: HardwarePlacement,
    along: Vec3,
): void {
    if (pull === 'none') {
        return;
    }
    const item = findItem(pull);
    if (item?.role === 'pull') {
        placements.push({ ...at, itemId: item.id, basis: { x: along, z: FRONT } });
    } else {
        placements.push(at);
    }
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
