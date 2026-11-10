/**
 * A part's face outline: the blank reshaped by `curve` ops (dome, scallop, corner round, ramp) and
 * `notch` cutouts, as a closed contour the extruder replays. Built by the Rust core
 * (`woodshop-core::geometry::outline`) — the same contour the SVG shop template draws, so a
 * printed pattern always matches the part on screen.
 *
 * §3.1 local frame: origin at the part centre, length along +X, width along +Y.
 */
import { wasm } from '@/domain';
import type { Edge, Op } from '../../spec/types';

export type CurveOp = Extract<Op, { type: 'curve' }>;
export type NotchOp = Extract<Op, { type: 'notch' }>;

/**
 * One step of the closed contour. A `line` names the point it ends at; an `arc` carries what
 * `THREE.Path.absarc` and an SVG `A` command both need. `edge` is provenance: which named edge the
 * walk was on when it emitted this step (the eased-outline loft needs it).
 */
export type OutlineSegment = { edge?: Edge } & (
    | { kind: 'line'; x: number; y: number }
    | { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; clockwise: boolean }
);

export interface Outline {
    /** The blank the outline is cut from — unchanged by any op on it. */
    l: number;
    w: number;
    /** Closed contour in CCW walk order. The first segment is always a line, so replay can moveTo. */
    segments: OutlineSegment[];
}

/** Whether a segment is safe to hand a renderer: lines always, arcs when every number is finite. */
export function isFiniteArc(segment: OutlineSegment): boolean {
    return (
        segment.kind !== 'arc' ||
        [segment.cx, segment.cy, segment.r, segment.a0, segment.a1].every((n) => Number.isFinite(n))
    );
}

export function buildOutline(l: number, w: number, curves: CurveOp[], notches: NotchOp[] = []): Outline {
    return wasm.buildOutline(l, w, curves, notches) as Outline;
}
