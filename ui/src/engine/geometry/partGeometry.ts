/**
 * Procedural part geometry — dado / groove / rabbet as notch geometry, NO boolean library
 * (CLAUDE.md §2, hard rule 11). A full-width channel splits the part into box segments along
 * its run axis; each segment keeps full thickness except where a channel reduces it. Merging
 * those boxes yields the grooved solid deterministically and fast (safe on the main thread).
 *
 * Op semantics follow build-plan §3.1 verbatim: length = +X, width = +Y, thickness = +Z,
 * origin at centre; face front = +Z, back = −Z; dado `axis` is the run direction; `offset` is
 * the channel centreline from the low edge (l0 at y=−w/2 for axis "l"; w0 at x=−l/2 for "w").
 * Rabbets cut from the front face along the named edge. Holes/pocketHoles/miter are handled
 * elsewhere (holes via the CSG worker); this builder ignores them and renders the base solid.
 *
 * A SHAPED part (curve or notch) comes off its face outline instead of the slab decomposition:
 * extruded through the thickness, or lofted layer by layer when it also carries an ease (D73). Its
 * channels are then cut out of that blank by the CSG worker (D72) — the one exception to "no
 * booleans", and still off the main thread. The slab decomposition below is what every rectangular
 * part gets.
 */
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Part, Op } from '../../spec/types';
import { easesByEdge, insetOf, runBreakpoints, type EaseOp, type EdgeEase, type Edge } from '../ease';
import {
    buildOutline,
    isFiniteArc,
    type CurveOp,
    type NotchOp,
    type Outline,
    type OutlineSegment,
} from './partOutline';

const EPS = 1e-6;

/**
 * Below this angle between neighbouring facets the shading is smoothed. A roundover's facets sit
 * 15° apart (90° over six segments) and read as round; a chamfer's 45° shoulders stay crisp, as
 * does every 90° box corner.
 */
const CREASE_ANGLE = (30 * Math.PI) / 180;

type RunAxis = 'x' | 'y';

/**
 * A channel projected onto the span axis: [lo, hi] with how deep it cuts from each face.
 * [runLo, runHi] is the extent along the run axis — full length for a through channel,
 * shorter for a stopped dado (§3.1 `from`/`to`).
 */
export interface SpanCut {
    lo: number;
    hi: number;
    frontDepth: number;
    backDepth: number;
    runLo: number;
    runHi: number;
}

export type ChannelOp = Extract<Op, { type: 'dado' | 'groove' | 'rabbet' }>;

export function isChannel(op: Op): op is ChannelOp {
    return op.type === 'dado' || op.type === 'groove' || op.type === 'rabbet';
}

/** Run axis of a single op: dado/groove use `axis`; rabbets follow their edge. */
export function opRunAxis(op: ChannelOp): RunAxis {
    if (op.type === 'rabbet') {
        return op.edge === 'l0' || op.edge === 'l1' ? 'x' : 'y';
    }
    return op.axis === 'l' ? 'x' : 'y';
}

/** Picks the dominant run axis when a part mixes them (rare; fixtures are single-axis). */
function dominantAxis(ops: ChannelOp[]): RunAxis {
    let x = 0;
    for (const op of ops) {
        if (opRunAxis(op) === 'x') {
            x += 1;
        }
    }
    return x >= ops.length - x ? 'x' : 'y';
}

export interface PartSlabs {
    runAxis: RunAxis;
    /** Length of the part along the run axis. */
    runLength: number;
    slabs: Segment[];
}

/**
 * Pure decomposition of a part into box slabs (no Three.js geometry). Returns null when the
 * part has no channel ops (a plain box). Exposed for unit testing the joinery math.
 *
 * Through channels only split the span axis; a stopped channel (`from`/`to`) also splits the
 * run axis, so the groove ends inside the part instead of exiting the edge.
 */
export function partSlabs(part: Part, thickness: number): PartSlabs | null {
    const channels = (part.ops ?? []).filter(isChannel);
    if (channels.length === 0) {
        return null;
    }
    const runAxis = dominantAxis(channels);
    const runLength = runAxis === 'x' ? part.size.l : part.size.w;
    const spanLength = runAxis === 'x' ? part.size.w : part.size.l;

    const cuts = channels
        .filter((op) => opRunAxis(op) === runAxis)
        .map((op) => toSpanCut(op, spanLength, runLength));

    // Slice the run axis at every stopped-channel boundary (ends collapse to one full segment
    // when all channels run through), then span-slice each run segment with its active cuts.
    const runHalf = runLength / 2;
    const runBounds = new Set<number>([-runHalf, runHalf]);
    for (const cut of cuts) {
        runBounds.add(clamp(cut.runLo, -runHalf, runHalf));
        runBounds.add(clamp(cut.runHi, -runHalf, runHalf));
    }
    const sortedRun = [...runBounds].sort((a, b) => a - b);

    const slabs: Segment[] = [];
    for (let i = 0; i < sortedRun.length - 1; i += 1) {
        const runLo = sortedRun[i];
        const runHi = sortedRun[i + 1];
        if (runHi - runLo < EPS) {
            continue;
        }
        const runMid = (runLo + runHi) / 2;
        const active = cuts.filter((c) => runMid > c.runLo + EPS && runMid < c.runHi - EPS);
        for (const seg of sliceSegments(spanLength, thickness, active)) {
            slabs.push({ ...seg, runLo, runHi });
        }
    }

    return { runAxis, runLength, slabs };
}

