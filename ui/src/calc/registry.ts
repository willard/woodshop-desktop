/**
 * The catalogue of shop calculators (D86).
 *
 * PLAIN DATA ONLY — no compute functions live here. Fourteen differently-typed `compute` functions
 * in one array would need an existential type, and the workarounds are `any` (banned), casts at
 * every call site, or a discriminated union of every input taxed by every calculator to serve a
 * generic runner that does not exist. Each panel calls its one function with its one type instead.
 *
 * `id` is the URL segment. `config/tools.php` mirrors these ids so the controller can 404 an unknown
 * slug; `registry.spec.ts` reads that file off disk and fails if the two drift.
 *
 * Grouped by what a woodworker is doing, not by the order the modules were built.
 */

export type CalcGroupId = 'stock' | 'span' | 'joinery' | 'layout';

export interface CalcGroup {
    readonly id: CalcGroupId;
    readonly title: string;
    readonly blurb: string;
}

export interface CalcMeta {
    readonly id: string;
    readonly group: CalcGroupId;
    readonly title: string;
    readonly summary: string;
    /** Path data for a 24x24 stroke icon, matching the app's hand-drawn SVG convention. */
    readonly icon: string;
    /** Extra words the hub's filter should match — what people call these at the bench. */
    readonly keywords: readonly string[];
}

export const CALC_GROUPS: readonly CalcGroup[] = [
    { id: 'stock', title: 'Material & stock', blurb: 'What to buy, and what it costs.' },
    { id: 'span', title: 'Strength & seasonal movement', blurb: 'Whether it holds, and how much it moves.' },
    { id: 'joinery', title: 'Joinery', blurb: 'Sizes for the joints that hold it together.' },
    { id: 'layout', title: 'Angles, curves & proportion', blurb: 'Setting out and setting the saw.' },
];

export const CALCULATORS: readonly CalcMeta[] = [
    {
        id: 'board-feet',
        group: 'stock',
        title: 'Board feet',
        summary: 'Board feet and cost for a stack of rough lumber, with a waste allowance.',
        icon: 'M3 6h18v4H3zM3 14h18v4H3z',
        keywords: ['bdft', 'lumber', 'cost', 'quarter', '4/4', 'volume'],
    },
    {
        id: 'stock-estimator',
        group: 'stock',
        title: 'Stock estimator',
        summary: 'How many boards or sheets your parts cut from, kerf included.',
        icon: 'M3 4h18v16H3zM3 11h18M12 11v9',
        keywords: ['sheet', 'plywood', 'kerf', 'yield', 'offcut', 'nesting'],
    },
    {
        id: 'unit-converter',
        group: 'stock',
        title: 'Unit converter',
        summary: 'Inches, fractions, feet and metric — and how far the fraction rounds off.',
        icon: 'M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3',
        keywords: ['metric', 'mm', 'millimetre', 'fraction', 'decimal', 'imperial'],
    },
    {
        id: 'shelf-sag',
        group: 'span',
        title: 'Shelf sag',
        summary: 'Will it sag? Deflection and safe span for a shelf under load.',
        icon: 'M3 8v8M21 8v8M3 10c6 4 12 4 18 0',
        keywords: ['deflection', 'span', 'sagulator', 'shelf', 'load', 'bookcase'],
    },
    {
        id: 'wood-movement',
        group: 'span',
        title: 'Wood movement',
        summary: 'How much a panel grows and shrinks between winter and summer.',
        icon: 'M4 5v14M20 5v14M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3',
        keywords: ['shrinkage', 'humidity', 'emc', 'expansion', 'panel', 'seasonal', 'tabletop'],
    },
    {
        id: 'mortise-tenon',
        group: 'joinery',
        title: 'Mortise & tenon',
        summary: 'Tenon thickness, length and shoulders from your rail and stile.',
        icon: 'M3 5h9v14H3zM12 9h5v6h-5M17 5h4v14h-4',
        keywords: ['tenon', 'mortise', 'haunch', 'shoulder', 'chisel', 'third'],
    },
    {
        id: 'dowel-layout',
        group: 'joinery',
        title: 'Dowel layout',
        summary: 'Dowel size, count and spacing along a joint.',
        icon: 'M3 8h18v8H3zM7 12h.01M12 12h.01M17 12h.01',
        keywords: ['dowel', 'pin', 'spacing', 'drill', 'jig'],
    },
    {
        id: 'pilot-holes',
        group: 'joinery',
        title: 'Pilot holes',
        summary: 'Pilot, clearance and countersink for a screw in your species.',
        icon: 'M12 3v13M12 20l-3-4h6zM9 6h6M9 9.5h6M9 13h6',
        keywords: ['screw', 'pilot', 'countersink', 'counterbore', 'pocket', 'gauge', 'plug'],
    },
    {
        id: 'miter-angles',
        group: 'layout',
        title: 'Miter & bevel',
        summary: 'Saw settings for any number of sides, flat or tilted.',
        icon: 'M4 20V6M4 20h15M4 20 19 6M10 20a7 7 0 0 0-1.2-4',
        keywords: ['miter', 'mitre', 'bevel', 'compound', 'polygon', 'sides', 'hexagon', 'octagon'],
    },
    {
        id: 'arc-radius',
        group: 'layout',
        title: 'Arc & radius',
        summary: 'Radius from chord and rise, plus trammel and ordinate offsets.',
        icon: 'M3 18a15 15 0 0 1 18 0M3 18h18M12 18v-4.2',
        keywords: ['arc', 'radius', 'chord', 'rise', 'sagitta', 'curve', 'trammel', 'ordinate'],
    },
    {
        id: 'segmented-ring',
        group: 'layout',
        title: 'Segmented rings',
        summary: 'Segment angle, blank length and stock for a turned ring.',
        icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
        keywords: ['segment', 'ring', 'turning', 'stave', 'bowl', 'cooper'],
    },
    {
        id: 'leg-taper',
        group: 'layout',
        title: 'Leg taper',
        summary: 'Taper angle, jig offset and blank size for a tapered leg.',
        icon: 'M8 3h8l-2 18h-4z',
        keywords: ['taper', 'leg', 'jig', 'sled', 'angle'],
    },
    {
        id: 'leg-splay',
        group: 'layout',
        title: 'Leg splay',
        summary: 'Rake and splay into one drill angle and sightline.',
        icon: 'M12 3v6M12 9 5 21M12 9l7 12',
        keywords: ['splay', 'rake', 'sightline', 'resultant', 'chair', 'stool', 'windsor'],
    },
    {
        id: 'proportions',
        group: 'layout',
        title: 'Proportions',
        summary: 'Golden section and simple ratios for sizing a case.',
        icon: 'M3 5h18v14H3zM14 5v14M14 12h7',
        keywords: ['golden', 'ratio', 'proportion', 'drawer', 'graduated', 'phi'],
    },
];

const BY_ID: ReadonlyMap<string, CalcMeta> = new Map(CALCULATORS.map((c) => [c.id, c]));

export function calculatorById(id: string): CalcMeta | undefined {
    return BY_ID.get(id);
}

/** The calculators in one group, in catalogue order. */
export function calculatorsInGroup(group: CalcGroupId): readonly CalcMeta[] {
    return CALCULATORS.filter((c) => c.group === group);
}
