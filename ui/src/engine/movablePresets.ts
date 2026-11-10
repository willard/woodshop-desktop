/**
 * Door and drawer presets (§3.3, spec 1.12): turning "there is an opening here" into the parts,
 * the joinery, and the movable that fills it. Pure — no three.js, no Vue — so the sizing rules
 * are unit-testable and the caller only has to wrap the result in one command.
 *
 * The opening is read off the parts the user picked as its frame. v1 handles openings that face
 * along ±Z (a cabinet front, the overwhelmingly common case); anything else falls back to typed
 * dimensions in the dialog, which is honest rather than guessing at an arbitrary orientation.
 */
import type { Spec, Part, Movable } from '../spec/types';
import { worldAABB, type Box } from '../spec/geometry';
import { INSET_REVEAL, OVERLAY_ALLOWANCE, SLIDE_CLEARANCE, slideLengthFor } from '../spec/movables';
import { makePart, uniquePartIdFrom, uniqueMovableId } from './commands/Command';

/** Which side of the door the hinges go on, in the viewer's terms. */
export type HingeSide = 'left' | 'right' | 'top' | 'bottom';

export type MovableStyle = 'overlay' | 'inset';

/** A hole in the front of a carcase, ready to be filled. */
export interface Opening {
    /** Centre of the opening on its face plane, in world inches. */
    centre: [number, number];
    width: number;
    height: number;
    /** World z of the frame's front face — where an inset front sits flush. */
    plane: number;
    /** How much room there is behind the plane for a drawer box. */
    depth: number;
}

export interface MovableOptions {
    kind: 'door' | 'drawer';
    style: MovableStyle;
    hingeSide: HingeSide;
    width: number;
    height: number;
}

/** Everything an add produces: new parts, the joinery holding them, and the movable itself. */
export interface MovablePlan {
    parts: Part[];
    joints: NonNullable<Spec['joints']>;
    movable: Movable;
}

const union = (boxes: readonly Box[]): Box =>
    boxes.reduce((a, b) => ({
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    }));

/**
 * The clear span on one axis: when the frame parts sit on both sides of the centre with air
 * between them, that gap is the opening — two side panels give the width, a rail above and a
 * rail below give the height. With nothing straddling, the parts' own extent is the best answer.
 */
function clearSpan(boxes: readonly Box[], axis: 0 | 1, whole: Box): { lo: number; hi: number } {
    const mid = (whole.min[axis] + whole.max[axis]) / 2;
    // Only parts lying wholly to one side bound the opening. A rail spanning the full width
    // frames the height, not the width, so it must not narrow the axis it straddles.
    const low = boxes.filter((b) => b.max[axis] <= mid);
    const high = boxes.filter((b) => b.min[axis] >= mid);
    if (low.length === 0 || high.length === 0) {
        return { lo: whole.min[axis], hi: whole.max[axis] };
    }
    const lo = Math.max(...low.map((b) => b.max[axis]));
    const hi = Math.min(...high.map((b) => b.min[axis]));
    return hi > lo ? { lo, hi } : { lo: whole.min[axis], hi: whole.max[axis] };
}

/**
 * Reads the opening framed by the selected parts. Returns null when nothing is selected — the
 * caller then asks for dimensions instead of inventing them.
 */
export function detectOpening(spec: Spec, selectedIds: readonly string[]): Opening | null {
    const thicknessOf = (part: Part): number =>
        spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;
    const frame = spec.parts.filter((p) => selectedIds.includes(p.id));
    if (frame.length === 0) {
        return null;
    }

    const boxes = frame.map((p) => worldAABB(p, thicknessOf(p)));
    const whole = union(boxes);
    const x = clearSpan(boxes, 0, whole);
    const y = clearSpan(boxes, 1, whole);

    // The assembly's own back sets how deep a drawer can be.
    const assembly = union(spec.parts.map((p) => worldAABB(p, thicknessOf(p))));
    const plane = whole.max[2];

    return {
        centre: [(x.lo + x.hi) / 2, (y.lo + y.hi) / 2],
        width: x.hi - x.lo,
        height: y.hi - y.lo,
        plane,
        depth: Math.max(0, plane - assembly.min[2]),
    };
}