type MiterOp = Extract<Op, { type: 'miter' }>;

/**
 * Face outline in the local XY frame as a `THREE.Shape` — a replay of what `buildOutline` returns.
 *
 * The outline math itself lives in `./partOutline`, free of three.js, so the same contour can be
 * extruded here, drawn as an SVG shop template, and mirrored in PHP. Kept exported under its
 * original name because the geometry suites drive the shape through it.
 */
export function buildFaceOutline(
    l: number,
    w: number,
    curves: CurveOp[],
    notches: NotchOp[] = [],
): THREE.Shape {
    const shape = new THREE.Shape();
    let started = false;

    for (const segment of buildOutline(l, w, curves, notches).segments) {
        // A non-finite arc would sample into NaN vertices and take the whole part out of the scene.
        // buildOutline already refuses to emit one; this is the boundary that keeps it that way.
        if (segment.kind === 'line' || !isFiniteArc(segment)) {
            const [x, y] =
                segment.kind === 'line'
                    ? [segment.x, segment.y]
                    : [
                          segment.cx + segment.r * Math.cos(segment.a1),
                          segment.cy + segment.r * Math.sin(segment.a1),
                      ];
            if (started) {
                shape.lineTo(x, y);
            } else {
                shape.moveTo(x, y);
                started = true;
            }
            continue;
        }
        // absarc line-tos the arc's start itself, so an arc may follow a line directly.
        shape.absarc(segment.cx, segment.cy, segment.r, segment.a0, segment.a1, segment.clockwise);
        started = true;
    }

    shape.closePath();

    return shape;
}

/**
 * Builds the part solid: a plain box or the grooved slab merge, then any miter bevels applied
 * as a vertex taper (no CSG). Because the miter transform is a pure function of position, all
 * coincident vertices move together and the mesh stays closed.
 *
 * Eased edges (spec 1.10) are cut in the box builder, so the crease pass runs last — after the
 * miters, whose `computeVertexNormals` would otherwise flatten a roundover back into facets.
 */
export function buildPartGeometry(part: Part, thickness: number, round = false): THREE.BufferGeometry {
    if (round) {
        return buildRoundGeometry(part, thickness);
    }
    const geometry = buildBase(part, thickness);
    const miters = (part.ops ?? []).filter((op): op is MiterOp => op.type === 'miter');
    if (miters.length > 0) {
        applyMiters(geometry, miters, part.size.l, part.size.w, thickness);
    }
    if (activeEases(part).length > 0) {
        const creased = toCreasedNormals(geometry, CREASE_ANGLE);
        geometry.dispose();
        return creased;
    }
    return geometry;
}

/**
 * Round stock: a dowel lying along its own length (D60). §3.1 puts length on local +X, while
 * three.js builds a cylinder up +Y, so it is turned a quarter and left there. The radius is half
 * the material's thickness, which for round stock IS the diameter — no ops to apply, because the
 * linter refuses them on a blank with no faces or edges (`part.round-ops`).
 */
function buildRoundGeometry(part: Part, diameter: number): THREE.BufferGeometry {
    const radius = diameter / 2;
    const geometry = new THREE.CylinderGeometry(radius, radius, part.size.l, ROUND_SEGMENTS);
    geometry.rotateZ(Math.PI / 2);

    return toCreasedNormals(geometry, CREASE_ANGLE);
}

/** Facets around a dowel. At 24 the silhouette reads round at furniture scale and stays cheap. */
const ROUND_SEGMENTS = 24;

/**
 * The ease ops this part actually renders (§3.1 composition, D57). A shaped part used to drop them
 * all — the extrude path has no thickness profile to loft — but since D73 it is lofted from its own
 * contour instead and the router pass follows the shape (a domed headboard top can be rounded
 * over). What still drops an ease is a miter on the same edge: it re-cuts the very arris the bit
 * would have softened, and the linter says so (`op.ease-miter-edge`).
 */
function activeEases(part: Part): EaseOp[] {
    const ops = part.ops ?? [];
    const mitered = new Set(ops.filter((op) => op.type === 'miter').map((op) => op.edge));

    return ops.filter((op): op is EaseOp => op.type === 'ease' && !mitered.has(op.edge));
}

