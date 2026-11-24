/**
 * Where a movable's hardware sits (§3.3, spec 1.12). Pure: it answers in each part's LOCAL frame
 * (§3.1), so the renderer can hang the metal off that part's mesh and have it ride every view
 * transform — drag, explode, and the door swing itself — for free, exactly as screws do.
 */
import type { Spec, Part, Movable, Vec3 } from '../spec/types';
import {
    extentAlong,
    frontNormal,
    hingeEdgeLength,
    hingeCountFor,
    leafDepth,
    leafDrop,
    leafSupportFor,
    movableAnchorId,
} from '../spec/movables';
import { localAxesWorld } from '../spec/geometry';
import { hingeLineLocal, leafHinge } from './open';
import { findItem } from '@/hardware/catalog';

/** One piece of hardware, placed in the local frame of the part it mounts on. */
export interface HardwarePlacement {
    partId: string;
    kind: 'hinge' | 'knob' | 'slideRail' | 'support';
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

    if (movable.kind === 'leaf') {
        leafPlacements(anchor, thickness, movable, leafDrop(spec, movable), placements);
        return placements;
    }

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
    if (slideItem?.model.mount === 'under') {
        // Undermount: a rail under each side of the box, in the recess below its bottom.
        const box = members.filter((part: Part) => part.id !== anchor.id);
        const [x, y] = localBounds(anchor, box.length > 0 ? box : [anchor], thicknessOf);
        const t = typeof slideItem.model.thickness === 'number' ? slideItem.model.thickness : 1.2;
        const h = typeof slideItem.model.height === 'number' ? slideItem.model.height : 0.5;
        const middle = (x.lo + x.hi) / 2;
        const reach = Math.max((x.hi - x.lo) / 2 - t / 2, 0);
        for (const side of [-1, 1]) {
            placements.push({
                itemId: slideItem.id,
                partId: anchor.id,
                kind: 'slideRail',
                pos: [middle + side * reach, y.lo - h / 2, -thickness / 2 - depth / 2],
                spinZ: 0,
                length: depth,
            });
        }
        return placements;
    }
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

/** The default hinge for a leaf that names none: the core's "inset butt hinges". */
const LEAF_HINGE = 'hinge.butt-2-5in';

/**
 * A leaf's metal, in its own frame: hinges along the hinge edge's lower arris, and the folding
 * brackets under it, each leg down the piece's face and its arm out under the leaf.
 */
function leafPlacements(
    leaf: Part,
    thickness: number,
    movable: Extract<Movable, { kind: 'leaf' }>,
    drop: number,
    placements: HardwarePlacement[],
): void {
    const edge = movable.hingeEdge as keyof typeof INWARD;
    const { under } = leafHinge(leaf, thickness, edge);
    const line = hingeLineLocal(leaf, thickness, edge);
    // Hinges on the panel's underside; brackets alone under the whole wing, aprons and all.
    const point: Vec3 = [line.point[0], line.point[1], under * (thickness / 2 + drop)];
    const span = hingeEdgeLength(leaf, edge);
    const alongX = line.direction[0] !== 0;
    const at = (offset: number): Vec3 =>
        alongX ? [point[0] + offset, point[1], point[2]] : [point[0], point[1] + offset, point[2]];
    const spread = (inset: number): number[] => {
        const count = hingeCountFor(span);
        const reach = Math.max(0, span / 2 - inset);
        return Array.from({ length: count }, (_, i) =>
            count === 1 ? 0 : (-1 + (2 * i) / (count - 1)) * reach,
        );
    };
    const down: Vec3 = [0, 0, under];

    // "none": the leaf is screwed to its brackets, which pivot on their own knuckles.
    const hung = movable.hinge === 'none';
    const hinge = hung ? undefined : findItem(movable.hinge ?? LEAF_HINGE);
    if (hinge?.model.shape === 'pianoHinge') {
        placements.push({
            partId: leaf.id,
            kind: 'hinge',
            pos: point,
            spinZ: 0,
            length: Math.max(1, span - 1),
            itemId: hinge.id,
            basis: { x: line.direction, z: down },
        });
    } else if (hinge !== undefined) {
        for (const offset of spread(HINGE_INSET)) {
            placements.push({
                partId: leaf.id,
                kind: 'hinge',
                pos: at(offset),
                spinZ: 0,
                itemId: hinge.id,
                basis: { x: line.direction, z: down },
            });
        }
    }

    const bracket =
        movable.support === undefined ? leafSupportFor(leafDepth(leaf, edge)) : findItem(movable.support);
    if (bracket?.model.shape !== 'foldingBracket') return;
    const leg = typeof bracket.model.leg === 'number' ? bracket.model.leg : 9;
    const width = typeof bracket.model.width === 'number' ? bracket.model.width : 1.5;
    const up = neg(down);
    // Brackets stand in from the hinges, so the two never share a spot. With no hinges they are
    // the pivot, at the very ends of the edge: on the corner posts, where a saw-cart wing has them.
    for (const offset of spread(hung ? width / 2 : HINGE_INSET * 2)) {
        const top = at(offset);
        placements.push({
            partId: leaf.id,
            kind: 'support',
            pos: [top[0] - (up[0] * leg) / 2, top[1] - (up[1] * leg) / 2, top[2] - (up[2] * leg) / 2],
            spinZ: 0,
            itemId: bracket.id,
            basis: { x: up, z: INWARD[edge] },
        });
    }
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

/**
 * How far some parts reach along the anchor's local X and Y, measured from the anchor's centre:
 * the drawer box as the front sees it, whatever way the front is turned.
 */
function localBounds(
    anchor: Part,
    parts: readonly Part[],
    thicknessOf: (part: Part) => number,
): { lo: number; hi: number }[] {
    const axes = localAxesWorld(anchor).slice(0, 2);
    const origin = anchor.transform.pos;
    return axes.map((axis) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const part of parts) {
            const [ax, ay, az] = localAxesWorld(part);
            const half = [part.size.l / 2, part.size.w / 2, thicknessOf(part) / 2];
            const dot = (v: readonly number[]) => v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
            const centre = dot(part.transform.pos.map((c, i) => c - origin[i]));
            const reach =
                Math.abs(dot(ax) * half[0]) + Math.abs(dot(ay) * half[1]) + Math.abs(dot(az) * half[2]);
            lo = Math.min(lo, centre - reach);
            hi = Math.max(hi, centre + reach);
        }
        return { lo, hi };
    });
}
