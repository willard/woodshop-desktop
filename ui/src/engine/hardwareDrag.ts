/**
 * Dragging mounted hardware along the side it sits on: pure maths, no WebGL.
 *
 * A mount's `(x, y)` counts from the low corner of its side (see `mountFrame`). Dragging turns a
 * point on that side's plane, in the part's local frame, back into `(x, y)` and then pulls it onto
 * the lines a woodworker would aim for: the centre lines of the face, the row or column another
 * piece already sits on, and finally the grid.
 */
import type { HardwareMount, Spec } from '../spec/types';
import type { Vec3 } from './snapping';

type Side = HardwareMount['side'];
type Size = { l: number; w: number };

/** The plane of a side in the part's local frame: a point on it and its outward normal. */
export function sidePlane(size: Size, thickness: number, side: Side): { point: Vec3; normal: Vec3 } {
    const hl = size.l / 2;
    const hw = size.w / 2;
    const ht = thickness / 2;
    switch (side) {
        case 'front':
            return { point: [0, 0, ht], normal: [0, 0, 1] };
        case 'back':
            return { point: [0, 0, -ht], normal: [0, 0, -1] };
        case 'l0':
            return { point: [0, -hw, 0], normal: [0, -1, 0] };
        case 'l1':
            return { point: [0, hw, 0], normal: [0, 1, 0] };
        case 'w0':
            return { point: [-hl, 0, 0], normal: [-1, 0, 0] };
        case 'w1':
            return { point: [hl, 0, 0], normal: [1, 0, 0] };
    }
}

/** The inverse of `mountFrame`: a local point on a side, as that side's `(x, y)`. Not clamped. */
export function sideCoords(
    size: Size,
    thickness: number,
    side: Side,
    local: readonly [number, number, number],
): { x: number; y: number } {
    const hl = size.l / 2;
    const hw = size.w / 2;
    const ht = thickness / 2;
    if (side === 'front' || side === 'back') return { x: local[0] + hl, y: local[1] + hw };
    if (side === 'l0' || side === 'l1') return { x: local[0] + hl, y: local[2] + ht };
    return { x: local[1] + hw, y: local[2] + ht };
}

/** A line on the side the dragged piece has snapped onto: `x = at` or `y = at`. */
export interface MountGuide {
    axis: 'x' | 'y';
    at: number;
    kind: 'centre' | 'hardware';
}

export interface MountSnap {
    x: number;
    y: number;
    guides: MountGuide[];
}

/** Lines worth snapping to, per axis, from the other hardware in the design. */
export interface MountTargets {
    x: number[];
    y: number[];
}

/**
 * The rows and columns other hardware gives the dragged piece to line up with:
 *  - anything else on the same side of the same part (a second knob level with the first);
 *  - the same catalog item on the same side of another part whose side is the same size, so a
 *    pull lands where its twin sits on the next drawer front or the matching door.
 */
export function mountTargets(spec: Spec, mountId: string): MountTargets {
    const mounts = spec.hardware ?? [];
    const dragged = mounts.find((m) => m.id === mountId);
    const targets: MountTargets = { x: [], y: [] };
    if (dragged === undefined) return targets;
    const partsById = new Map(spec.parts.map((p) => [p.id, p]));
    const own = partsById.get(dragged.partId);
    const sameSize = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
    for (const other of mounts) {
        if (other.id === mountId || other.side !== dragged.side) continue;
        if (other.partId !== dragged.partId) {
            const part = partsById.get(other.partId);
            if (other.item !== dragged.item || part === undefined || own === undefined) continue;
            if (!sameSize(part.size.l, own.size.l) || !sameSize(part.size.w, own.size.w)) continue;
        }
        targets.x.push(other.x);
        targets.y.push(other.y);
    }
    return targets;
}

export interface MountSnapOptions {
    /** Grid step in inches; 0 turns grid snapping off. */
    gridSize: number;
    /** How close, in inches, the piece has to come to a line before it jumps onto it. */
    tolerance: number;
}

/**
 * Snaps a candidate `(x, y)` on a side `extent` big. Per axis: the centre line wins, then the
 * nearest line from other hardware, then the grid. The result always stays on the side.
 */
export function snapMount(
    candidate: { x: number; y: number },
    extent: readonly [number, number],
    targets: MountTargets,
    options: MountSnapOptions,
): MountSnap {
    const guides: MountGuide[] = [];
    const axis = (value: number, max: number, lines: readonly number[], name: 'x' | 'y'): number => {
        const clamped = Math.min(Math.max(value, 0), max);
        if (Math.abs(clamped - max / 2) <= options.tolerance) {
            guides.push({ axis: name, at: max / 2, kind: 'centre' });
            return max / 2;
        }
        let best: number | null = null;
        for (const line of lines) {
            if (line < 0 || line > max) continue;
            const d = Math.abs(clamped - line);
            if (d <= options.tolerance && (best === null || d < Math.abs(clamped - best))) best = line;
        }
        if (best !== null) {
            guides.push({ axis: name, at: best, kind: 'hardware' });
            return best;
        }
        const grid =
            options.gridSize > 0 ? Math.round(clamped / options.gridSize) * options.gridSize : clamped;
        return Math.min(Math.max(grid, 0), max);
    };
    const x = axis(candidate.x, extent[0], targets.x, 'x');
    const y = axis(candidate.y, extent[1], targets.y, 'y');
    return { x, y, guides };
}