function buildBase(part: Part, thickness: number): THREE.BufferGeometry {
    const curves = (part.ops ?? []).filter((op): op is CurveOp => op.type === 'curve');
    const notches = (part.ops ?? []).filter((op): op is NotchOp => op.type === 'notch');
    if (curves.length > 0 || notches.length > 0) {
        // Curved/notched parts are built from their face outline at full thickness. Channel ops on
        // the same part are NOT dropped (D72, which retired the v1 limitation of D34) — merging the
        // slab decomposition with a shaped outline is still a separate project, so the channels are
        // subtracted from this blank by the CSG worker (`./subtract`, hard rule 11) once the mesh
        // is in the scene.
        const curveSegments = Math.min(64, Math.max(16, Math.ceil(Math.max(part.size.l, part.size.w) / 0.5)));
        const shapedEases = easesByEdge(activeEases(part), thickness, part.size);
        if (shapedEases.size > 0) {
            // An eased shaped part is lofted from its own contour (D73) rather than extruded: the
            // same outline, but each layer through the thickness is pulled in by the profile.
            return easedOutlineGeometry(
                buildOutline(part.size.l, part.size.w, curves, notches),
                thickness,
                shapedEases,
                curveSegments,
            );
        }
        const shape = buildFaceOutline(part.size.l, part.size.w, curves, notches);
        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: false,
            curveSegments,
        });
        geometry.translate(0, 0, -thickness / 2);
        return geometry;
    }
    // Eased edges (1.10) are a profile through the thickness, so they are cut by the box builder
    // — one box for a plain part, one per slab for a channelled one. A slab only carries the
    // arris where it still reaches the blank's edge and face: a rabbet along an eased edge has
    // already taken that arris away, and the geometry follows without a special case.
    const eases = easesByEdge(activeEases(part), thickness, part.size);
    const blank = { l: part.size.l, w: part.size.w, t: thickness };

    const decomposition = partSlabs(part, thickness);
    if (decomposition === null) {
        if (eases.size === 0) {
            return new THREE.BoxGeometry(part.size.l, part.size.w, thickness);
        }
        return easedBoxGeometry(
            {
                x0: -blank.l / 2,
                x1: blank.l / 2,
                y0: -blank.w / 2,
                y1: blank.w / 2,
                z0: -thickness / 2,
                z1: thickness / 2,
            },
            eases,
            blank,
        );
    }
    const { runAxis, slabs } = decomposition;

    const boxes = slabs.map((seg) => {
        const runSize = seg.runHi - seg.runLo;
        if (eases.size > 0) {
            const bounds: BoxBounds =
                runAxis === 'x'
                    ? { x0: seg.runLo, x1: seg.runHi, y0: seg.lo, y1: seg.hi, z0: seg.zBottom, z1: seg.zTop }
                    : { x0: seg.lo, x1: seg.hi, y0: seg.runLo, y1: seg.runHi, z0: seg.zBottom, z1: seg.zTop };
            return easedBoxGeometry(bounds, eases, blank);
        }
        const geo =
            runAxis === 'x'
                ? new THREE.BoxGeometry(runSize, seg.hi - seg.lo, seg.zTop - seg.zBottom)
                : new THREE.BoxGeometry(seg.hi - seg.lo, runSize, seg.zTop - seg.zBottom);
        const runMid = (seg.runLo + seg.runHi) / 2;
        const spanMid = (seg.lo + seg.hi) / 2;
        const zMid = (seg.zTop + seg.zBottom) / 2;
        geo.translate(runAxis === 'x' ? runMid : spanMid, runAxis === 'x' ? spanMid : runMid, zMid);
        return geo;
    });

    const merged = mergeGeometries(boxes, false);
    boxes.forEach((b) => b.dispose());
    return merged ?? new THREE.BoxGeometry(part.size.l, part.size.w, thickness);
}

/**
 * A shaped part (curve/notch) with eased edges, lofted from its own contour (D73).
 *
 * `easedBoxGeometry` below does exactly this for a rectangle: slice the solid into layers through
 * the thickness and pull each eased side in by the profile's inset at that depth. The only thing a
 * shaped part changes is the outline being lofted — a dome, a scallop, a notch detour instead of
 * four straight sides — so the same idea generalises, with two differences:
 *
 *  · The contour is sampled into a polyline, and each run carries the EDGE that emitted it
 *    (`OutlineSegment.edge`). A dome IS its edge, so which run a router pass belongs to is
 *    provenance from the outline walk, never geometry — the arc's ends point sideways.
 *  · A vertex is moved to where its two adjacent offset runs meet, which is what makes a corner
 *    between two eased edges come out as the intersection of both cuts, exactly as the box path's
 *    corners do — and lets a vertex whose neighbours are eased differently slide along the run
 *    that was not cut.
 *
 * Still no boolean (hard rule 11): the ease is a loft, before and after.
 */
