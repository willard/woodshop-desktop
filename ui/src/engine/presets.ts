/**
 * Part presets and placement planning (build-plan §4). Pure TS — no DOM, no Vue — so the geometry
 * is unit tested (CLAUDE.md).
 *
 * A preset carries an orientation, not just a size: §3.1 fixes a part's length to its local +X, so
 * a part authored with rot [0,0,0] enters the scene lying down. A leg has to be turned upright to
 * be a leg. Placement then seats the new parts against the existing assembly, because the linter
 * rejects a part that touches nothing (`part.floating`) or passes through another (`part.pierce`).
 */
import * as THREE from 'three';
import type { Spec, Part, Material } from '../spec/types';
import { aabbFromPart, type AABB, type Vec3 } from './snapping';
import { makePart, uniquePartIdFrom, uniqueMaterialId } from './commands/Command';

export const PART_KINDS = ['leg', 'apron', 'slat', 'panel', 'shelf', 'board', 'dowel'] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** How the blank stands in the world: length up, width up, or face up. */
export type Orientation = 'upright' | 'onEdge' | 'flat';

export interface PartPreset {
    label: string;
    /** Along the grain — the dimension a board is cut to length. */
    l: number;
    w: number;
    orientation: Orientation;
    /** How many the preset adds by default: a table wants four legs, not one. */
    qty: number;
}

export const PART_PRESETS: Record<PartKind, PartPreset> = {
    leg: { label: 'Leg', l: 18, w: 3.5, orientation: 'upright', qty: 4 },
    apron: { label: 'Apron / rail', l: 24, w: 3.5, orientation: 'onEdge', qty: 1 },
    slat: { label: 'Slat', l: 24, w: 2.5, orientation: 'flat', qty: 1 },
    panel: { label: 'Panel', l: 24, w: 24, orientation: 'onEdge', qty: 1 },
    shelf: { label: 'Shelf', l: 30, w: 11.25, orientation: 'flat', qty: 1 },
    board: { label: 'Board', l: 24, w: 5.5, orientation: 'flat', qty: 1 },
    // A dowel rail lies along its own length; its width is the diameter, which the round material
    // must agree with (part.round-width, D60).
    dowel: { label: 'Dowel rail', l: 24, w: 0.75, orientation: 'onEdge', qty: 1 },
};

/** Euler XYZ degrees (§3.1 local frame: length +X, width +Y, thickness +Z). */
export function rotationFor(orientation: Orientation): Vec3 {
    switch (orientation) {
        case 'upright':
            return [0, 0, 90]; // length up the Y axis
        case 'flat':
            return [90, 0, 0]; // face up, thickness vertical
        default:
            return [0, 0, 0]; // standing on its long edge
    }
}

export interface AddPartOptions {
    kind: PartKind;
    l: number;
    w: number;
    qty: number;
    orientation: Orientation;
}

export interface PartPlan {
    parts: Part[];
    /**
     * Stock the plan needs that the design does not have yet — a dowel preset dropped into a
     * design of plywood and pine has nowhere to point until its round material exists.
     */
    material?: Material;
    /**
     * How far the existing parts rise, when the legs would otherwise hang below the floor:
     * putting legs under a design that is sitting on the ground stands it up on them.
     */
    lift: { partIds: string[]; dy: number } | null;
}

export function defaultOptions(kind: PartKind): AddPartOptions {
    const preset = PART_PRESETS[kind];
    return { kind, l: preset.l, w: preset.w, qty: preset.qty, orientation: preset.orientation };
}

/**
 * Lays out the parts an add produces: upright legs go under the corners of whatever they'll
 * carry, everything else sits on top of the assembly. Positions are chosen to touch, never to
 * overlap, so the result lints clean.
 */
export function planParts(spec: Spec, options: AddPartOptions): PartPlan {
    const stock = stockFor(spec, options);
    const thickness = stock.material?.thickness ?? spec.materials[0]?.thickness ?? 0.75;
    const rot = rotationFor(options.orientation);
    const half = halfExtents(options.l, options.w, thickness, rot);
    const qty = Math.max(1, Math.round(options.qty));

    const used = new Set(spec.parts.map((p) => p.id));
    const makeAt = (pos: Vec3, index: number): Part => {
        const id = uniquePartIdFrom(used, `p_${options.kind}`);
        used.add(id);
        const preset = PART_PRESETS[options.kind];
        return makePart({
            id,
            name: qty > 1 ? `${preset.label} ${index + 1}` : preset.label,
            materialId: stock.materialId,
            size: { l: options.l, w: options.w },
            grainAxis: 'l',
            pos,
            rot,
        });
    };

    const plan =
        options.orientation === 'upright' && spec.parts.length > 0
            ? planUnderAssembly(spec, half, qty, makeAt)
            : { parts: stackBeside(spec, half, qty, makeAt), lift: null };

    return stock.material === undefined ? plan : { ...plan, material: stock.material };
}

