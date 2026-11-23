/**
 * Mirrored copies: the right side drawn from the left, the back leg from the front. A reflection
 * is not a rotation, so a part cannot simply be reflected — but a board is symmetric, so its
 * mirror image IS the same board turned over, with its cuts reflected across one of its own axes.
 *
 * Which axis: never the thickness. Rabbets and miters are cut from the front face and say so by
 * convention, so flipping front and back would move them to the wrong side. Instead the part is
 * reflected across its length or its width — whichever lies closer to the mirror's direction —
 * and its rotation is changed so the reflected board lands exactly where the mirror image is.
 * The front face stays the front face: holes drilled on the inside of the left side are on the
 * inside of the right side too.
 *
 * Pure maths, no commands: the `MirrorCopy` command applies it as one undo step.
 */
import * as THREE from 'three';
import type { Edge, HardwareMount, Op, Part, Side, Spec } from '../spec/types';
import { mountFrame } from '../hardware/catalog';
import { sideCoords } from './hardwareDrag';
import { aabbFromPart } from './snapping';

/** World axis the mirror reflects along: 0 left↔right, 1 up↔down, 2 front↔back. */
export type MirrorAxis = 0 | 1 | 2;
/** The part's own axis its cuts are reflected across: its length (`l`) or its width (`w`). */
export type Flip = 'l' | 'w';

const DEG = Math.PI / 180;

/** Rounds away floating-point dust (19 − 1.4567 = 17.543299999…) and never writes −0. */
function clean(v: number): number {
    const r = Math.round(v * 1e6) / 1e6;
    return r === 0 ? 0 : r;
}

function thicknessOf(spec: Spec, part: Part): number {
    return spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;
}

/**
 * Where the mirror stands: the middle of the whole design along `axis`, so the left side's
 * mirror image lands where the right side belongs. When the parts being mirrored straddle that
 * middle (a lone part, or a design that is all one side), their copy would land on top of them;
 * the mirror then stands just past their far side instead, 1" clear, like Duplicate.
 */
export function mirrorPlane(spec: Spec, sources: readonly Part[], axis: MirrorAxis): number {
    const extent = (parts: readonly Part[]): { min: number; max: number } => {
        let min = Infinity;
        let max = -Infinity;
        for (const part of parts) {
            const box = aabbFromPart(part, thicknessOf(spec, part));
            min = Math.min(min, box.min[axis]);
            max = Math.max(max, box.max[axis]);
        }
        return { min, max };
    };
    const all = extent(spec.parts);
    const centre = (all.min + all.max) / 2;
    const own = extent(sources);
    const eps = 1e-6;
    if (own.min < centre - eps && own.max > centre + eps) return clean(own.max + 1);
    return clean(centre);
}

/** Which of the part's own axes to reflect: the one lying closer to the mirror's direction. */
export function flipFor(part: Part, axis: MirrorAxis): Flip {
    const r = rotationOf(part);
    const e = r.elements; // column-major: column 0 is local X, column 1 local Y, in world terms
    const alongL = Math.abs(e[axis]);
    const alongW = Math.abs(e[4 + axis]);
    return alongW > alongL + 1e-9 ? 'w' : 'l';
}

function rotationOf(part: Part): THREE.Matrix4 {
    const [rx, ry, rz] = part.transform.rot ?? [0, 0, 0];
    return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, 'XYZ'));
}

/** The rotation of the mirror image: world reflection · R · local reflection (a proper rotation). */
export function mirroredRotation(part: Part, axis: MirrorAxis, flip: Flip): [number, number, number] {
    const world = new THREE.Matrix4().makeScale(
        axis === 0 ? -1 : 1,
        axis === 1 ? -1 : 1,
        axis === 2 ? -1 : 1,
    );
    const local = new THREE.Matrix4().makeScale(flip === 'l' ? -1 : 1, flip === 'w' ? -1 : 1, 1);
    const m = world.multiply(rotationOf(part)).multiply(local);
    const euler = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
    return [clean(euler.x / DEG), clean(euler.y / DEG), clean(euler.z / DEG)];
}

/** The edge a reflection across `flip` moves `edge` to: across the length the ends trade places. */
export function flipEdge<E extends Edge>(edge: E, flip: Flip): E {
    const swap: Record<Edge, Edge> =
        flip === 'l'
            ? { l0: 'l0', l1: 'l1', w0: 'w1', w1: 'w0' }
            : { l0: 'l1', l1: 'l0', w0: 'w0', w1: 'w1' };
    return swap[edge] as E;
}

/** The part dimension an edge runs along: l-edges run the length, w-edges (the ends) the width. */
function edgeRun(edge: Edge): Flip {
    return edge === 'l0' || edge === 'l1' ? 'l' : 'w';
}

/** A `from`/`to` run reflected end for end within `span`; an omitted end stays omitted. */
function flipRun<T extends { from?: number; to?: number }>(op: T, span: number): T {
    const out = { ...op };
    delete out.from;
    delete out.to;
    if (op.to !== undefined) out.from = clean(span - op.to);
    if (op.from !== undefined) out.to = clean(span - op.from);
    return out;
}