function easedOutlineGeometry(
    outline: Outline,
    thickness: number,
    eases: Map<Edge, EdgeEase>,
    curveSegments: number,
): THREE.BufferGeometry {
    const blank: Blank = { l: outline.l, w: outline.w, t: thickness };
    const z0 = -thickness / 2;
    const z1 = thickness / 2;

    const { points, runInto } = sampleOutline(outline, curveSegments, eases);
    if (points.length < 3) {
        return new THREE.BoxGeometry(outline.l, outline.w, thickness);
    }

    // Layer at every depth a profile turns at, plus the two faces — the box path's `zs`.
    const zs = [z0, z1];
    for (const edgeEase of eases.values()) {
        for (const cut of edgeEase.front) {
            for (const sample of cut.profile) {
                zs.push(z1 - sample.depth);
            }
        }
        for (const cut of edgeEase.back) {
            for (const sample of cut.profile) {
                zs.push(z0 + sample.depth);
            }
        }
    }
    const layers = zs
        .filter((z) => z >= z0 - EPS && z <= z1 + EPS)
        .sort((p, q) => p - q)
        .filter((z, i, all) => i === 0 || z - all[i - 1] > EPS);

    /** Datum coordinate of a point along `edge` (§3.1): l-edges measure from w0, w-edges from l0. */
    const datumOn = (edge: Edge, p: [number, number]): number =>
        edge === 'l0' || edge === 'l1' ? p[0] + blank.l / 2 : p[1] + blank.w / 2;

    /** How far the run tagged `edge` is cut back at layer `z`, at the point `p` along it. */
    const insetOn = (edge: Edge, z: number, p: [number, number]): number => {
        const edgeEase = eases.get(edge);
        if (edgeEase === undefined) {
            return 0;
        }
        const run = datumOn(edge, p);

        return Math.max(insetOf(edgeEase.front, z1 - z, run), insetOf(edgeEase.back, z - z0, run));
    };

    const n = points.length;
    const normals = points.map((p, i) => inwardNormal(p, points[(i + 1) % n]));

    const outlineAt = (z: number): { p: [number, number]; edge: Edge }[] => {
        const moved: { p: [number, number]; edge: Edge }[] = [];
        for (let i = 0; i < n; i += 1) {
            const prev = (i - 1 + n) % n;
            const p = points[i];
            // The run arriving at this vertex and the one leaving it — each with its own edge, and
            // so its own inset. Equal insets and a straight run give a plain offset; a corner
            // solves for the point where both offset runs pass.
            const displacement = offsetCorner(
                normals[prev],
                insetOn(runInto[i], z, p),
                normals[i],
                insetOn(runInto[(i + 1) % n], z, p),
            );
            moved.push({
                p: [p[0] + displacement[0], p[1] + displacement[1]],
                edge: runInto[(i + 1) % n],
            });
        }

        // A profile deeper than a feature is wide would fold the contour through itself, and a
        // self-intersecting cap ear-clips into garbage that leaves the scene silently (D69). The
        // signed area is the cheap tell: keep the layer square rather than emit that.
        return signedArea(moved.map((c) => c.p)) > EPS
            ? moved
            : points.map((p, i) => ({ p, edge: runInto[(i + 1) % n] }));
    };

    const outlines = layers.map(outlineAt);
    const positions: number[] = [];
    const uvs: number[] = [];

    const capUv = (p: [number, number]): [number, number] => [
        (p[0] + blank.l / 2) / blank.l,
        (p[1] + blank.w / 2) / blank.w,
    ];
    const sideUv = (edge: Edge, p: [number, number], z: number): [number, number] => [
        datumOn(edge, p) / (edge === 'l0' || edge === 'l1' ? blank.l : blank.w),
        (z + blank.t / 2) / blank.t,
    ];

    type Vertex = { p: [number, number]; z: number; uv: [number, number] };
    const push = (v: Vertex): void => {
        positions.push(v.p[0], v.p[1], v.z);
        uvs.push(v.uv[0], v.uv[1]);
    };
    const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex): void => {
        push(a);
        push(b);
        push(c);
        push(a);
        push(c);
        push(d);
    };

    for (let i = 0; i < layers.length - 1; i += 1) {
        const lo = outlines[i];
        const hi = outlines[i + 1];
        const zLo = layers[i];
        const zHi = layers[i + 1];
        for (let k = 0; k < n; k += 1) {
            const next = (k + 1) % n;
            const edge = lo[k].edge;
            const at = (p: [number, number], z: number): Vertex => ({ p, z, uv: sideUv(edge, p, z) });
            quad(at(lo[k].p, zLo), at(lo[next].p, zLo), at(hi[next].p, zHi), at(hi[k].p, zHi));
        }
    }

    capFace(outlines[outlines.length - 1], layers[layers.length - 1], true, capUv, push);
    capFace(outlines[0], layers[0], false, capUv, push);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

/** Inward unit normal of the run `a` → `b`: left of travel, because the contour walks CCW. */
function inwardNormal(a: [number, number], b: [number, number]): [number, number] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < EPS) {
        return [0, 0];
    }

    return [-dy / len, dx / len];
}

/**
 * Where a vertex goes when the run arriving at it is cut back by `dIn` and the one leaving it by
 * `dOut`: the point whose displacement has those two components along the two inward normals — the
 * intersection of the offset runs. Two nearly parallel runs (consecutive samples of one arc) have
 * no usable intersection, so they take the plain normal offset, which for a circle is exact.
 *
 * The magnitude is capped because a near-reversal (the tip of a spike) sends the intersection off
 * to infinity, and one runaway vertex is a part that no longer looks like wood.
 */
function offsetCorner(
    nIn: [number, number],
    dIn: number,
    nOut: [number, number],
    dOut: number,
): [number, number] {
    if (dIn <= 0 && dOut <= 0) {
        return [0, 0];
    }
    const cross = nIn[0] * nOut[1] - nIn[1] * nOut[0];
    if (Math.abs(cross) < 1e-6) {
        const d = Math.max(dIn, dOut);
        const n = dOut >= dIn ? nOut : nIn;

        return [n[0] * d, n[1] * d];
    }
    const ux = (dIn * nOut[1] - dOut * nIn[1]) / cross;
    const uy = (dOut * nIn[0] - dIn * nOut[0]) / cross;

    const cap = Math.max(dIn, dOut) * 4;
    const len = Math.hypot(ux, uy);
    if (len > cap) {
        return [(ux / len) * cap, (uy / len) * cap];
    }

    return [ux, uy];
}

