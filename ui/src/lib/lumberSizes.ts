/**
 * Nominal dimensional-lumber sizes → actual dressed dimensions (decimal inches, hard rule 3).
 * The nominal name ("2x4") is what woodworkers shop by; the actual thickness × width is what
 * the spec stores (material.thickness / material.stockWidth). Pure data — no DOM, no Vue.
 */

/**
 * Stock length assumed when a lumber/round material lists no `stockLengths` (8' — what a rack
 * of dimensional lumber is). The cut list packs against it, so the linter must judge parts
 * against it too: the two disagreeing is how a 10' rail got "cut" from one 8' stick.
 */
export const DEFAULT_STOCK_LENGTH = 96;

export interface LumberSize {
    /** Nominal label, e.g. "2x4". */
    readonly nominal: string;
    /** Actual dressed thickness in inches. */
    readonly thickness: number;
    /** Actual dressed width in inches. */
    readonly width: number;
    /** Metric timber, sold by its planed size in millimetres. */
    readonly metric?: true;
}

/** Standard softwood dressed sizes (US S4S). Ordered for the picker: 1x, 2x, posts. */
export const LUMBER_SIZES: readonly LumberSize[] = [
    { nominal: '1x2', thickness: 0.75, width: 1.5 },
    { nominal: '1x3', thickness: 0.75, width: 2.5 },
    { nominal: '1x4', thickness: 0.75, width: 3.5 },
    { nominal: '1x6', thickness: 0.75, width: 5.5 },
    { nominal: '1x8', thickness: 0.75, width: 7.25 },
    { nominal: '1x10', thickness: 0.75, width: 9.25 },
    { nominal: '1x12', thickness: 0.75, width: 11.25 },
    { nominal: '2x2', thickness: 1.5, width: 1.5 },
    { nominal: '2x3', thickness: 1.5, width: 2.5 },
    { nominal: '2x4', thickness: 1.5, width: 3.5 },
    { nominal: '2x6', thickness: 1.5, width: 5.5 },
    { nominal: '2x8', thickness: 1.5, width: 7.25 },
    { nominal: '2x10', thickness: 1.5, width: 9.25 },
    { nominal: '2x12', thickness: 1.5, width: 11.25 },
    { nominal: '4x4', thickness: 3.5, width: 3.5 },
    { nominal: '4x6', thickness: 3.5, width: 5.5 },
    { nominal: '6x6', thickness: 5.5, width: 5.5 },
] as const;

/** Millimetres to inches, for tables written in millimetres. */
const mm = (v: number) => v / 25.4;

/**
 * Planed softwood (PSE / PAR) as sold in metric countries, by its finished size in millimetres.
 * Exact dressed sizes vary a millimetre or two by mill; these are the common ones.
 */
export const METRIC_LUMBER_SIZES: readonly LumberSize[] = [
    { nominal: '18×44 mm', thickness: mm(18), width: mm(44), metric: true },
    { nominal: '18×69 mm', thickness: mm(18), width: mm(69), metric: true },
    { nominal: '18×94 mm', thickness: mm(18), width: mm(94), metric: true },
    { nominal: '18×144 mm', thickness: mm(18), width: mm(144), metric: true },
    { nominal: '21×94 mm', thickness: mm(21), width: mm(94), metric: true },
    { nominal: '21×144 mm', thickness: mm(21), width: mm(144), metric: true },
    { nominal: '34×34 mm', thickness: mm(34), width: mm(34), metric: true },
    { nominal: '44×44 mm', thickness: mm(44), width: mm(44), metric: true },
    { nominal: '44×69 mm', thickness: mm(44), width: mm(69), metric: true },
    { nominal: '44×94 mm', thickness: mm(44), width: mm(94), metric: true },
    { nominal: '44×144 mm', thickness: mm(44), width: mm(144), metric: true },
    { nominal: '69×69 mm', thickness: mm(69), width: mm(69), metric: true },
    { nominal: '94×94 mm', thickness: mm(94), width: mm(94), metric: true },
] as const;

/** Metric timber comes in 2.4 m and 3.0 m lengths (and longer); 2.4 m is the common rack length. */
export const METRIC_STOCK_LENGTHS = [mm(2400), mm(3000)];

export function lumberSizeOf(nominal: string): LumberSize | undefined {
    return (
        LUMBER_SIZES.find((s) => s.nominal === nominal) ??
        METRIC_LUMBER_SIZES.find((s) => s.nominal === nominal)
    );
}

/** The nominal label matching a material's actual dims, if it is standard lumber. */
export function nominalOf(thickness: number, stockWidth: number | undefined): string | null {
    if (stockWidth === undefined) {
        return null;
    }
    const EPS = 1e-6;
    const hit = [...LUMBER_SIZES, ...METRIC_LUMBER_SIZES].find(
        (s) => Math.abs(s.thickness - thickness) < EPS && Math.abs(s.width - stockWidth) < EPS,
    );
    return hit?.nominal ?? null;
}

/**
 * Dowel rod, shopped for by diameter (spec 1.13 / D60). Round stock carries its diameter in
 * `material.thickness`, so one number is the whole size — there is no width to pair it with.
 */
export interface DowelSize {
    /** Label a woodworker shops by, e.g. '3/4"'. */
    readonly label: string;
    /** Actual diameter in inches — the material's thickness for round stock. */
    readonly diameter: number;
    readonly metric?: true;
}

/** The diameters sold off the rack, smallest first. */
export const DOWEL_SIZES: readonly DowelSize[] = [
    { label: '1/4"', diameter: 0.25 },
    { label: '3/8"', diameter: 0.375 },
    { label: '1/2"', diameter: 0.5 },
    { label: '5/8"', diameter: 0.625 },
    { label: '3/4"', diameter: 0.75 },
    { label: '1"', diameter: 1 },
    { label: '1-1/4"', diameter: 1.25 },
] as const;

/** Metric dowel rod, by diameter in millimetres. */
export const METRIC_DOWEL_SIZES: readonly DowelSize[] = [6, 8, 10, 12, 16, 20, 25].map((d) => ({
    label: `${d} mm`,
    diameter: mm(d),
    metric: true as const,
}));

export function dowelSizeOf(label: string): DowelSize | undefined {
    return DOWEL_SIZES.find((s) => s.label === label) ?? METRIC_DOWEL_SIZES.find((s) => s.label === label);
}

/** The dowel label matching a diameter, if it is a stock size. */
export function dowelLabelOf(diameter: number): string | null {
    const EPS = 1e-6;

    return (
        [...DOWEL_SIZES, ...METRIC_DOWEL_SIZES].find((s) => Math.abs(s.diameter - diameter) < EPS)?.label ??
        null
    );
}