/** How much bigger (overlay) or smaller (inset) than the opening a front is cut, per side. */
export function frontAllowance(style: MovableStyle): number {
    return style === 'overlay' ? OVERLAY_ALLOWANCE : -INSET_REVEAL;
}

/** Hinge side → the door panel's own edge, in its local frame (§3.1). */
export function hingeEdgeFor(side: HingeSide): 'l0' | 'l1' | 'w0' | 'w1' {
    switch (side) {
        case 'left':
            return 'w0';
        case 'right':
            return 'w1';
        case 'top':
            return 'l1';
        case 'bottom':
            return 'l0';
    }
}

/** The default an opening suggests: a door, overlay, hinged on the left. */
export function defaultMovableOptions(opening: Opening | null): MovableOptions {
    return {
        kind: 'door',
        style: 'overlay',
        hingeSide: 'left',
        width: opening?.width ?? 12,
        height: opening?.height ?? 24,
    };
}

/** Front panel geometry shared by doors and drawer fronts. */
function frontOf(
    opening: Opening,
    options: MovableOptions,
    thickness: number,
): { l: number; w: number; pos: [number, number, number] } {
    const allowance = frontAllowance(options.style);
    // Overlay sits its back face on the frame; inset sits its front face flush with it.
    const z = options.style === 'overlay' ? opening.plane + thickness / 2 : opening.plane - thickness / 2;
    return {
        l: Math.max(1, options.width + allowance * 2),
        w: Math.max(1, options.height + allowance * 2),
        pos: [opening.centre[0], opening.centre[1], z],
    };
}

/** The material a new movable is cut from: the thinnest sheet the design already uses. */
function frontMaterial(spec: Spec): { id: string; thickness: number } {
    const sheets = spec.materials.filter((m) => m.type === 'sheet');
    const pick = [...(sheets.length > 0 ? sheets : spec.materials)].sort(
        (a, b) => a.thickness - b.thickness,
    )[0];
    return { id: pick.id, thickness: pick.thickness };
}

/** A one-panel door filling the opening, hinged on the named side. */
export function planDoor(spec: Spec, opening: Opening, options: MovableOptions): MovablePlan {
    const material = frontMaterial(spec);
    const used = new Set(spec.parts.map((p) => p.id));
    const front = frontOf(opening, options, material.thickness);
    const id = uniquePartIdFrom(used, 'p_door');

    const panel = makePart({
        id,
        name: 'Door',
        materialId: material.id,
        size: { l: front.l, w: front.w },
        pos: front.pos,
    });

    return {
        parts: [panel],
        joints: [],
        movable: {
            id: uniqueMovableId(spec, 'door'),
            kind: 'door',
            name: 'Door',
            partIds: [id],
            panelPartId: id,
            hingeEdge: hingeEdgeFor(options.hingeSide),
            style: options.style,
        },
    };
}

/**
 * A drawer: front, two sides, a back, and a bottom, fastened to each other rather than to the
 * carcase — the slides carry it (§3.3). The box is narrower than the opening by the slide
 * clearance each side, and only as deep as a stock slide it can ride on.
 */