/** Twice the enclosed area, signed: positive for the CCW walk every outline is emitted in. */
function signedArea(polygon: [number, number][]): number {
    let sum = 0;
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        sum += a[0] * b[1] - b[0] * a[1];
    }

    return sum / 2;
}

/**
 * The outline as a closed polyline, each vertex tagged with the edge that owns the run ARRIVING at
 * it (`runInto[i]` is the run `points[i-1]` → `points[i]`). Arcs are sampled the way
 * `THREE.EllipseCurve` samples them, so the lofted silhouette matches the extruded one.
 *
 * Straight runs are also split at the datum positions where a stopped ease starts, reaches full
 * depth, falls away and ends — the box path does the same with its `interiorOf` vertices, and
 * without them a stopped pass would only step where a sample happened to land.
 */
function sampleOutline(
    outline: Outline,
    curveSegments: number,
    eases: Map<Edge, EdgeEase>,
): { points: [number, number][]; runInto: Edge[] } {
    const segments = outline.segments;
    const points: [number, number][] = [];
    const runInto: Edge[] = [];

    const stopsByEdge = new Map<Edge, number[]>();
    for (const [edge, edgeEase] of eases) {
        stopsByEdge.set(edge, runBreakpoints([...edgeEase.front, ...edgeEase.back]));
    }

    const add = (p: [number, number], edge: Edge): void => {
        const last = points[points.length - 1];
        if (last !== undefined && Math.hypot(p[0] - last[0], p[1] - last[1]) < EPS) {
            return; // a zero-length run carries no geometry; the next real run has the same tag
        }
        points.push(p);
        runInto.push(edge);
    };

    let cursor = endPointOf(segments[segments.length - 1]);
    for (const segment of segments) {
        const edge = segment.edge ?? 'l0';
        if (segment.kind === 'line') {
            const end: [number, number] = [segment.x, segment.y];
            for (const stop of runStops(cursor, end, edge, stopsByEdge.get(edge) ?? [], outline)) {
                add(stop, edge);
            }
            add(end, edge);
            cursor = end;
        } else {
            for (const p of arcPoints(segment, curveSegments)) {
                add(p, edge);
            }
            cursor = endPointOf(segment);
        }
    }

    // The walk closes on its own start; drop the duplicate so the loop has no zero-length run.
    while (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) >= EPS) {
            break;
        }
        points.pop();
        runInto.pop();
    }

    return { points, runInto };
}

function endPointOf(segment: OutlineSegment): [number, number] {
    return segment.kind === 'line'
        ? [segment.x, segment.y]
        : [segment.cx + segment.r * Math.cos(segment.a1), segment.cy + segment.r * Math.sin(segment.a1)];
}

/** Extra vertices inside a straight run, where a stopped ease on that edge changes depth. */
function runStops(
    from: [number, number],
    to: [number, number],
    edge: Edge,
    stops: number[],
    outline: Outline,
): [number, number][] {
    if (stops.length === 0) {
        return [];
    }
    const onLengthEdge = edge === 'l0' || edge === 'l1';
    const offset = onLengthEdge ? outline.l / 2 : outline.w / 2;
    const a = onLengthEdge ? from[0] : from[1];
    const b = onLengthEdge ? to[0] : to[1];
    const span = b - a;
    if (Math.abs(span) < EPS) {
        return [];
    }

    return stops
        .map((stop) => (stop - offset - a) / span)
        .filter((t) => t > EPS && t < 1 - EPS)
        .sort((p, q) => p - q)
        .map((t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t] as [number, number]);
}

/**
 * An arc sampled from its start to its end, excluding the start (the previous segment ended
 * there). The sweep is resolved the way `THREE.EllipseCurve` resolves it, because that is what the
 * extrude path draws and the two builders must not disagree about the shape of the same part.
 */
function arcPoints(segment: Extract<OutlineSegment, { kind: 'arc' }>, divisions: number): [number, number][] {
    const twoPi = Math.PI * 2;
    let delta = segment.a1 - segment.a0;
    const samePoints = Math.abs(delta) < Number.EPSILON;
    while (delta < 0) {
        delta += twoPi;
    }
    while (delta > twoPi) {
        delta -= twoPi;
    }
    if (delta < Number.EPSILON) {
        delta = samePoints ? 0 : twoPi;
    }
    if (segment.clockwise && !samePoints) {
        delta = delta === twoPi ? -twoPi : delta - twoPi;
    }

    const steps = Math.max(1, Math.round(divisions));
    const out: [number, number][] = [];
    for (let i = 1; i <= steps; i += 1) {
        const angle = segment.a0 + delta * (i / steps);
        out.push([segment.cx + segment.r * Math.cos(angle), segment.cy + segment.r * Math.sin(angle)]);
    }

    return out;
}

