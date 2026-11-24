/**
 * Placing props (spec 1.22): things shown with a piece but not built, such as the totes on a tote
 * rack. A prop's `pos` is the middle of its bottom in world inches and `rot` turns it about the
 * vertical; these helpers work out both from the parts it sits on.
 */
import type { Part, Spec } from './types';

/** A world position, as a prop stores it. */
type Point = [number, number, number];
import { findItem, type HardwareItem } from '@/hardware/catalog';
import { toteModelOf } from '@/engine/geometry/propModels';
import { aabbFromPart, type AABB } from '@/engine/snapping';

function dim(item: HardwareItem, key: string, fallback: number): number {
    const v = item.model[key];
    return typeof v === 'number' && v > 0 ? v : fallback;
}

/** How far above its bottom the prop bears on what holds it: a tote hangs by its rim. */
export function hangHeight(item: HardwareItem | null): number {
    if (item === null || item.model.shape !== 'tote') return 0;
    const height = dim(item, 'height', 15);
    return (
        height - Math.min(dim(item, 'lid', 1.25), height / 4) - Math.min(dim(item, 'rim', 1.5), height / 4)
    );
}

/** A tote's width at the rim and just under it, where its sides come through the runners. */
export function toteWidths(item: HardwareItem): { rim: number; body: number } {
    const length = dim(item, 'length', 28.5);
    const width = dim(item, 'width', 19.6);
    const baseLength = Math.min(dim(item, 'baseLength', length * 0.85), length);
    const baseWidth = Math.min(dim(item, 'baseWidth', width * 0.8), width);
    const lip = Math.min(dim(item, 'lip', 1), (length - baseLength) / 2, (width - baseWidth) / 2);
    return { rim: width, body: width - 2 * lip };
}

function boxOf(spec: Spec, part: Part): AABB {
    const thickness = spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0.75;
    return aabbFromPart(part, thickness);
}

/** On the floor, just in front of the piece and centred on it, for something `depth` deep. */
export function besideThePiece(spec: Spec, depth: number): Point {
    if (spec.parts.length === 0) return [0, 0, 0];
    let minX = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const part of spec.parts) {
        const box = boxOf(spec, part);
        minX = Math.min(minX, box.min[0]);
        maxX = Math.max(maxX, box.max[0]);
        maxZ = Math.max(maxZ, box.max[2]);
    }
    const round = (n: number) => Math.round(n * 16) / 16;
    return [round((minX + maxX) / 2), 0, round(maxZ + depth / 2 + 2)];
}

export interface Resting {
    pos: Point;
    rot: number;
    /** What is wrong with the fit, in a sentence each; empty when it fits. */
    problems: string[];
}

/**
 * The prop resting on two parallel parts, such as a tote hung by its rim on a pair of runners:
 * centred between them, its length along them, its bearing height on their tops. `item` is null
 * for an imported model, which stands on them by its bottom. Null when the two do not run side
 * by side.
 */
export function restOn(
    spec: Spec,
    item: HardwareItem | null,
    aId: string,
    bId: string,
    /** An imported model's length and depth, to check it spans the gap. */
    footprint?: { l: number; w: number },
): Resting | null {
    const a = spec.parts.find((p) => p.id === aId);
    const b = spec.parts.find((p) => p.id === bId);
    if (a === undefined || b === undefined || a.id === b.id) return null;
    const boxA = boxOf(spec, a);
    const boxB = boxOf(spec, b);
    // The axis they run along is the longer horizontal one of the first.
    const along = boxA.max[0] - boxA.min[0] >= boxA.max[2] - boxA.min[2] ? 0 : 2;
    const across = along === 0 ? 2 : 0;
    const start = Math.max(boxA.min[along], boxB.min[along]);
    const end = Math.min(boxA.max[along], boxB.max[along]);
    if (end <= start) return null; // not side by side
    const [near, far] = boxA.min[across] <= boxB.min[across] ? [boxA, boxB] : [boxB, boxA];
    const gap = far.min[across] - near.max[across];
    if (gap <= 0) return null;
    const top = Math.min(boxA.max[1], boxB.max[1]);
    const middle = (near.max[across] + far.min[across]) / 2;
    const centre = (start + end) / 2;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const pos: Point =
        along === 0
            ? [round(centre), round(top - hangHeight(item)), round(middle)]
            : [round(middle), round(top - hangHeight(item)), round(centre)];

    const problems: string[] = [];
    const fmt = (n: number) => `${Math.round(n * 100) / 100}"`;
    if (item !== null && item.model.shape === 'tote') {
        const { rim, body } = toteWidths(item);
        const outside = far.max[across] - near.min[across];
        if (body > gap) {
            problems.push(
                `Its sides are ${fmt(body)} across under the rim, wider than the ${fmt(gap)} between the runners.`,
            );
        }
        if (rim <= gap) {
            problems.push(
                `Its rim is ${fmt(rim)} across, so it drops through the ${fmt(gap)} between the runners.`,
            );
        } else if (rim > outside) {
            problems.push(
                `Its rim is ${fmt(rim)} across, wider than the runners' outside faces (${fmt(outside)}).`,
            );
        }
        const length = dim(item, 'length', 28.5);
        if (length > end - start + 0.01) {
            problems.push(`It is ${fmt(length)} long and the runners carry it for ${fmt(end - start)}.`);
        }
    }
    if (item === null && footprint !== undefined) {
        const outside = far.max[across] - near.min[across];
        if (footprint.w <= gap) {
            problems.push(
                `It is ${fmt(footprint.w)} across, so it drops through the ${fmt(gap)} between them.`,
            );
        } else if (footprint.w > outside + 0.01) {
            problems.push(
                `It is ${fmt(footprint.w)} across, wider than their outside faces (${fmt(outside)}).`,
            );
        }
        if (footprint.l > end - start + 0.01) {
            problems.push(`It is ${fmt(footprint.l)} long and they carry it for ${fmt(end - start)}.`);
        }
    }
    if (Math.abs(boxA.max[1] - boxB.max[1]) > 1 / 32) {
        problems.push(`The two tops are ${fmt(Math.abs(boxA.max[1] - boxB.max[1]))} apart in height.`);
    }
    return { pos, rot: along === 0 ? 0 : 90, problems };
}

/**
 * What `restOn` needs to know about a prop: the catalog item it hangs like (a tote, catalog or
 * sized by hand), or else the footprint it stands on by its bottom (an imported model, a box, a
 * can or pail).
 */
export function restingAs(
    spec: Spec,
    prop: NonNullable<Spec['props']>[number],
): { item: HardwareItem | null; footprint?: { l: number; w: number } } {
    const shape = prop.shape;
    if (shape !== undefined) {
        if (shape.kind === 'tote') {
            return {
                item: {
                    id: 'shape',
                    category: 'props',
                    name: 'Tote',
                    list: 'totes',
                    prop: true,
                    model: toteModelOf(shape),
                },
            };
        }
        const across = Math.max(shape.d ?? 0, shape.top ?? 0);
        return {
            item: null,
            footprint:
                shape.kind === 'round' ? { l: across, w: across } : { l: shape.l ?? 0, w: shape.w ?? 0 },
        };
    }
    const model = (spec.models ?? []).find((m) => m.id === prop.model);
    if (model !== undefined) return { item: null, footprint: { l: model.size.l, w: model.size.w } };
    return { item: findItem(prop.item) ?? null };
}
