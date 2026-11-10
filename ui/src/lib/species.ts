/**
 * Physical properties of the materials a shop actually works in (D86).
 *
 * Reference data, not tunables — the same shape as `lumberSizes.ts`, and deliberately not config:
 * every consumer is client-side and pure, so shipping this as an Inertia prop would break the
 * offline path and add a round trip to arithmetic that has no server.
 *
 * Sources, single-sourced on purpose so a transcription slip is one place to check:
 * - Modulus of elasticity: USDA FPL *Wood Handbook* (FPL-GTR-282) Ch. 5, Table 5-3, green-to-12%
 *   values at 12% moisture content, psi.
 * - Dimensional change coefficients: *Wood Handbook* Ch. 4, Table 4-9 — fractional change in
 *   dimension per 1% change in moisture content, tangential (flatsawn) and radial (quartersawn).
 * - Janka side hardness and density: *Wood Handbook* Ch. 5, Tables 5-3 and 5-5, at 12% MC.
 *
 * `species.spec.ts` pins every number here by value. A wrong coefficient is a failing test rather
 * than a confidently wrong answer handed to someone gluing up a tabletop.
 */
import type { Species } from '../spec/types';

/**
 * Every material the calculators can be pointed at. A superset of the spec's `Species` — the five
 * schema values appear here as literal members so the two can be checked against each other, but
 * the extra entries deliberately do NOT extend `spec.schema.json` (hard rule 5 would demand a
 * `specVersion` bump, a migration and reseeded templates for calculators that never touch a spec).
 */
export type SpeciesId =
    | Species
    | 'white_oak'
    | 'ash'
    | 'poplar'
    | 'birch'
    | 'beech'
    | 'mahogany'
    | 'douglas_fir'
    | 'cedar'
    | 'plywood_softwood'
    | 'plywood_baltic'
    | 'mdf'
    | 'particleboard';

export type SpeciesKind = 'hardwood' | 'softwood' | 'panel';

export interface SpeciesProps {
    readonly id: SpeciesId;
    readonly label: string;
    readonly kind: SpeciesKind;
    /** Modulus of elasticity, psi at 12% MC. Drives deflection: sag is inversely proportional. */
    readonly modulus: number;
    /**
     * Dimensional change per 1% change in moisture content, tangential — the flatsawn face, and
     * the larger of the two by roughly 2x. Null for panels, which move negligibly across the face.
     */
    readonly tangential: number | null;
    /** …radial: the quartersawn face. Null for panels. */
    readonly radial: number | null;
    /** Janka side hardness, lbf at 12% MC. Null for panels. */
    readonly janka: number | null;
    /** Air-dry density, lb per cubic foot at 12% MC. Null for panels without a standard value. */
    readonly density: number | null;
    /**
     * Wants a fine thread and a full-diameter pilot. Agrees with `HARDWOOD_SPECIES` in
     * `spec/fasteners.ts` for the five species the spec knows — a test holds the two together.
     */
    readonly hardForFasteners: boolean;
}