/** A box in the part's local frame, in absolute local coordinates (not a size + centre). */
export interface BoxBounds {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    z0: number;
    z1: number;
}

/** The blank this box came out of — what decides which of its faces are the part's own. */
interface Blank {
    l: number;
    w: number;
    t: number;
}

/** Perimeter walk of a layer rectangle, CCW seen from +Z, so every side quad faces outward. */
const SIDE_WALK: { edge: Edge; from: 0 | 1 | 2 | 3; to: 0 | 1 | 2 | 3 }[] = [
    { edge: 'l0', from: 0, to: 1 },
    { edge: 'w1', from: 1, to: 2 },
    { edge: 'l1', from: 2, to: 3 },
    { edge: 'w0', from: 3, to: 0 },
];

/**
 * A box whose arrises have been run past a router bit (spec 1.10).
 *
 * The solid is sliced into layers along the thickness, and at each layer every eased side is
 * pulled in by its profile's inset at that depth (`ease.ts`); lofting the layers gives the
 * quarter-round or bevel exactly, with no boolean (hard rule 11). Where two eased sides meet,
 * both insets apply and the corner comes out as the intersection of the two cuts — which is
 * precisely what running a bit down both edges leaves behind.
 *
 * Only arrises that are really on the blank are cut: a side that isn't at the blank's edge, or a
 * face left behind by a dado, keeps its sharp corner.
 */
