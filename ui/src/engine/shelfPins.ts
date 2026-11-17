/**
 * Rows of holes on the 32 mm system: two columns of evenly spaced holes up the inside face of a
 * case side, one near the front edge and one near the back. They hold shelf pins for adjustable
 * shelves, or (`purpose: "hardware"`) the screws of hinge mounting plates and drawer slides, often
 * as the front column alone. They are ordinary `hole` ops with `purpose: "shelfPin"` or
 * `"hardware"`, so every export already understands them; this module plans a run,
 * finds runs in a part's cut list (so the Inspector can show one row instead of forty), and reads
 * a run back into the form that made it.
 */
import * as THREE from 'three';
import type { Op, Part, Spec } from '../spec/types';
import { aabbFromPart } from './snapping';

type Hole = Extract<Op, { type: 'hole' }>;
type Face = Hole['face'];

/** What the holes are for: shelf pins, or the screws of hinge plates and slides. */
export type RowPurpose = 'shelfPin' | 'hardware';
/** Both columns, or only the one by the low (`l0`/`w0`) or high (`l1`/`w1`) edge. */
export type RowColumns = 'both' | 'low' | 'high';

export interface ShelfPinOptions {
    face: Face;
    /** The direction the columns run: along the part's length (`l`) or its width (`w`). */
    axis: 'l' | 'w';
    /** Distance from each long edge of the run to its column of holes. */
    inset: number;
    /** First and last hole, measured along the run from its low end. */
    from: number;
    to: number;
    /** Centre-to-centre distance between holes in a column. */
    spacing: number;
    diameter: number;
    depth: number;
    /** Defaults to shelf pins. */
    purpose?: RowPurpose;
    /** Defaults to both columns. */
    columns?: RowColumns;
}

/** 32 mm system: 5 mm holes on 32 mm centres, 37 mm in from the edge. */
export const SHELF_PIN_DEFAULTS = {
    spacing: 32 / 25.4,
    inset: 37 / 25.4,
    diameter: 5 / 25.4,
    depth: 0.375,
    /** How far the first and last holes stay from the ends of the run. */
    endMargin: 6,
} as const;

const EPS = 1e-6;
/** The spec's limit on cuts per part (`ops.maxItems`). */
const MAX_OPS = 100;
const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Holes in a run: `from`, `from + spacing`, … up to `to`, in two columns. */
export function planShelfPins(part: Part, o: ShelfPinOptions): Hole[] {
    const span = o.axis === 'l' ? part.size.w : part.size.l;
    const count = Math.floor((o.to - o.from) / o.spacing + EPS) + 1;
    if (count < 1 || o.spacing <= 0) return [];
    const columns = o.columns ?? 'both';
    const across =
        columns === 'low'
            ? [o.inset]
            : columns === 'high'
              ? [span - o.inset]
              : o.inset * 2 < span - EPS
                ? [o.inset, span - o.inset]
                : [span / 2];
    const holes: Hole[] = [];
    for (const c of across) {
        for (let i = 0; i < count; i++) {
            const along = round(o.from + i * o.spacing);
            const [x, y] = o.axis === 'l' ? [along, round(c)] : [round(c), along];
            holes.push({
                type: 'hole',
                face: o.face,
                x,
                y,
                diameter: o.diameter,
                depth: o.depth,
                purpose: o.purpose ?? 'shelfPin',
            });
        }
    }
    return holes;
}

/** Why a run can't be drilled, or null when it can. */
export function shelfPinProblem(
    part: Part,
    thickness: number,
    o: ShelfPinOptions,
    /** Holes of an existing run these replace, so they don't count twice. */
    replacing = 0,
): string | null {
    const run = o.axis === 'l' ? part.size.l : part.size.w;
    const span = o.axis === 'l' ? part.size.w : part.size.l;
    if (o.spacing <= 0) return 'Spacing must be more than zero.';
    if (o.from > o.to) return 'The first hole must come before the last.';
    if (o.from - o.diameter / 2 < -EPS || o.to + o.diameter / 2 > run + EPS)
        return 'The holes run off the end of the part.';
    if (o.inset - o.diameter / 2 < -EPS || o.inset + o.diameter / 2 > span + EPS)
        return 'The inset puts the holes off the edge of the part.';
    if (o.depth >= thickness - EPS) return 'The holes would go right through; make them shallower.';
    const total = part.ops.length - replacing + planShelfPins(part, o).length;
    if (total > MAX_OPS)
        return `A part holds at most ${MAX_OPS} cuts and holes; space the holes wider or shorten the run.`;
    return null;
}

/**
 * Sensible starting values for a part: up its longer side (or `axis`), 37 mm in from each edge,
 * centred with about 6" clear at each end. `step` rounds the first hole to a tidy mark (1/16" or
 * 1 mm); `to` is then a limit the last hole stops at or before.
 */
export function defaultShelfPins(
    part: Part,
    thickness: number,
    opts: { axis?: 'l' | 'w'; face?: Face; diameter?: number; step?: number } = {},
): ShelfPinOptions {
    const axis = opts.axis ?? (part.size.l >= part.size.w ? 'l' : 'w');
    const run = axis === 'l' ? part.size.l : part.size.w;
    const d = SHELF_PIN_DEFAULTS;
    const step = opts.step ?? 1 / 16;
    const margin = Math.min(d.endMargin, run / 4);
    const count = Math.max(1, Math.floor((run - 2 * margin) / d.spacing + EPS) + 1);
    const from = round(Math.round((run - (count - 1) * d.spacing) / 2 / step) * step);
    return {
        face: opts.face ?? 'front',
        axis,
        inset: d.inset,
        from,
        to: round(run - from),
        spacing: d.spacing,
        diameter: opts.diameter ?? d.diameter,
        depth: round(Math.min(d.depth, thickness * 0.6)),
    };
}

