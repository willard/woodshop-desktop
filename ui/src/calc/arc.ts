/**
 * Arcs and segmented rings (D86).
 *
 * An arc in a shop is almost never given as a radius — it is a chord you can measure and a rise you
 * can see. All three known-pairs are accepted and each derives the rest, so whichever two you have
 * is the way in.
 */
import type { CalcNotes } from './types';

const DEG = 180 / Math.PI;
const DEFAULT_STATIONS = 8;

export type ArcKnown =
    | { readonly kind: 'chordRise'; readonly chord: number; readonly rise: number }
    | { readonly kind: 'chordRadius'; readonly chord: number; readonly radius: number }
    | { readonly kind: 'riseRadius'; readonly rise: number; readonly radius: number };

export interface ArcResult {
    readonly radius: number;
    readonly chord: number;
    /** The sagitta: how far the arc stands off the chord at its middle. */
    readonly rise: number;
    readonly includedDeg: number;
    readonly arcLength: number;
    /** Radius minus rise — where to pin a trammel, measured from the chord. */
    readonly centreOffset: number;
    /** Offsets from the chord at evenly spaced stations, for laying the curve out by hand. */
    readonly ordinates: readonly { readonly along: number; readonly offset: number }[];
    readonly notes: CalcNotes;
}

/** Radius from a chord and its rise: R = (c²/4 + h²) / 2h. */
function radiusFromChordRise(chord: number, rise: number): number {
    return ((chord * chord) / 4 + rise * rise) / (2 * rise);
}

export function computeArc(known: ArcKnown, stations: number = DEFAULT_STATIONS): ArcResult | null {
    let radius: number;
    let chord: number;
    let rise: number;

    if (known.kind === 'chordRise') {
        ({ chord, rise } = known);
        if (!(chord > 0) || !(rise > 0)) {
            return null;
        }
        radius = radiusFromChordRise(chord, rise);
    } else if (known.kind === 'chordRadius') {
        ({ chord, radius } = known);
        if (!(chord > 0) || !(radius > 0) || chord > 2 * radius) {
            return null; // a chord cannot be longer than the diameter
        }
        rise = radius - Math.sqrt(radius * radius - (chord * chord) / 4);
    } else {
        ({ rise, radius } = known);
        if (!(rise > 0) || !(radius > 0) || rise > radius) {
            return null; // beyond the radius it is no longer a minor arc
        }
        chord = 2 * Math.sqrt(rise * (2 * radius - rise));
    }

    if (!Number.isFinite(radius) || radius <= 0) {
        return null;
    }

    const half = Math.min(1, chord / 2 / radius);
    const includedRad = 2 * Math.asin(half);

    const n = Math.max(2, Math.floor(stations));
    const ordinates = Array.from({ length: n + 1 }, (_, i) => {
        const along = (chord * i) / n;
        const x = along - chord / 2;
        const offset = Math.sqrt(Math.max(0, radius * radius - x * x)) - (radius - rise);
        return { along, offset };
    });

    const notes: string[] = [];
    if (radius > chord * 5) {
        notes.push('A radius this large is easier to strike with a bent batten than a trammel.');
    }

    return {
        radius,
        chord,
        rise,
        includedDeg: includedRad * DEG,
        arcLength: radius * includedRad,
        centreOffset: radius - rise,
        ordinates,
        notes,
    };
}

export interface SegmentedRingInput {
    readonly outerDiameter: number;
    /** Radial width of the ring wall, inches. */
    readonly ringWidth: number;
    readonly segments: number;
    readonly kerf: number;
    readonly boardLength: number;
}

export interface SegmentedRingResult {
    /** Saw setting: half the angle each segment subtends. */
    readonly miterDeg: number;
    readonly segmentAngleDeg: number;
    readonly outerLength: number;
    readonly innerLength: number;
    readonly blankWidth: number;
    /** Total run of stock for one ring, kerfs included. */
    readonly stockPerRing: number;
    readonly boardsPerRing: number;
    readonly notes: CalcNotes;
}

export function computeSegmentedRing(input: SegmentedRingInput): SegmentedRingResult | null {
    const { outerDiameter, ringWidth, segments, kerf, boardLength } = input;

    if (!Number.isInteger(segments) || segments < 3 || segments > 64) {
        return null;
    }
    if (!(outerDiameter > 0) || !(ringWidth > 0) || ringWidth >= outerDiameter / 2) {
        return null;
    }

    const halfAngle = Math.PI / segments;
    const innerDiameter = outerDiameter - 2 * ringWidth;
    const outerLength = outerDiameter * Math.tan(halfAngle);
    const stockPerRing = segments * (outerLength + kerf);

    const notes: string[] = [];
    if (segments % 2 !== 0) {
        notes.push('An odd number of segments cannot be cut two at a time from a folded layout.');
    }
    notes.push('Cut one test pair and check the angle across a full ring before committing the stock.');

    return {
        miterDeg: 180 / segments,
        segmentAngleDeg: 360 / segments,
        outerLength,
        innerLength: innerDiameter * Math.tan(halfAngle),
        blankWidth: ringWidth,
        stockPerRing,
        boardsPerRing: boardLength > 0 ? Math.ceil(stockPerRing / boardLength) : 0,
        notes,
    };
}