export function easedBoxGeometry(
    b: BoxBounds,
    eases: Map<Edge, EdgeEase>,
    blank: Blank,
): THREE.BufferGeometry {
    const atFront = Math.abs(b.z1 - blank.t / 2) < EPS;
    const atBack = Math.abs(b.z0 + blank.t / 2) < EPS;
    const onBlankEdge: Record<Edge, boolean> = {
        w0: Math.abs(b.x0 + blank.l / 2) < EPS,
        w1: Math.abs(b.x1 - blank.l / 2) < EPS,
        l0: Math.abs(b.y0 + blank.w / 2) < EPS,
        l1: Math.abs(b.y1 - blank.w / 2) < EPS,
    };

    const passes = new Map<Edge, EdgeEase>();
    for (const { edge } of SIDE_WALK) {
        const ease = onBlankEdge[edge] ? eases.get(edge) : undefined;
        passes.set(edge, {
            front: ease !== undefined && atFront ? ease.front : [],
            back: ease !== undefined && atBack ? ease.back : [],
        });
    }

    // Layer at every depth the profiles turn at, plus the two faces.
    const zs = [b.z0, b.z1];
    for (const edgeEase of passes.values()) {
        for (const cut of edgeEase.front) {
            for (const sample of cut.profile) {
                zs.push(b.z1 - sample.depth);
            }
        }
        for (const cut of edgeEase.back) {
            for (const sample of cut.profile) {
                zs.push(b.z0 + sample.depth);
            }
        }
    }
    const layers = [...zs]
        .filter((z) => z >= b.z0 - EPS && z <= b.z1 + EPS)
        .sort((p, q) => p - q)
        .filter((z, i, all) => i === 0 || z - all[i - 1] > EPS);

    // Datum coordinate along an edge (§3.1): l-edges measure from w0 (+X), w-edges from l0 (+Y).
    const runOfX = (x: number): number => x + blank.l / 2;
    const runOfY = (y: number): number => y + blank.w / 2;

    const spanOf = (edge: Edge): number => (edge === 'w0' || edge === 'w1' ? b.x1 - b.x0 : b.y1 - b.y0);

    /** How far edge `edge` is cut back at depth-layer `z`, `run` along its length. */
    const insetAtRun = (edge: Edge, z: number, run: number): number => {
        const edgeEase = passes.get(edge)!;
        const cut = Math.max(insetOf(edgeEase.front, b.z1 - z, run), insetOf(edgeEase.back, z - b.z0, run));
        // Defensive: opposing insets must never cross (the linter errors an oversized profile).
        return Math.min(cut, spanOf(edge) * 0.49);
    };

    // The four sides, as functions of the run coordinate. A perpendicular side is evaluated at the
    // blank's nominal corner rather than the inset one: the difference is a fraction of an inset,
    // and resolving it exactly would make the two sides' positions mutually recursive.
    const xLoAt = (z: number, y: number): number => b.x0 + insetAtRun('w0', z, runOfY(y));
    const xHiAt = (z: number, y: number): number => b.x1 - insetAtRun('w1', z, runOfY(y));
    const yLoAt = (z: number, x: number): number => b.y0 + insetAtRun('l0', z, runOfX(x));
    const yHiAt = (z: number, x: number): number => b.y1 - insetAtRun('l1', z, runOfX(x));

    // Interior vertices, in world coordinates along each side's run. Computed once from the
    // nominal box so every layer's polygon has the same vertex count — the loft depends on it —
    // and clamped into each layer's own corner span at build time.
    const interiorOf = (edge: Edge): number[] => {
        const edgeEase = passes.get(edge)!;
        const stops = runBreakpoints([...edgeEase.front, ...edgeEase.back]);
        const offset = edge === 'l0' || edge === 'l1' ? blank.l / 2 : blank.w / 2;
        const lo = edge === 'l0' || edge === 'l1' ? b.x0 : b.y0;
        const hi = edge === 'l0' || edge === 'l1' ? b.x1 : b.y1;

        return stops
            .map((run) => run - offset)
            .filter((v) => v > lo + EPS && v < hi - EPS)
            .sort((p, q) => p - q);
    };
    const interior: Record<Edge, number[]> = {
        l0: interiorOf('l0'),
        w1: interiorOf('w1'),
        l1: interiorOf('l1'),
        w0: interiorOf('w0'),
    };

    /** One vertex of a layer's outline, tagged with the side it starts. */
    type Corner = { p: [number, number]; edge: Edge };

    /**
     * The layer outline at z, walked CCW seen from +Z. A through-eased box gives the four corners
     * of a rectangle; a stopped pass adds a vertex where it starts, reaches full depth, falls
     * away, and ends — so the side steps in and back out along its own length.
     */
    const outlineAt = (z: number): Corner[] => {
        const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
        const c0: [number, number] = [xLoAt(z, b.y0), yLoAt(z, b.x0)];
        const c1: [number, number] = [xHiAt(z, b.y0), yLoAt(z, b.x1)];
        const c2: [number, number] = [xHiAt(z, b.y1), yHiAt(z, b.x1)];
        const c3: [number, number] = [xLoAt(z, b.y1), yHiAt(z, b.x0)];

        const out: Corner[] = [];
        // l0: c0 → c1 along +X, riding the low-Y side.
        out.push({ p: c0, edge: 'l0' });
        for (const x of interior.l0) {
            const at = clamp(x, c0[0], c1[0]);
            out.push({ p: [at, yLoAt(z, at)], edge: 'l0' });
        }
        // w1: c1 → c2 along +Y, riding the high-X side.
        out.push({ p: c1, edge: 'w1' });
        for (const y of interior.w1) {
            const at = clamp(y, c1[1], c2[1]);
            out.push({ p: [xHiAt(z, at), at], edge: 'w1' });
        }
        // l1: c2 → c3 back along −X.
        out.push({ p: c2, edge: 'l1' });
        for (const x of [...interior.l1].reverse()) {
            const at = clamp(x, c3[0], c2[0]);
            out.push({ p: [at, yHiAt(z, at)], edge: 'l1' });
        }
        // w0: c3 → c0 back along −Y.
        out.push({ p: c3, edge: 'w0' });
        for (const y of [...interior.w0].reverse()) {
            const at = clamp(y, c0[1], c3[1]);
            out.push({ p: [xLoAt(z, at), at], edge: 'w0' });
        }

        return out;
    };

    const outlines = layers.map(outlineAt);
    const positions: number[] = [];
    const uvs: number[] = [];

    // UVs are a planar projection per face, the way BoxGeometry lays the grain out: the two faces
    // read across the blank, each side reads along its own run and up through the thickness. The
    // grain texture is a repeating streak field, so a projection is all it needs.
    const capUv = (p: [number, number]): [number, number] => [
        (p[0] + blank.l / 2) / blank.l,
        (p[1] + blank.w / 2) / blank.w,
    ];
    const sideUv = (edge: Edge, p: [number, number], z: number): [number, number] =>
        edge === 'l0' || edge === 'l1'
            ? [(p[0] + blank.l / 2) / blank.l, (z + blank.t / 2) / blank.t]
            : [(p[1] + blank.w / 2) / blank.w, (z + blank.t / 2) / blank.t];

    type Vertex = { p: [number, number]; z: number; uv: [number, number] };
    const push = (v: Vertex): void => {
        positions.push(v.p[0], v.p[1], v.z);
        uvs.push(v.uv[0], v.uv[1]);
    };
    const quad = (a: Vertex, bb: Vertex, c: Vertex, d: Vertex): void => {
        push(a);
        push(bb);
        push(c);
        push(a);
        push(c);
        push(d);
    };

    for (let i = 0; i < layers.length - 1; i += 1) {
        const lo = outlines[i];
        const hi = outlines[i + 1];
        const zLo = layers[i];
        const zHi = layers[i + 1];
        for (let k = 0; k < lo.length; k += 1) {
            const next = (k + 1) % lo.length;
            const edge = lo[k].edge;
            const at = (p: [number, number], z: number): Vertex => ({ p, z, uv: sideUv(edge, p, z) });
            quad(at(lo[k].p, zLo), at(lo[next].p, zLo), at(hi[next].p, zHi), at(hi[k].p, zHi));
        }
    }

    // Caps. A stopped ease makes these outlines non-convex (the side steps in mid-run), so they
    // go through the same ear-clipping the extrude path uses rather than a corner fan.
    capFace(outlines[outlines.length - 1], layers[layers.length - 1], true, capUv, push);
    capFace(outlines[0], layers[0], false, capUv, push);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * Triangulates one end of the loft. `front` winds CCW seen from +Z (outward normal +Z); the back
 * cap is the same outline wound the other way. Consecutive duplicate points — a run-out vertex
 * clamped onto its corner — are dropped first, because the ear clipper cannot use them.
 */
function capFace(
    outline: { p: [number, number] }[],
    z: number,
    front: boolean,
    capUv: (p: [number, number]) => [number, number],
    push: (v: { p: [number, number]; z: number; uv: [number, number] }) => void,
): void {
    const contour: THREE.Vector2[] = [];
    for (const { p } of outline) {
        const last = contour[contour.length - 1];
        if (last === undefined || Math.hypot(p[0] - last.x, p[1] - last.y) > EPS) {
            contour.push(new THREE.Vector2(p[0], p[1]));
        }
    }
    while (contour.length > 1 && contour[0].distanceTo(contour[contour.length - 1]) <= EPS) {
        contour.pop();
    }
    if (contour.length < 3) {
        return;
    }

    for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) {
        const [i, j, k] = front ? face : [face[0], face[2], face[1]];
        for (const index of [i, j, k]) {
            const v = contour[index];
            const p: [number, number] = [v.x, v.y];
            push({ p, z, uv: capUv(p) });
        }
    }
}

