/**
 * Eased edges — the router pass that takes the sharpness off an arris (§3.1, spec 1.10).
 *
 * Pure math, no three.js: an `ease` op becomes a list of (depth from the face, inset from the
 * edge) samples describing the profile the bit leaves behind. `partGeometry` lofts those samples
 * through the thickness; the linter uses the same bounds. Nothing here touches the blank — an
 * ease only removes material along the thickness, so `part.size` and the cut list are unaffected.
 *
 * Local frame per §3.1: length = +X, width = +Y, thickness = +Z, origin at centre. An edge's
 * *arris* is where the edge meets a face: the `front` arris is the +Z one, `back` the −Z one.
 */
import type { Op } from '../spec/types';
import { DEFAULT_EASE_CONFIG, type EaseConfig } from './config';

export type EaseOp = Extract<Op, { type: 'ease' }>;

export type Edge = EaseOp['edge'];

/** One point on the profile the bit cuts, in the plane perpendicular to the edge. */
export interface EaseSample {
    /** Distance from the eased face into the thickness (0 at the face). */
    depth: number;
    /** How far the edge is pulled back at that depth (equals the size at the face, 0 where it ends). */
    inset: number;
}

/**
 * One router pass on one arris: the profile the bit cuts, and the stretch of edge it runs.
 * `from`/`to` are on the stopped-dado datum (§3.1) — measured from the low perpendicular edge,
 * w0 for l-edges and l0 for w-edges. `runOut` is the taper at each stopped end; an end that
 * reaches the edge's own end has none, because there the bit simply leaves the wood.
 */
export interface EaseCut {
    profile: EaseSample[];
    from: number;
    to: number;
    runOut: number;
    /** True when that end of the run is the edge's own end (no taper there). */
    openFrom: boolean;
    openTo: boolean;
}

/** The two arrises of one edge, each with the passes cut on it (an empty list = left sharp). */
export interface EdgeEase {
    front: EaseCut[];
    back: EaseCut[];
}

/** How much thickness the profile consumes: the radius of a roundover, the leg of a chamfer. */
export function easeSize(op: EaseOp, thickness: number): number {
    if (op.profile === 'bullnose') {
        return thickness / 2;
    }

    return op.profile === 'roundover' ? op.radius : op.width;
}

/** Which arrises the op cuts. A bullnose is both by definition — the two halves of one half-round. */
export function easeFaces(op: EaseOp): ('front' | 'back')[] {
    if (op.profile === 'bullnose' || op.face === undefined) {
        return ['front', 'back'];
    }

    return [op.face];
}

/**
 * The most an ease may take out of the thickness: a profile cutting from both faces gets half
 * each (two of them meeting in the middle is a bullnose, and anything past that has eaten the
 * board), a single-face profile may run the whole way. The linter errors past this; the geometry
 * clamps to it so a bad number can never fold the mesh inside out.
 */
export function maxEaseSize(op: EaseOp, thickness: number): number {
    return easeFaces(op).length === 2 ? thickness / 2 : thickness;
}

/**
 * Samples one arris' profile from the face inward. A chamfer is the two endpoints of its 45°
 * leg; a roundover walks the quarter-circle by angle (not by depth), which keeps the facets even
 * where the arc turns fastest. Both start at the face — inset = size, depth = 0 — and finish
 * tangent to the edge, where the profile rejoins the part's original side.
 */
export function easeProfile(
    op: EaseOp,
    thickness: number,
    config: EaseConfig = DEFAULT_EASE_CONFIG,
): EaseSample[] {
    const size = Math.min(easeSize(op, thickness), maxEaseSize(op, thickness));
    if (size <= 0) {
        return [];
    }

    if (op.profile === 'chamfer') {
        return [
            { depth: 0, inset: size },
            { depth: size, inset: 0 },
        ];
    }

    // Quarter-circle centred `size` in from both the face and the edge: at angle 0 the profile
    // is tangent to the side (full depth, no inset), at 90° tangent to the face (no depth, full
    // inset). Walking φ down from 90° keeps the samples ordered face-first.
    const segments = Math.max(1, Math.round(config.segments));
    const samples: EaseSample[] = [];
    for (let i = 0; i <= segments; i += 1) {
        const phi = (Math.PI / 2) * (1 - i / segments);
        samples.push({
            depth: size * (1 - Math.sin(phi)),
            inset: size * (1 - Math.cos(phi)),
        });
    }

    return samples;
}

/** The length of edge an ease runs along: `l` for the l-edges, `w` for the w-edges (§3.1). */
export function easeChord(edge: Edge, size: { l: number; w: number }): number {
    return edge === 'l0' || edge === 'l1' ? size.l : size.w;
}

