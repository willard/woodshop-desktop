/**
 * Saw settings for a closed shape of any number of sides, flat or canted (D86).
 *
 * The formulas are uncontroversial; the CONVENTIONS are where published tables disagree, so `tilt`
 * is defined once and unambiguously: how far each side leans out from vertical, measured from the
 * vertical. 0 is a flat frame or an upright box. Every result is pinned in the spec against the
 * canonical compound-miter table row (4 sides at 30° → 40.89° / 20.70°) so a convention flip breaks
 * the build rather than reaching a workshop.
 */

const DEG = Math.PI / 180;

/** Below 3 sides there is no closed shape; above this a saw setting stops being the useful answer. */
const MIN_SIDES = 3;
const MAX_SIDES = 24;

export interface PolygonAngleInput {
    readonly sides: number;
    /** How far each side leans out from vertical, degrees. 0 = square box or flat frame. */
    readonly tiltDeg: number;
}

export interface PolygonAngleResult {
    /** The angle at each corner of the finished shape. */
    readonly interiorDeg: number;
    /** The turn from one side to the next — the sum of these is always 360. */
    readonly exteriorDeg: number;
    /** Swing the miter gauge this far. Both mating pieces get the same. */
    readonly miterDeg: number;
    /** Tilt the blade this far. Zero whenever the sides stand straight up. */
    readonly bevelDeg: number;
}

export function computePolygonAngles(input: PolygonAngleInput): PolygonAngleResult | null {
    const { sides, tiltDeg } = input;
    if (!Number.isInteger(sides) || sides < MIN_SIDES || sides > MAX_SIDES) {
        return null;
    }
    if (!Number.isFinite(tiltDeg) || tiltDeg < 0 || tiltDeg >= 90) {
        return null;
    }

    const half = 180 / sides;

    return {
        interiorDeg: ((sides - 2) * 180) / sides,
        exteriorDeg: 360 / sides,
        // At tilt 0 these collapse to atan(tan(half)) = half and asin(0) = 0 — the flat-frame case.
        miterDeg: Math.atan(Math.cos(tiltDeg * DEG) * Math.tan(half * DEG)) / DEG,
        bevelDeg: Math.asin(Math.sin(tiltDeg * DEG) * Math.cos(half * DEG)) / DEG,
    };
}

/** Two pieces meeting at a known included angle: each is cut at half of it. */
export function computeJointMiter(includedAngleDeg: number): { readonly miterDeg: number } | null {
    if (!Number.isFinite(includedAngleDeg) || includedAngleDeg <= 0 || includedAngleDeg >= 360) {
        return null;
    }
    return { miterDeg: includedAngleDeg / 2 };
}