/**
 * Bevels the named edge(s): `angle` off square, material removed from the back-face (−Z) side
 * (§3.1). At the edge, the back recedes inward by thickness·tan(angle), the front stays put,
 * tapering linearly through the thickness.
 */
function applyMiters(
    geometry: THREE.BufferGeometry,
    miters: MiterOp[],
    l: number,
    w: number,
    t: number,
): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = position.array as Float32Array;

    for (const miter of miters) {
        const recede = t * Math.tan((miter.angle * Math.PI) / 180);
        for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i];
            const y = arr[i + 1];
            const back = (t / 2 - arr[i + 2]) / t; // 0 at the front face, 1 at the back
            if (miter.edge === 'w1' && x >= l / 2 - EPS) {
                arr[i] = x - recede * back;
            } else if (miter.edge === 'w0' && x <= -l / 2 + EPS) {
                arr[i] = x + recede * back;
            } else if (miter.edge === 'l1' && y >= w / 2 - EPS) {
                arr[i + 1] = y - recede * back;
            } else if (miter.edge === 'l0' && y <= -w / 2 + EPS) {
                arr[i + 1] = y + recede * back;
            }
        }
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();
}

/**
 * Projects a channel op onto the span axis (caller has already matched the run axis). Exported
 * because the CSG cutter for a shaped part's channel (`./subtract`) is built from the very same
 * projection — one definition of where a dado sits, whichever path renders it.
 */
export function toSpanCut(op: ChannelOp, spanLength: number, runLength: number): SpanCut {
    const low = -spanLength / 2;
    const runHalf = runLength / 2;
    if (op.type === 'rabbet') {
        // Rabbets cut from the front (§3.1). l0/w0 are the low edges; l1/w1 the high edges.
        const atLow = op.edge === 'l0' || op.edge === 'w0';
        const lo = atLow ? low : spanLength / 2 - op.width;
        const hi = atLow ? low + op.width : spanLength / 2;
        return { lo, hi, frontDepth: op.depth, backDepth: 0, runLo: -runHalf, runHi: runHalf };
    }
    const center = low + op.offset;
    const lo = center - op.width / 2;
    const hi = center + op.width / 2;
    const front = op.face === 'front';
    // Stopped channel (§3.1): `from`/`to` measured from the low run edge; omitted = through.
    const runLo = op.from !== undefined ? -runHalf + op.from : -runHalf;
    const runHi = op.to !== undefined ? -runHalf + op.to : runHalf;
    return {
        lo,
        hi,
        frontDepth: front ? op.depth : 0,
        backDepth: front ? 0 : op.depth,
        runLo,
        runHi,
    };
}

interface Segment {
    lo: number;
    hi: number;
    zTop: number;
    zBottom: number;
    /** Extent along the run axis (differs from the full run only around stopped channels). */
    runLo: number;
    runHi: number;
}

/** Splits [−span/2, span/2] at every cut boundary and sets each segment's Z extent. */
function sliceSegments(spanLength: number, t: number, cuts: SpanCut[]): Omit<Segment, 'runLo' | 'runHi'>[] {
    const half = spanLength / 2;
    const bounds = new Set<number>([-half, half]);
    for (const cut of cuts) {
        bounds.add(clamp(cut.lo, -half, half));
        bounds.add(clamp(cut.hi, -half, half));
    }
    const sorted = [...bounds].sort((a, b) => a - b);

    const segments: Omit<Segment, 'runLo' | 'runHi'>[] = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
        const lo = sorted[i];
        const hi = sorted[i + 1];
        if (hi - lo < EPS) {
            continue;
        }
        const mid = (lo + hi) / 2;
        let frontDepth = 0;
        let backDepth = 0;
        for (const cut of cuts) {
            if (mid > cut.lo + EPS && mid < cut.hi - EPS) {
                frontDepth = Math.max(frontDepth, cut.frontDepth);
                backDepth = Math.max(backDepth, cut.backDepth);
            }
        }
        const zTop = t / 2 - frontDepth;
        const zBottom = -t / 2 + backDepth;
        if (zTop - zBottom < EPS) {
            continue; // fully cut through — no material left in this slice
        }
        segments.push({ lo, hi, zTop, zBottom });
    }
    return segments;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
