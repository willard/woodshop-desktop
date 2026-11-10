/**
 * Beam deflection primitives, extracted from `sag.ts` so the shelf-sag calculator and the editor's
 * sturdiness advisory compute from one implementation (D86). Pure arithmetic — no spec, no parts,
 * no config object. Inches, pounds and psi throughout.
 *
 * The unit trap this module exists to close: shop loads are quoted per linear FOOT and spans are
 * measured in INCHES, so `w` has to be divided by 12 before it meets a span. A fresh implementation
 * forgets that and is wrong by 12x, in the direction that says a shelf is fine.
 */

/** How the ends are held. Housed in dados is far stiffer than resting on supports. */
export type EndCondition = 'simple' | 'fixed';

export type BeamLoad =
    /** Spread evenly along the span, pounds per linear foot. */
    | { readonly kind: 'uniform'; readonly perFoot: number }
    /** A single load at mid-span, pounds. */
    | { readonly kind: 'center'; readonly pounds: number };

/**
 * Second moment of area of a rectangular section, in⁴.
 *
 * Note which dimension is cubed: THICKNESS is, depth is linear. Swapping them at shelf proportions
 * is an error of a couple of hundred times that still looks like a plausible number.
 */
export function rectangleInertia(depth: number, thickness: number): number {
    return (depth * thickness ** 3) / 12;
}

/** Deflection coefficient for each load and end-condition pairing. */
function coefficient(load: BeamLoad, ends: EndCondition): number {
    if (load.kind === 'uniform') {
        return ends === 'simple' ? 5 / 384 : 1 / 384;
    }
    return ends === 'simple' ? 1 / 48 : 1 / 192;
}

/**
 * Mid-span deflection, inches. Uniform and simply supported is 5wL⁴/384EI — the Sagulator model
 * the sturdiness advisory has always used.
 */
export function deflection(
    load: BeamLoad,
    span: number,
    modulus: number,
    inertia: number,
    ends: EndCondition,
): number {
    if (span <= 0 || modulus <= 0 || inertia <= 0) {
        return 0;
    }
    const c = coefficient(load, ends);
    if (load.kind === 'uniform') {
        const perInch = load.perFoot / 12;
        return (c * perInch * span ** 4) / (modulus * inertia);
    }
    return (c * load.pounds * span ** 3) / (modulus * inertia);
}

/**
 * The longest span whose deflection still lands inside `allowedPerFoot · span / 12`.
 *
 * Closed form rather than a search: the allowance grows linearly with span while deflection grows
 * with its cube or fourth power, so setting the two equal leaves one power of L to solve for.
 */
export function maxSpan(
    load: BeamLoad,
    modulus: number,
    inertia: number,
    allowedPerFoot: number,
    ends: EndCondition,
): number {
    if (modulus <= 0 || inertia <= 0 || allowedPerFoot <= 0) {
        return 0;
    }
    const c = coefficient(load, ends);
    const slope = allowedPerFoot / 12; // allowed deflection per inch of span
    if (load.kind === 'uniform') {
        if (load.perFoot <= 0) {
            return Infinity;
        }
        // c·(perFoot/12)·L⁴ / EI = slope·L  →  L³ = slope·EI / (c·perInch)
        return Math.cbrt((slope * modulus * inertia) / (c * (load.perFoot / 12)));
    }
    if (load.pounds <= 0) {
        return Infinity;
    }
    // c·P·L³ / EI = slope·L  →  L² = slope·EI / (c·P)
    return Math.sqrt((slope * modulus * inertia) / (c * load.pounds));
}
