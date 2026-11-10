/**
 * Contact analysis for fastening actions ("dowel to part", "screw to part"). Given two abutting
 * parts it answers the two questions every fastener asks: whose *face* lies on the joint (screws
 * and dowels go through a face), whose *edge* lies on the joint (pocket screws come out of an
 * edge), and how big the shared rectangle is. Pure — planners turn this into ops, commands apply
 * them (§3.2: joints are annotations, geometry stays authoritative).
 */
import * as THREE from 'three';
import type { Spec, Part, Edge } from '../spec/types';
import { worldAABB, localAxesWorld, TOUCH_TOL, DEG2RAD } from '../spec/geometry';

/** |dot| gate for "this local axis is the contact normal". */
const ALIGN = 0.99;

/** The shared rectangle, in the host's local face datum (§3.1: x from w0, y from l0). */
export interface ContactRect {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

export interface FaceContact {
    /** The part whose face lies on the joint — fasteners are driven through it. */
    host: Part;
    mate: Part;
    /** Which of the host's faces the mate meets (§3.1: front = +Z). */
    face: 'front' | 'back';
    rect: ContactRect;
}

export interface EdgeContact {
    /** The part whose edge lies on the joint — pocket screws exit here into the mate's face. */
    host: Part;
    mate: Part;
    edge: Edge;
    /** Extent of the contact along that edge, in the host's local datum for the edge's run. */
    from: number;
    to: number;
}

export type ContactResult<T> = T | { error: string };

export function isContactError<T>(result: ContactResult<T>): result is { error: string } {
    return (result as { error?: string }).error !== undefined;
}

interface Pair {
    a: Part;
    b: Part;
    thicknessA: number;
    thicknessB: number;
    contactAxis: number;
}

/**
 * Shared preamble: resolve both parts and the axis they meet on, or explain why they can't.
 *
 * `allowOverlap` is how far the bodies may interpenetrate and still count as a joint. Dowels pass
 * 0 — a dowelled joint is two faces meeting, and overlap means the geometry is wrong. Screws pass
 * a thickness: an overlay, a lap, and a back panel let into a rabbet all overlap by design, and a
 * screw through the overlap is exactly how they are held.
 */
function pairOf(spec: Spec, preferredId: string, mateId: string, allowOverlap = 0): ContactResult<Pair> {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const a = spec.parts.find((p) => p.id === preferredId);
    const b = spec.parts.find((p) => p.id === mateId);
    if (a === undefined || b === undefined) {
        return { error: 'Part not found.' };
    }
    const thicknessA = thicknessOf.get(a.materialId) ?? 0;
    const thicknessB = thicknessOf.get(b.materialId) ?? 0;
    const boxA = worldAABB(a, thicknessA);
    const boxB = worldAABB(b, thicknessB);

    // Contact normal = the axis carrying the largest inter-box gap (≈0 when abutting).
    const gaps = [0, 1, 2].map((i) => Math.max(boxA.min[i] - boxB.max[i], boxB.min[i] - boxA.max[i]));
    const sep = Math.max(...gaps);
    if (sep > TOUCH_TOL) {
        return { error: 'Parts must touch to fasten them.' };
    }
    if (sep < -(TOUCH_TOL + allowOverlap)) {
        return { error: 'Parts overlap — separate or notch them first.' };
    }

    // Where the parts genuinely overlap (a lap, an inset panel), the smallest overlap alone is a
    // coin toss: a leg and the apron let into it are flush through their whole thickness, so that
    // axis ties with the one the joint is actually on. Only an axis the two are *offset* along can
    // be the joint normal — separating them along an axis they share a centre line on is not a
    // direction a screw could ever travel.
    const centre = (box: typeof boxA, i: number): number => (box.min[i] + box.max[i]) / 2;
    const offsetAxes = [0, 1, 2].filter((i) => {
        const overlap = -gaps[i];
        return overlap <= 0 || Math.abs(centre(boxA, i) - centre(boxB, i)) > overlap / 2;
    });
    const axes = offsetAxes.length > 0 ? offsetAxes : [0, 1, 2];
    const contactAxis = axes.reduce((best, i) => (gaps[i] > gaps[best] ? i : best), axes[0]);

    return { a, b, thicknessA, thicknessB, contactAxis };
}

/** World-space centre of a part's box on one axis. */
function centreOn(part: Part, thickness: number, axis: number): number {
    const box = worldAABB(part, thickness);
    return (box.min[axis] + box.max[axis]) / 2;
}

/**
 * The contact rectangle projected into `host`'s local face datum. The overlap of the two boxes on
 * the in-plane axes, walked back through the host's transform so ops can be measured from w0/l0.
 */
function rectInLocalFrame(
    host: Part,
    hostThickness: number,
    mate: Part,
    mateThickness: number,
    contactAxis: number,
): ContactRect {
    const boxH = worldAABB(host, hostThickness);
    const boxM = worldAABB(mate, mateThickness);
    const inPlane = [0, 1, 2].filter((i) => i !== contactAxis);
    const lo = inPlane.map((i) => Math.max(boxH.min[i], boxM.min[i]));
    const hi = inPlane.map((i) => Math.min(boxH.max[i], boxM.max[i]));

    const towardMate = Math.sign(
        centreOn(mate, mateThickness, contactAxis) - centreOn(host, hostThickness, contactAxis),
    );
    const plane = towardMate > 0 ? boxH.max[contactAxis] : boxH.min[contactAxis];

    const [rx, ry, rz] = host.transform.rot;
    const [px, py, pz] = host.transform.pos;
    const inverse = new THREE.Matrix4()
        .compose(
            new THREE.Vector3(px, py, pz),
            new THREE.Quaternion().setFromEuler(
                new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ'),
            ),
            new THREE.Vector3(1, 1, 1),
        )
        .invert();

    let lx0 = Infinity;
    let lx1 = -Infinity;
    let ly0 = Infinity;
    let ly1 = -Infinity;
    for (const u of [lo[0], hi[0]]) {
        for (const v of [lo[1], hi[1]]) {
            const world: [number, number, number] = [0, 0, 0];
            world[contactAxis] = plane;
            world[inPlane[0]] = u;
            world[inPlane[1]] = v;
            const local = new THREE.Vector3(...world).applyMatrix4(inverse);
            lx0 = Math.min(lx0, local.x);
            lx1 = Math.max(lx1, local.x);
            ly0 = Math.min(ly0, local.y);
            ly1 = Math.max(ly1, local.y);
        }
    }
    // Hole/op datum (§3.1): x from edge w0 (−l/2) along +X, y from edge l0 (−w/2) along +Y.
    return {
        x0: Math.max(0, lx0 + host.size.l / 2),
        x1: Math.min(host.size.l, lx1 + host.size.l / 2),
        y0: Math.max(0, ly0 + host.size.w / 2),
        y1: Math.min(host.size.w, ly1 + host.size.w / 2),
    };
}

/**
 * The face-on-the-joint reading: which part can be screwed or dowelled *through*, which face of
 * it meets the mate, and the shared rectangle in its local datum. `preferredId` wins when both
 * parts present a face (a face-to-face lamination).
 */
export function faceContact(
    spec: Spec,
    preferredId: string,
    mateId: string,
    allowOverlap = 0,
): ContactResult<FaceContact> {
    const pair = pairOf(spec, preferredId, mateId, allowOverlap);
    if (isContactError(pair)) {
        return pair;
    }
    const { a, b, thicknessA, thicknessB, contactAxis } = pair;

    // Round stock can never be the host: the metal goes *through* the host, and every op is cut
    // against faces and edges a dowel does not have (part.round-ops, D60). The screw goes through
    // the mate into the dowel's end, which is how it is done in the shop anyway.
    const roundIds = new Set(spec.materials.filter((m) => m.type === 'round').map((m) => m.id));
    const isRound = (part: Part): boolean => roundIds.has(part.materialId);
    const qualifies = (part: Part): boolean =>
        !isRound(part) && Math.abs(localAxesWorld(part)[2][contactAxis]) > ALIGN;
    const host = qualifies(a) ? a : qualifies(b) ? b : null;
    if (host === null) {
        return {
            error:
                isRound(a) && isRound(b)
                    ? 'Two dowels cannot be fastened to each other — neither can carry the fastener.'
                    : 'Neither part has a face on the joint.',
        };
    }
    const mate = host === a ? b : a;
    const hostThickness = host === a ? thicknessA : thicknessB;
    const mateThickness = host === a ? thicknessB : thicknessA;

    // Which of the host's faces touches the mate (§3.1: front = local +Z).
    const towardMate = Math.sign(
        centreOn(mate, mateThickness, contactAxis) - centreOn(host, hostThickness, contactAxis),
    );
    const face: 'front' | 'back' = localAxesWorld(host)[2][contactAxis] * towardMate > 0 ? 'front' : 'back';

    return {
        host,
        mate,
        face,
        rect: rectInLocalFrame(host, hostThickness, mate, mateThickness, contactAxis),
    };
}

/**
 * The edge-on-the-joint reading: which part meets the joint with an edge (the rail against a
 * panel, the apron against a leg), which edge that is, and how far the contact runs along it —
 * the datum pocket screws are spaced on. `preferredId` wins when both parts present an edge.
 */
export function edgeContact(
    spec: Spec,
    preferredId: string,
    mateId: string,
    allowOverlap = 0,
): ContactResult<EdgeContact> {
    const pair = pairOf(spec, preferredId, mateId, allowOverlap);
    if (isContactError(pair)) {
        return pair;
    }
    const { a, b, thicknessA, thicknessB, contactAxis } = pair;

    // An edge meets the joint when the part's local length or width axis is the contact normal.
    const edgeAxisOf = (part: Part): 0 | 1 | null => {
        const axes = localAxesWorld(part);
        if (Math.abs(axes[0][contactAxis]) > ALIGN) {
            return 0;
        }
        if (Math.abs(axes[1][contactAxis]) > ALIGN) {
            return 1;
        }
        return null;
    };
    const axisA = edgeAxisOf(a);
    const axisB = edgeAxisOf(b);
    const host = axisA !== null ? a : axisB !== null ? b : null;
    if (host === null) {
        return { error: 'Neither part meets this joint with an edge — pocket screws exit an edge.' };
    }
    const localAxis = (host === a ? axisA : axisB) as 0 | 1;
    const mate = host === a ? b : a;
    const hostThickness = host === a ? thicknessA : thicknessB;
    const mateThickness = host === a ? thicknessB : thicknessA;

    const towardMate = Math.sign(
        centreOn(mate, mateThickness, contactAxis) - centreOn(host, hostThickness, contactAxis),
    );
    const outward = localAxesWorld(host)[localAxis][contactAxis] * towardMate;
    // §3.1 edges: local +X exits at w1, −X at w0; +Y at l1, −Y at l0.
    const edge: Edge = localAxis === 0 ? (outward > 0 ? 'w1' : 'w0') : outward > 0 ? 'l1' : 'l0';

    // The run along that edge is the other in-face axis of the contact rectangle.
    const rect = rectInLocalFrame(host, hostThickness, mate, mateThickness, contactAxis);
    const [from, to] = localAxis === 0 ? [rect.y0, rect.y1] : [rect.x0, rect.x1];

    return { host, mate, edge, from, to };
}