/** One cut reflected across the part's length or width. Faces never change. */
export function flipOp(op: Op, flip: Flip, size: { l: number; w: number }): Op {
    const span = flip === 'l' ? size.l : size.w;
    let out = { ...op } as Op & Record<string, unknown>;
    if ('edge' in out && typeof out.edge === 'string') {
        const edge = out.edge as Edge;
        if (edgeRun(edge) === flip) out = flipRun(out as { from?: number; to?: number }, span) as typeof out;
        out.edge = flipEdge(edge, flip);
    }
    if ('corner' in out && typeof out.corner === 'string') out.corner = flipEdge(out.corner as Edge, flip);
    if ('low' in out && typeof out.low === 'string') out.low = flipEdge(out.low as Edge, flip);
    if ('axis' in out && 'offset' in out && typeof out.offset === 'number') {
        // A channel or a row of screws: runs along `axis`, `offset` across it.
        if (out.axis === flip) out = flipRun(out as { from?: number; to?: number }, span) as typeof out;
        else out.offset = clean(span - out.offset);
    }
    if (out.type === 'hole' || out.type === 'cutout') {
        if (flip === 'l') out.x = clean(size.l - out.x);
        else out.y = clean(size.w - out.y);
    }
    return out as Op;
}

/** A part's mirror image: the part only, ready to be given a new id and name. */
export function mirrorPart(part: Part, axis: MirrorAxis, plane: number): Part {
    const flip = flipFor(part, axis);
    const pos = [...part.transform.pos] as [number, number, number];
    pos[axis] = clean(2 * plane - pos[axis]);
    const mirrored: Part = {
        ...part,
        transform: { ...part.transform, pos, rot: mirroredRotation(part, axis, flip) },
    };
    if (part.ops !== undefined) mirrored.ops = part.ops.map((op) => flipOp(op, flip, part.size));
    if (part.edgeBand !== undefined) mirrored.edgeBand = part.edgeBand.map((e) => flipEdge(e, flip));
    return mirrored;
}

const SIDE_BY_NORMAL: Record<string, Side> = {
    '0,0,1': 'front',
    '0,0,-1': 'back',
    '0,-1,0': 'l0',
    '0,1,0': 'l1',
    '-1,0,0': 'w0',
    '1,0,0': 'w1',
};

/**
 * A piece of hardware moved to the mirror image of its spot. The piece itself is not reflected
 * (a hinge has a hand, and the catalog has one of each): it keeps the quarter turn that lines its
 * long axis up with the reflected one.
 */
export function mirrorMount(mount: HardwareMount, part: Part, thickness: number, flip: Flip): HardwareMount {
    const s = (v: readonly number[]): THREE.Vector3 =>
        new THREE.Vector3(flip === 'l' ? -v[0] : v[0], flip === 'w' ? -v[1] : v[1], v[2]);
    const frame = mountFrame(part, thickness, mount);
    const normal = new THREE.Vector3(...frame.normal);
    const along = new THREE.Vector3(...frame.along);
    const turn = ((mount.rot ?? 0) * Math.PI) / 180;
    const dir = along
        .clone()
        .multiplyScalar(Math.cos(turn))
        .add(normal.clone().cross(along).multiplyScalar(Math.sin(turn)));

    const n = s(frame.normal);
    const side = SIDE_BY_NORMAL[[n.x, n.y, n.z].map((v) => Math.round(v) || 0).join(',')];
    const point = s(frame.point);
    const { x, y } = sideCoords(part.size, thickness, side, [point.x, point.y, point.z]);

    const target = s([dir.x, dir.y, dir.z]);
    const next = mountFrame(part, thickness, { side, x, y });
    const a = new THREE.Vector3(...next.along);
    const b = new THREE.Vector3(...next.normal).cross(a);
    let best: 0 | 90 | 180 | 270 = 0;
    let bestDot = -Infinity;
    for (const rot of [0, 90, 180, 270] as const) {
        const t = (rot * Math.PI) / 180;
        const d = a
            .clone()
            .multiplyScalar(Math.cos(t))
            .add(b.clone().multiplyScalar(Math.sin(t)))
            .dot(target);
        if (d > bestDot + 1e-9) {
            bestDot = d;
            best = rot;
        }
    }
    const out: HardwareMount = { ...mount, side, x: clean(x), y: clean(y) };
    if (mount.rot !== undefined || best !== 0) out.rot = best;
    return out;
}

const PAIRS: Record<MirrorAxis, [string, string][]> = {
    0: [
        ['left', 'right'],
        ['l', 'r'],
    ],
    1: [
        ['top', 'bottom'],
        ['upper', 'lower'],
    ],
    2: [
        ['front', 'back'],
        ['rear', 'front'],
    ],
};

function matchCase(word: string, like: string): string {
    if (like === like.toUpperCase() && like.length > 1) return word.toUpperCase();
    if (like[0] === like[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
}

/**
 * "Left side" → "Right side", "Front leg" → "Back leg". A name with no side in it gets
 * " (mirrored)" so the copy can be told apart. Single letters are only swapped in ids.
 */
export function mirrorName(name: string, axis: MirrorAxis): string {
    let swapped = false;
    const out = name.replace(/[A-Za-z]+/g, (word) => {
        const lower = word.toLowerCase();
        for (const [a, b] of PAIRS[axis]) {
            if (a.length === 1) continue;
            if (lower === a) {
                swapped = true;
                return matchCase(b, word);
            }
            if (lower === b) {
                swapped = true;
                return matchCase(a, word);
            }
        }
        return word;
    });
    return swapped ? out : `${name} (mirrored)`;
}

/** "p_side_l" → "p_side_r", "p_left_door" → "p_right_door"; otherwise `<id>_mirror`. */
export function mirrorIdBase(id: string, axis: MirrorAxis): string {
    let swapped = false;
    const tokens = id.split('_').map((token) => {
        for (const [a, b] of PAIRS[axis]) {
            if (token === a) {
                swapped = true;
                return b;
            }
            if (token === b) {
                swapped = true;
                return a;
            }
        }
        return token;
    });
    return swapped ? tokens.join('_') : `${id}_mirror`;
}