/**
 * Collects every ease op on a part into the passes cut on each edge, by arris. Two ops easing the
 * same arris are both kept: they may run different stretches of the edge, and where they do
 * overlap the deeper one wins at each point (the linter warns — a full overlap is nearly always
 * a leftover), which is what a second router pass would actually leave.
 */
export function easesByEdge(
    ops: readonly EaseOp[],
    thickness: number,
    size: { l: number; w: number },
    config: EaseConfig = DEFAULT_EASE_CONFIG,
): Map<Edge, EdgeEase> {
    const byEdge = new Map<Edge, EdgeEase>();

    for (const op of ops) {
        const profile = easeProfile(op, thickness, config);
        if (profile.length === 0) {
            continue;
        }
        const chord = easeChord(op.edge, size);
        const from = Math.max(0, Math.min(op.from ?? 0, chord));
        const to = Math.max(from, Math.min(op.to ?? chord, chord));
        if (to - from <= 0) {
            continue;
        }
        // A stopped pass can't rise to full depth instantly: lifting a bearing-guided bit out of
        // the cut leaves a taper roughly as long as the profile is deep. Two tapers must still
        // fit inside the run, so on a very short stopped pass they meet and the profile never
        // reaches full depth — which is exactly what happens in the wood.
        const size0 = profile[0].inset;
        const cut: EaseCut = {
            profile,
            from,
            to,
            runOut: Math.min(size0 * config.runOut, (to - from) / 2),
            openFrom: from <= EPS,
            openTo: to >= chord - EPS,
        };
        const entry = byEdge.get(op.edge) ?? { front: [], back: [] };
        for (const face of easeFaces(op)) {
            entry[face] = [...entry[face], cut];
        }
        byEdge.set(op.edge, entry);
    }

    return byEdge;
}

/** Inches — runs and chords are compared at this tolerance. */
const EPS = 1e-9;

/**
 * How much of a pass's profile is present at datum position `run`: nothing outside the pass,
 * everything in the middle, and a linear taper across each stopped end's run-out. A through end
 * has no run-out, so the profile is at full depth right up to where the bit leaves the wood.
 */
export function runFactor(cut: EaseCut, run: number): number {
    if (run < cut.from - EPS || run > cut.to + EPS) {
        return 0;
    }
    if (cut.runOut <= EPS) {
        return 1;
    }
    const fromStart = cut.openFrom ? Infinity : (run - cut.from) / cut.runOut;
    const fromEnd = cut.openTo ? Infinity : (cut.to - run) / cut.runOut;

    return Math.max(0, Math.min(1, fromStart, fromEnd));
}

/** The deepest cut any pass makes at this depth and position along the edge. */
export function insetOf(cuts: readonly EaseCut[], depth: number, run: number): number {
    let inset = 0;
    for (const cut of cuts) {
        const factor = runFactor(cut, run);
        if (factor > 0) {
            inset = Math.max(inset, insetAt(cut.profile, depth) * factor);
        }
    }

    return inset;
}

/** Datum positions where the passes on an arris change — where the geometry needs a vertex. */
export function runBreakpoints(cuts: readonly EaseCut[]): number[] {
    const stops: number[] = [];
    for (const cut of cuts) {
        stops.push(cut.from, cut.to);
        if (cut.runOut > EPS) {
            if (!cut.openFrom) {
                stops.push(cut.from + cut.runOut);
            }
            if (!cut.openTo) {
                stops.push(cut.to - cut.runOut);
            }
        }
    }

    return [...stops].sort((a, b) => a - b).filter((s, i, all) => i === 0 || s - all[i - 1] > EPS);
}

/**
 * The inset a profile calls for at `depth`, linearly interpolated between its samples. Past the
 * profile's reach the answer is 0 — the wood there is untouched.
 */
export function insetAt(profile: EaseSample[], depth: number): number {
    if (profile.length === 0) {
        return 0;
    }
    const last = profile[profile.length - 1];
    if (depth >= last.depth) {
        return 0;
    }
    if (depth <= profile[0].depth) {
        return profile[0].inset;
    }

    for (let i = 1; i < profile.length; i += 1) {
        const lo = profile[i - 1];
        const hi = profile[i];
        if (depth <= hi.depth) {
            const span = hi.depth - lo.depth;
            const t = span <= 0 ? 0 : (depth - lo.depth) / span;
            return lo.inset + (hi.inset - lo.inset) * t;
        }
    }

    return 0;
}

/** Shop label for an ease, e.g. `1/4" roundover` — the bit a woodworker reaches for. */
export function easeLabel(op: EaseOp, thickness: number, format: (n: number) => string): string {
    if (op.profile === 'bullnose') {
        return 'bullnose';
    }
    const size = format(easeSize(op, thickness));

    return op.profile === 'roundover' ? `${size} roundover` : `${size} chamfer`;
}
