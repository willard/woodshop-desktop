/**
 * Tapered legs and splayed legs (D86).
 *
 * Splay is the one people get wrong, and not because the trigonometry is hard: a leg that leans in
 * two directions at once does NOT get drilled at either of those angles. It gets one resultant
 * angle, drilled along one sightline. Both are returned, and both are pinned in the spec.
 */
import type { CalcNotes } from './types';

const DEG = 180 / Math.PI;

export interface TaperInput {
    /** Leg length along its own axis, inches. */
    readonly length: number;
    readonly startWidth: number;
    readonly endWidth: number;
    /** The taper begins this far down from the top. 0 tapers the whole leg. */
    readonly startAt: number;
    /** How many faces are tapered. */
    readonly faces: 1 | 2 | 4;
}

export interface TaperResult {
    /** Material removed from each tapered face, inches. */
    readonly removalPerFace: number;
    readonly taperLength: number;
    /** Angle off the leg's axis, degrees. */
    readonly angleDeg: number;
    readonly slope: number;
    /** Offset at the far end of the blank when the sled references the leg's full length. */
    readonly jigOffset: number;
    /** Smallest square blank the leg comes out of. */
    readonly blankWidth: number;
    readonly notes: CalcNotes;
}

export function computeTaper(input: TaperInput): TaperResult | null {
    const { length, startWidth, endWidth, startAt, faces } = input;

    const taperLength = length - startAt;
    if (!(taperLength > 0) || !(startWidth > 0) || endWidth < 0 || endWidth > startWidth) {
        return null;
    }

    // Two opposite faces share the reduction; one face takes it all.
    const total = startWidth - endWidth;
    const removalPerFace = faces === 1 ? total : total / 2;
    const slope = removalPerFace / taperLength;

    const notes: string[] = [];
    if (startAt > 0) {
        notes.push('The taper starts below the joinery, so leave the top square where the rails meet it.');
    }
    if (faces === 4) {
        notes.push(
            'Tapering all four faces: re-square the blank against the fresh face after each pass, not the tapered one.',
        );
    }

    return {
        removalPerFace,
        taperLength,
        angleDeg: Math.atan(slope) * DEG,
        slope,
        jigOffset: slope * length,
        blankWidth: startWidth,
        notes,
    };
}

export interface SplayInput {
    /** Lean seen from the front, degrees. */
    readonly rakeDeg: number;
    /** Lean seen from the side, degrees. */
    readonly splayDeg: number;
    readonly legLength: number;
}

export interface SplayResult {
    /** The true lean from vertical — the angle to actually drill and to bevel the foot at. */
    readonly resultantDeg: number;
    /** Rotate the workpiece this far in plan, then drill at the resultant angle. */
    readonly sightlineDeg: number;
    readonly footSpread: { readonly x: number; readonly z: number };
    readonly footBevelDeg: number;
    readonly notes: CalcNotes;
}

export function computeSplay(input: SplayInput): SplayResult | null {
    const { rakeDeg, splayDeg, legLength } = input;
    if (![rakeDeg, splayDeg, legLength].every(Number.isFinite)) {
        return null;
    }
    if (rakeDeg < 0 || splayDeg < 0 || rakeDeg >= 90 || splayDeg >= 90 || legLength <= 0) {
        return null;
    }

    const tr = Math.tan(rakeDeg / DEG);
    const ts = Math.tan(splayDeg / DEG);
    const resultant = Math.atan(Math.sqrt(tr * tr + ts * ts));

    // atan2 keeps the pure cases honest: no rake gives a 90 degree sightline, no splay gives 0.
    const sightline = Math.atan2(ts, tr) * DEG;

    const notes: string[] = [
        'Drill at the resultant angle, along the sightline — not at the rake or the splay on their own.',
    ];
    if (rakeDeg === 0 && splayDeg === 0) {
        notes.push('No lean at all: this is a straight vertical leg.');
    }

    return {
        resultantDeg: resultant * DEG,
        sightlineDeg: sightline,
        footSpread: { x: legLength * Math.sin(rakeDeg / DEG), z: legLength * Math.sin(splayDeg / DEG) },
        // The foot is cut square to the floor, which is the same angle the leg leans.
        footBevelDeg: resultant * DEG,
        notes,
    };
}
