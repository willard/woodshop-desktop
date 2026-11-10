/**
 * The part's boolean pass — the ONLY place a CSG library runs, and it must never run on the main
 * thread during interaction (CLAUDE.md hard rule 11): the Web Worker in ../workers/csg.worker.ts
 * wraps `subtractOps`. The functions here are pure (geometry in, geometry out) so they can be unit
 * tested directly.
 *
 * Two kinds of cutter are subtracted:
 *
 *  · Holes, which have no procedural equivalent — a bore is a boolean or it is nothing.
 *  · Channels (dado/groove/rabbet) on a SHAPED part. A rectangular part slabs its channels
 *    procedurally in `partGeometry.ts` and never comes here; a curved or notched part is extruded
 *    from its face outline as a full-thickness blank, and the channels are cut out of that blank
 *    here instead (D72 — before that the channels were dropped and the linter refused the design).
 *
 * Op semantics (build-plan §3.1): on the named face a hole's `x` is measured from edge w0 along +X,
 * `y` from edge l0 along +Y, to the bore centre; omitted depth = a through hole. Channel geometry
 * is not re-derived here — the cutter is built from `toSpanCut`, the same projection the procedural
 * slab path uses, so a dado cuts identically whichever path the part takes.
 */
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { opRunAxis, toSpanCut, type ChannelOp } from './partGeometry';

export interface HoleSpec {
    face: 'front' | 'back';
    x: number;
    y: number;
    diameter: number;
    depth?: number;
}

/** A channel op as it crosses the worker boundary — the spec op itself, structured-cloneable. */
export type ChannelSpec = ChannelOp;

export interface PartDims {
    l: number;
    w: number;
    thickness: number;
}

/** Everything to be taken out of one part's blank. */
export interface SubtractionOps {
    holes: readonly HoleSpec[];
    channels: readonly ChannelSpec[];
}

const OVERSHOOT = 0.02; // extend a cutter past the surface it breaks through, for a clean cut
const EPS = 1e-6;

/**
 * Subtracts every hole and channel from `base`, returning a new geometry. Base is left untouched;
 * with nothing to cut, `base` itself comes back.
 */
export function subtractOps(
    base: THREE.BufferGeometry,
    ops: SubtractionOps,
    dims: PartDims,
): THREE.BufferGeometry {
    const cutters: THREE.BufferGeometry[] = [];
    for (const channel of ops.channels) {
        const cutter = channelCutterGeometry(channel, dims);
        if (cutter !== null) {
            cutters.push(cutter);
        }
    }
    for (const hole of ops.holes) {
        cutters.push(holeCutterGeometry(hole, dims));
    }
    if (cutters.length === 0) {
        return base;
    }

    const evaluator = new Evaluator();
    let result = new Brush(base.clone());
    result.updateMatrixWorld();

    for (const cutter of cutters) {
        const brush = new Brush(cutter);
        brush.updateMatrixWorld();
        result = evaluator.evaluate(result, brush, SUBTRACTION);
    }
    cutters.forEach((cutter) => cutter.dispose());

    const geometry = result.geometry;
    geometry.computeVertexNormals();
    return geometry;
}

/** Drills holes only. Kept as the narrow entry point the hole suite drives. */
export function subtractHoles(
    base: THREE.BufferGeometry,
    holes: readonly HoleSpec[],
    dims: PartDims,
): THREE.BufferGeometry {
    return subtractOps(base, { holes, channels: [] }, dims);
}

/** A cylindrical drill positioned in the part's local frame (thickness along Z). */
export function holeCutterGeometry(hole: HoleSpec, dims: PartDims): THREE.BufferGeometry {
    const radius = hole.diameter / 2;
    const through = hole.depth === undefined;
    const height = (through ? dims.thickness : hole.depth!) + OVERSHOOT * 2;

    const geo = new THREE.CylinderGeometry(radius, radius, height, 24);
    geo.rotateX(Math.PI / 2); // default axis is +Y; align the drill to +Z (thickness)

    const cx = -dims.l / 2 + hole.x;
    const cy = -dims.w / 2 + hole.y;
    let cz: number;
    if (through) {
        cz = 0;
    } else if (hole.face === 'front') {
        cz = dims.thickness / 2 + OVERSHOOT - height / 2; // start just above the front, drill in
    } else {
        cz = -dims.thickness / 2 - OVERSHOOT + height / 2;
    }
    geo.translate(cx, cy, cz);
    return geo;
}

/**
 * The box a dado, groove or rabbet removes, in the part's local frame — the negative of the slab
 * decomposition, built from the same `toSpanCut` projection so the two paths agree exactly.
 *
 * The box is grown by `OVERSHOOT` on every side where the channel actually breaks out of the blank
 * (a through run's two ends, the open side of a rabbet, a cut that reaches the far face) so the
 * boolean leaves no coplanar skin behind. A stopped end is left alone: that wall is real material.
 *
 * Returns null for a channel with no depth on either face, which has nothing to cut.
 */
export function channelCutterGeometry(op: ChannelSpec, dims: PartDims): THREE.BufferGeometry | null {
    const runAxis = opRunAxis(op);
    const runLength = runAxis === 'x' ? dims.l : dims.w;
    const spanLength = runAxis === 'x' ? dims.w : dims.l;
    const cut = toSpanCut(op, spanLength, runLength);

    const t = dims.thickness;
    const fromFront = cut.frontDepth > 0;
    const depth = fromFront ? cut.frontDepth : cut.backDepth;
    if (depth <= 0) {
        return null;
    }
    // Front cut: down from just above the front face. Back cut: up from just below the back face.
    // A cut that reaches the far face breaks through, so it overshoots there too.
    const breaksThrough = depth >= t - EPS;
    const zLo = fromFront ? t / 2 - depth - (breaksThrough ? OVERSHOOT : 0) : -t / 2 - OVERSHOOT;
    const zHi = fromFront ? t / 2 + OVERSHOOT : -t / 2 + depth + (breaksThrough ? OVERSHOOT : 0);

    const spanHalf = spanLength / 2;
    const runHalf = runLength / 2;
    const spanLo = cut.lo <= -spanHalf + EPS ? cut.lo - OVERSHOOT : cut.lo;
    const spanHi = cut.hi >= spanHalf - EPS ? cut.hi + OVERSHOOT : cut.hi;
    const runLo = cut.runLo <= -runHalf + EPS ? cut.runLo - OVERSHOOT : cut.runLo;
    const runHi = cut.runHi >= runHalf - EPS ? cut.runHi + OVERSHOOT : cut.runHi;
    if (spanHi - spanLo <= EPS || runHi - runLo <= EPS) {
        return null;
    }

    const xLo = runAxis === 'x' ? runLo : spanLo;
    const xHi = runAxis === 'x' ? runHi : spanHi;
    const yLo = runAxis === 'x' ? spanLo : runLo;
    const yHi = runAxis === 'x' ? spanHi : runHi;

    const geo = new THREE.BoxGeometry(xHi - xLo, yHi - yLo, zHi - zLo);
    geo.translate((xLo + xHi) / 2, (yLo + yHi) / 2, (zLo + zHi) / 2);
    return geo;
}