export function planDrawer(spec: Spec, opening: Opening, options: MovableOptions): MovablePlan {
    const material = frontMaterial(spec);
    const t = material.thickness;
    const used = new Set(spec.parts.map((p) => p.id));
    const front = frontOf(opening, options, t);

    const boxWidth = Math.max(2, options.width - SLIDE_CLEARANCE * 2);
    const boxHeight = Math.max(2, options.height - 1);
    // Slides come in fixed lengths; leave an inch of room behind the box.
    const depth = slideLengthFor(Math.max(10, opening.depth - 1));
    const backOfFront = front.pos[2] - t / 2;
    const boxCentreZ = backOfFront - depth / 2;

    const ids = {
        front: uniquePartIdFrom(used, 'p_drawer_front'),
        left: uniquePartIdFrom(used, 'p_drawer_side'),
        right: uniquePartIdFrom(used, 'p_drawer_side'),
        back: uniquePartIdFrom(used, 'p_drawer_back'),
        bottom: uniquePartIdFrom(used, 'p_drawer_bottom'),
    };
    const [cx, cy] = [front.pos[0], front.pos[1]];

    const parts: Part[] = [
        makePart({
            id: ids.front,
            name: 'Drawer Front',
            materialId: material.id,
            size: { l: front.l, w: front.w },
            pos: front.pos,
        }),
        // Sides stand on edge running back from the front: local +X → world −Z at rot [0, 90, 0].
        makePart({
            id: ids.left,
            name: 'Drawer Side L',
            materialId: material.id,
            size: { l: depth, w: boxHeight },
            pos: [cx - boxWidth / 2 + t / 2, cy, boxCentreZ],
            rot: [0, 90, 0],
        }),
        makePart({
            id: ids.right,
            name: 'Drawer Side R',
            materialId: material.id,
            size: { l: depth, w: boxHeight },
            pos: [cx + boxWidth / 2 - t / 2, cy, boxCentreZ],
            rot: [0, 90, 0],
        }),
        makePart({
            id: ids.back,
            name: 'Drawer Back',
            materialId: material.id,
            size: { l: boxWidth - t * 2, w: boxHeight },
            pos: [cx, cy, boxCentreZ - depth / 2 + t / 2],
        }),
        // Bottom runs under the sides rather than between them, so it can be screwed up into
        // their bottom edges — a screw into a board's edge from below is a joint; a screw into
        // thin air between two sides is not.
        makePart({
            id: ids.bottom,
            name: 'Drawer Bottom',
            materialId: material.id,
            size: { l: boxWidth, w: depth },
            pos: [cx, cy - boxHeight / 2 - t / 2, boxCentreZ],
            rot: [90, 0, 0],
        }),
    ];

    // The sides carry the front (pocket screws through the edge that meets it) and the bottom
    // and back tie the box together — nothing fastens to the carcase, which is the whole point.
    const pocketRow = (count: number) => ({ type: 'pocketHoles' as const, count });
    parts[1].ops = [{ ...pocketRow(2), face: 'front', edge: 'w0' }];
    parts[2].ops = [{ ...pocketRow(2), face: 'back', edge: 'w0' }];
    parts[3].ops = [
        { ...pocketRow(2), face: 'back', edge: 'w0' },
        { ...pocketRow(2), face: 'back', edge: 'w1' },
    ];
    // Rot [90,0,0] puts the bottom's local +Z face underneath, so `front` heads sit below and
    // drive up; the rows run along the depth (axis w) under each side.
    parts[4].ops = [
        { type: 'screws', face: 'front', axis: 'w', offset: t / 2, count: 3 },
        { type: 'screws', face: 'front', axis: 'w', offset: boxWidth - t / 2, count: 3 },
    ];

    const joints: NonNullable<Spec['joints']> = [
        { type: 'pocketScrew', hostPartId: ids.left, insertPartId: ids.front, opRef: 0 },
        { type: 'pocketScrew', hostPartId: ids.right, insertPartId: ids.front, opRef: 0 },
        { type: 'pocketScrew', hostPartId: ids.back, insertPartId: ids.left, opRef: 0 },
        { type: 'pocketScrew', hostPartId: ids.back, insertPartId: ids.right, opRef: 1 },
        { type: 'screw', hostPartId: ids.bottom, insertPartId: ids.left, opRef: 0 },
        { type: 'screw', hostPartId: ids.bottom, insertPartId: ids.right, opRef: 1 },
    ];

    return {
        parts,
        joints,
        movable: {
            id: uniqueMovableId(spec, 'drawer'),
            kind: 'drawer',
            name: 'Drawer',
            partIds: Object.values(ids),
            frontPartId: ids.front,
            style: options.style,
        },
    };
}

/** Plans whichever kind the options ask for. */
export function planMovable(spec: Spec, opening: Opening, options: MovableOptions): MovablePlan {
    return options.kind === 'door' ? planDoor(spec, opening, options) : planDrawer(spec, opening, options);
}