/** A run of consecutive shelf-pin holes in a part's ops: `[start, start + count)`. */
export interface ShelfPinRun {
    start: number;
    count: number;
}

const sameKind = (a: Hole, b: Hole) =>
    a.face === b.face && a.diameter === b.diameter && a.depth === b.depth && a.purpose === b.purpose;
const isPin = (op: Op | undefined): op is Hole =>
    op?.type === 'hole' && (op.purpose === 'shelfPin' || op.purpose === 'hardware');

/**
 * Runs of three or more matching shelf-pin or hardware holes in a row, which the Inspector shows
 * as one line. A pair of hinge-plate screw holes stays two holes.
 */
export function shelfPinRuns(ops: readonly Op[]): ShelfPinRun[] {
    const runs: ShelfPinRun[] = [];
    let i = 0;
    while (i < ops.length) {
        const first = ops[i];
        if (!isPin(first)) {
            i++;
            continue;
        }
        let j = i + 1;
        while (j < ops.length && isPin(ops[j]) && sameKind(first, ops[j] as Hole)) j++;
        if (j - i >= 3) runs.push({ start: i, count: j - i });
        i = j;
    }
    return runs;
}

/** The options that would make this run, so it can be edited in the same form. */
export function readShelfPins(part: Part, holes: readonly Hole[]): ShelfPinOptions | null {
    if (holes.length === 0) return null;
    const xs = [...new Set(holes.map((h) => h.x))].sort((a, b) => a - b);
    const ys = [...new Set(holes.map((h) => h.y))].sort((a, b) => a - b);
    // The columns are the coordinate with fewer distinct values.
    const axis: 'l' | 'w' = ys.length <= xs.length ? 'l' : 'w';
    const along = axis === 'l' ? xs : ys;
    const across = axis === 'l' ? ys : xs;
    const span = axis === 'l' ? part.size.w : part.size.l;
    const first = holes[0];
    const single = across.length === 1 && Math.abs(across[0] - span / 2) > EPS;
    const columns: RowColumns = !single ? 'both' : across[0] < span / 2 ? 'low' : 'high';
    return {
        face: first.face,
        axis,
        inset:
            across.length > 1
                ? round(Math.min(across[0], span - across[across.length - 1]))
                : columns === 'high'
                  ? round(span - across[0])
                  : round(across[0]),
        from: along[0],
        to: along[along.length - 1],
        spacing: along.length > 1 ? round(along[1] - along[0]) : SHELF_PIN_DEFAULTS.spacing,
        diameter: first.diameter,
        depth: first.depth ?? SHELF_PIN_DEFAULTS.depth,
        purpose: first.purpose === 'hardware' ? 'hardware' : 'shelfPin',
        columns,
    };
}

/**
 * The column nearer the front of the piece (world +Z) for a run along `axis`, where hinge plates
 * and slides screw on; null when neither long edge of the run faces the front.
 */
export function frontColumn(part: Part, axis: 'l' | 'w'): 'low' | 'high' | null {
    const [rx, ry, rz] = part.transform.rot;
    const d = Math.PI / 180;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * d, ry * d, rz * d, 'XYZ'));
    // Across the run is local Y for a run along the length, local X for one across the width.
    const across = (axis === 'l' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).applyQuaternion(
        q,
    );
    if (Math.abs(across.z) < 0.5) return null;
    return across.z > 0 ? 'high' : 'low';
}

/**
 * Which way to drill: the face that looks toward the middle of the assembly, and the local axis
 * that runs most nearly upright. For a case side that is the inside face, up the height.
 */
export function shelfPinFacing(
    part: Part,
    assemblyCentre: readonly number[],
): { face: Face; axis: 'l' | 'w' } {
    const [rx, ry, rz] = part.transform.rot;
    const d = Math.PI / 180;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * d, ry * d, rz * d, 'XYZ'));
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const [px, py, pz] = part.transform.pos;
    const toCentre = new THREE.Vector3(
        assemblyCentre[0] - px,
        assemblyCentre[1] - py,
        assemblyCentre[2] - pz,
    );
    const face: Face = toCentre.lengthSq() < EPS || normal.dot(toCentre) >= 0 ? 'front' : 'back';
    const up = new THREE.Vector3(0, 1, 0);
    const lUp = Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(q).dot(up));
    const wUp = Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(q).dot(up));
    const axis = Math.abs(lUp - wUp) < 0.1 ? (part.size.l >= part.size.w ? 'l' : 'w') : lUp > wUp ? 'l' : 'w';
    return { face, axis };
}

/** `shelfPinFacing` toward the centre of the whole design. */
export function shelfPinFacingIn(spec: Spec, part: Part): { face: Face; axis: 'l' | 'w' } {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const q of spec.parts) {
        const t = spec.materials.find((m) => m.id === q.materialId)?.thickness ?? 0;
        const box = aabbFromPart(q, t);
        for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], box.min[a]);
            max[a] = Math.max(max[a], box.max[a]);
        }
    }
    return shelfPinFacing(
        part,
        [0, 1, 2].map((a) => (min[a] + max[a]) / 2),
    );
}