export const SPECIES: readonly SpeciesProps[] = [
    // --- the five the spec schema can name ---
    {
        id: 'pine',
        label: 'Pine (eastern white)',
        kind: 'softwood',
        modulus: 1_200_000,
        tangential: 0.00212,
        radial: 0.00071,
        janka: 380,
        density: 25,
        hardForFasteners: false,
    },
    {
        id: 'oak',
        label: 'Red oak',
        kind: 'hardwood',
        modulus: 1_820_000,
        tangential: 0.00369,
        radial: 0.00158,
        janka: 1290,
        density: 44,
        hardForFasteners: true,
    },
    {
        id: 'maple',
        label: 'Hard maple',
        kind: 'hardwood',
        modulus: 1_830_000,
        tangential: 0.00353,
        radial: 0.00165,
        janka: 1450,
        density: 44,
        hardForFasteners: true,
    },
    {
        id: 'walnut',
        label: 'Black walnut',
        kind: 'hardwood',
        modulus: 1_680_000,
        tangential: 0.00274,
        radial: 0.00179,
        janka: 1010,
        density: 38,
        hardForFasteners: true,
    },
    {
        id: 'cherry',
        label: 'Black cherry',
        kind: 'hardwood',
        modulus: 1_490_000,
        tangential: 0.00248,
        radial: 0.00126,
        janka: 950,
        density: 35,
        hardForFasteners: true,
    },

    // --- other solid stock ---
    {
        id: 'white_oak',
        label: 'White oak',
        kind: 'hardwood',
        modulus: 1_780_000,
        tangential: 0.00365,
        radial: 0.0018,
        janka: 1360,
        density: 47,
        hardForFasteners: true,
    },
    {
        id: 'ash',
        label: 'White ash',
        kind: 'hardwood',
        modulus: 1_740_000,
        tangential: 0.00274,
        radial: 0.00169,
        janka: 1320,
        density: 41,
        hardForFasteners: true,
    },
    {
        id: 'poplar',
        label: 'Poplar (yellow)',
        kind: 'hardwood',
        modulus: 1_580_000,
        tangential: 0.00289,
        radial: 0.00158,
        janka: 540,
        density: 29,
        hardForFasteners: false,
    },
    {
        id: 'birch',
        label: 'Yellow birch',
        kind: 'hardwood',
        modulus: 2_010_000,
        tangential: 0.00338,
        radial: 0.00256,
        janka: 1260,
        density: 43,
        hardForFasteners: true,
    },
    {
        id: 'beech',
        label: 'American beech',
        kind: 'hardwood',
        modulus: 1_720_000,
        tangential: 0.00431,
        radial: 0.0019,
        janka: 1300,
        density: 45,
        hardForFasteners: true,
    },
    {
        id: 'mahogany',
        label: 'Mahogany (Honduran)',
        kind: 'hardwood',
        modulus: 1_500_000,
        tangential: 0.00238,
        radial: 0.00172,
        janka: 800,
        density: 34,
        hardForFasteners: false,
    },
    {
        id: 'douglas_fir',
        label: 'Douglas fir',
        kind: 'softwood',
        modulus: 1_950_000,
        tangential: 0.00267,
        radial: 0.00165,
        janka: 620,
        density: 33,
        hardForFasteners: false,
    },
    {
        id: 'cedar',
        label: 'Western red cedar',
        kind: 'softwood',
        modulus: 1_110_000,
        tangential: 0.00234,
        radial: 0.00111,
        janka: 350,
        density: 23,
        hardForFasteners: false,
    },

    // --- panels. Essential in the sag picker: MDF is a third the stiffness of Baltic birch, and
    //     that is the case people get wrong by reaching for a solid-wood species instead. ---
    {
        id: 'plywood_baltic',
        label: 'Baltic birch plywood',
        kind: 'panel',
        modulus: 1_500_000,
        tangential: null,
        radial: null,
        janka: null,
        density: 42,
        hardForFasteners: false,
    },
    {
        id: 'plywood_softwood',
        label: 'Softwood plywood',
        kind: 'panel',
        modulus: 1_100_000,
        tangential: null,
        radial: null,
        janka: null,
        density: 36,
        hardForFasteners: false,
    },
    {
        id: 'mdf',
        label: 'MDF',
        kind: 'panel',
        modulus: 500_000,
        tangential: null,
        radial: null,
        janka: null,
        density: 46,
        hardForFasteners: false,
    },
    {
        id: 'particleboard',
        label: 'Particleboard / melamine',
        kind: 'panel',
        modulus: 300_000,
        tangential: null,
        radial: null,
        janka: null,
        density: 45,
        hardForFasteners: false,
    },
];

const BY_ID: ReadonlyMap<SpeciesId, SpeciesProps> = new Map(SPECIES.map((s) => [s.id, s]));

export function speciesById(id: SpeciesId): SpeciesProps | undefined {
    return BY_ID.get(id);
}

/** Modulus of elasticity, psi. Falls back to the conservative pine figure for an unknown id. */
export function modulusOf(id: SpeciesId): number {
    return BY_ID.get(id)?.modulus ?? 1_200_000;
}

/** The five ids `spec.schema.json` can name — the editor's material presets. */
export const SPEC_SPECIES: readonly Species[] = ['pine', 'oak', 'maple', 'walnut', 'cherry'];

/**
 * Species that move seasonally. Panels are excluded so the movement calculator cannot be pointed at
 * something it would answer nonsense for — the impossible input is simply not offered.
 */
export const SOLID_SPECIES: readonly SpeciesProps[] = SPECIES.filter((s) => s.kind !== 'panel');
