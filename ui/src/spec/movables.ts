/**
 * Movables — doors and drawers (§3.3, spec 1.12). The shop tables and derivation helpers shared
 * by the cut list (hardware rows), the linter (both sides mirror these numbers), the renderer
 * (hinge/slide placement), and the presets (opening sizing). Three-free, like
 * fasteners.ts: one definition of "how many hinges does this door take", not four.
 *
 * A movable is an annotation, not a constraint (§3.2 family): the spec stores the CLOSED
 * geometry, `transform` stays authoritative, and opening is a view-time transform that never
 * touches the document.
 */
import type { Spec, Part, Movable, Op, Vec3 } from './types';
import { localAxesWorld } from './geometry';
import { wasm } from '@/domain';
import { catalog, type HardwareItem } from '@/hardware/catalog';

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

/** The field naming each kind's anchor: a door's panel, a drawer's front, a leaf's panel. */
export function anchorField(kind: Movable['kind']): 'panelPartId' | 'frontPartId' | 'leafPartId' {
    if (kind === 'door') return 'panelPartId';
    if (kind === 'leaf') return 'leafPartId';
    return 'frontPartId';
}

/** The member whose local frame defines the movable's motion (§3.3). */
export function movableAnchorId(movable: Movable): string {
    return (movable as Record<string, unknown>)[anchorField(movable.kind)] as string;
}

/** A copy of `movable` anchored on another part (its copy in a duplicate or a mirror). */
export function withAnchor(movable: Movable, anchorId: string): Movable {
    return { ...movable, [anchorField(movable.kind)]: anchorId } as Movable;
}

/** How far a leaf reaches out from its hinge edge: the panel's other dimension. */
export function leafDepth(leaf: Part, hingeEdge: 'l0' | 'l1' | 'w0' | 'w1'): number {
    return hingeEdge === 'l0' || hingeEdge === 'l1' ? leaf.size.w : leaf.size.l;
}

/**
 * The folding bracket a leaf `depth` deep gets when it names none: the longest whose arm stops at
 * least an inch short of the free edge, or the shortest there is. Mirrors the core's
 * `leaf_support_for`.
 */
export function leafSupportFor(depth: number): HardwareItem | undefined {
    const arm = (item: HardwareItem) => (typeof item.model.arm === 'number' ? item.model.arm : 0);
    const brackets = catalog()
        .items.filter((item) => item.model.shape === 'foldingBracket')
        .sort((a, b) => arm(a) - arm(b));
    return [...brackets].reverse().find((item) => arm(item) <= depth - 1) ?? brackets[0];
}

/**
 * The edge a new leaf most likely hinges on: the one nearest the middle of the rest of the
 * piece, which is the edge that butts against it.
 */
export function leafHingeEdgeFor(spec: Spec, leaf: Part): 'l0' | 'l1' | 'w0' | 'w1' {
    const others = spec.parts.filter((p) => p.id !== leaf.id);
    if (others.length === 0) return 'w0';
    const centre = [0, 1, 2].map(
        (i) => others.reduce((sum, p) => sum + p.transform.pos[i], 0) / others.length,
    );
    const [ax, ay] = localAxesWorld(leaf);
    const at = (along: readonly number[], half: number) =>
        [0, 1, 2].map((i) => leaf.transform.pos[i] + along[i] * half);
    const edges: ['l0' | 'l1' | 'w0' | 'w1', number[]][] = [
        ['w0', at(ax, -leaf.size.l / 2)],
        ['w1', at(ax, leaf.size.l / 2)],
        ['l0', at(ay, -leaf.size.w / 2)],
        ['l1', at(ay, leaf.size.w / 2)],
    ];
    const distance = (p: number[]) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
    return edges.reduce((best, edge) => (distance(edge[1]) < distance(best[1]) ? edge : best))[0];
}

/** What a movable is called in the editor. */
export function movableKindLabel(kind: Movable['kind']): string {
    if (kind === 'door') return 'Door';
    if (kind === 'leaf') return 'Leaf';
    return 'Drawer';
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

/**
 * How far a leaf hung on its brackets (hinge "none") reaches below its panel's underside: the
 * aprons of a box wing. The bracket arms run under the whole box, so that is where it pivots.
 * 0 for a hinged leaf, whose hinges are on the panel itself.
 */
export function leafDrop(spec: Spec, movable: Movable): number {
    if (movable.kind !== 'leaf' || movable.hinge !== 'none') return 0;
    const thicknessOf = (part: Part): number =>
        spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;
    const panel = spec.parts.find((p) => p.id === movable.leafPartId);
    if (panel === undefined) return 0;
    const [, , normal] = localAxesWorld(panel);
    // The panel's local Z, turned to point down (a leaf is stored raised, level).
    const down: Vec3 = normal[1] > 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
    const along = (part: Part): number => {
        const [ax, ay, az] = localAxesWorld(part);
        const dot = (v: Vec3) => v[0] * down[0] + v[1] * down[1] + v[2] * down[2];
        const [x, y, z] = part.transform.pos;
        const centre = dot([x, y, z]);
        return (
            centre +
            Math.abs(dot(ax) * part.size.l) / 2 +
            Math.abs(dot(ay) * part.size.w) / 2 +
            Math.abs(dot(az) * thicknessOf(part)) / 2
        );
    };
    const underside = along(panel);
    const lowest = Math.max(
        ...spec.parts.filter((p) => movable.partIds.includes(p.id)).map(along),
        underside,
    );
    return lowest - underside;
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

type HoleOp = Extract<Op, { type: 'hole' }>;

/** A hole the chosen hardware needs that nobody authored: the cup of a concealed hinge. */
export interface Boring {
    partId: string;
    movableId: string;
    /** The catalog item that asks for the hole. */
    item: string;
    hole: Omit<HoleOp, 'type'>;
}

/**
 * Every hole the design's door hardware needs, from the core. Borings are derived from the
 * movables each time — by the 3D view, the shop templates and the plan — and never written into
 * `part.ops`, so changing a hinge or resizing a door cannot leave stale holes behind.
 */
export function derivedBorings(spec: Spec): Boring[] {
    if ((spec.movables ?? []).length === 0) {
        return [];
    }
    return wasm.derivedBorings(spec) as Boring[];
}

/** The derived borings as hole ops, per part: what to cut in addition to `part.ops`. */
export function derivedHoleOps(spec: Spec): Map<string, HoleOp[]> {
    const byPart = new Map<string, HoleOp[]>();
    for (const boring of derivedBorings(spec)) {
        const ops = byPart.get(boring.partId) ?? [];
        ops.push({ type: 'hole', ...boring.hole });
        byPart.set(boring.partId, ops);
    }
    return byPart;
}