/**
 * Which material the new parts point at. Everything but a dowel takes the design's first material,
 * the way presets always have. A dowel needs round stock (D60): reuse one of its diameter if the
 * design already has it, otherwise the plan carries a new one for the command to add.
 */
function stockFor(spec: Spec, options: AddPartOptions): { materialId: string; material?: Material } {
    if (options.kind !== 'dowel') {
        return { materialId: spec.materials[0].id };
    }
    const EPS = 1e-6;
    const existing = spec.materials.find(
        (m) => m.type === 'round' && Math.abs(m.thickness - options.w) < EPS,
    );
    if (existing !== undefined) {
        return { materialId: existing.id };
    }
    const material: Material = {
        id: uniqueMaterialId(spec, 'mat_dowel'),
        type: 'round',
        name: `Dowel ${options.w}"`.slice(0, 80),
        thickness: options.w,
        stockLengths: [36, 48],
        grain: true,
    };

    return { materialId: material.id, material };
}

/**
 * Legs go under the whole design, not under its top: on a cabinet the topmost part is the lid,
 * and legs hung from it would run straight through the carcase. The lowest part is what stands on
 * the floor, so that is what they carry — one leg per corner of its footprint, tops flush against
 * its underside so they touch it without piercing it.
 */
function planUnderAssembly(
    spec: Spec,
    half: Vec3,
    qty: number,
    makeAt: (pos: Vec3, index: number) => Part,
): PartPlan {
    const boxes = spec.parts.map((p) => ({ part: p, box: worldBox(spec, p) }));
    // The part they'll hold up: the lowest, and the broadest of those if several are level.
    const base = boxes.reduce((best, candidate) =>
        candidate.box.min[1] < best.box.min[1] - 1e-6 ||
        (Math.abs(candidate.box.min[1] - best.box.min[1]) <= 1e-6 &&
            footprint(candidate.box) > footprint(best.box))
            ? candidate
            : best,
    );

    const corners: Vec3[] = [
        [base.box.min[0] + half[0], 0, base.box.min[2] + half[2]],
        [base.box.max[0] - half[0], 0, base.box.min[2] + half[2]],
        [base.box.min[0] + half[0], 0, base.box.max[2] - half[2]],
        [base.box.max[0] - half[0], 0, base.box.max[2] - half[2]],
    ];

    // The legs have to touch that underside (or they lint as floating) and would rather stand on
    // the floor. Both only hold when the underside sits exactly one leg-length up.
    const underside = base.box.min[1];
    const length = half[1] * 2;
    const standsOnFloor = underside < length - 1e-6;
    const centreY = standsOnFloor ? half[1] : underside - half[1];

    // A design resting on the ground rises onto its new legs; one already high enough stays put
    // and the legs hang from it. `locked` is left alone: this is an authored placement, not the
    // hand-edit of a part's geometry that hard rule 10 tracks.
    const lift = standsOnFloor ? { partIds: spec.parts.map((p) => p.id), dy: length - underside } : null;

    const parts: Part[] = [];
    for (let i = 0; i < qty; i += 1) {
        const corner = corners[i % corners.length];
        // Beyond four, offset along X so extra legs stay distinct rather than co-located.
        const wrap = Math.floor(i / corners.length) * half[0] * 2;
        parts.push(makeAt([corner[0] + wrap, centreY, corner[2]], i));
    }

    return { parts, lift };
}

/** Everything else: stacked on top of the assembly, centred, each course above the last. */
function stackBeside(
    spec: Spec,
    half: Vec3,
    qty: number,
    makeAt: (pos: Vec3, index: number) => Part,
): Part[] {
    if (spec.parts.length === 0) {
        return Array.from({ length: qty }, (_, i) => makeAt([i * half[0] * 2, half[1], 0], i));
    }

    const assembly = spec.parts.map((p) => worldBox(spec, p)).reduce(union);
    const centreX = (assembly.min[0] + assembly.max[0]) / 2;
    const centreZ = (assembly.min[2] + assembly.max[2]) / 2;

    return Array.from({ length: qty }, (_, i) =>
        // Side by side along Z, each touching the next, all resting on the assembly.
        makeAt([centreX, assembly.max[1] + half[1], centreZ + i * half[2] * 2], i),
    );
}

/** World half-extents of a blank at a given rotation. */
function halfExtents(l: number, w: number, thickness: number, rot: Vec3): Vec3 {
    const box = new THREE.Box3(
        new THREE.Vector3(-l / 2, -w / 2, -thickness / 2),
        new THREE.Vector3(l / 2, w / 2, thickness / 2),
    );
    const [rx, ry, rz] = rot;
    box.applyMatrix4(
        new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'XYZ'),
        ),
    );

    return [(box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2, (box.max.z - box.min.z) / 2];
}

function worldBox(spec: Spec, part: Part): AABB {
    const material = spec.materials.find((m) => m.id === part.materialId);
    return aabbFromPart(part, material?.thickness ?? 0);
}

function union(a: AABB, b: AABB): AABB {
    return {
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    };
}

function footprint(box: AABB): number {
    return (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]);
}
