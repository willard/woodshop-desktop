/**
 * Pilot, clearance and countersink sizes for a screw in a given species (D86).
 *
 * Screw LENGTH, GAUGE and THREAD are not decided here — they come from `spec/fasteners.ts`, the
 * same functions that size the screws the editor draws and the cut list orders. A parity test holds
 * them together. Only the drill-size table is new data.
 */
import {
    pocketScrewLength,
    screwGauge,
    woodScrewLength,
    type ScrewGauge,
    type ScrewThread,
} from '../spec/fasteners';
import { speciesById, type SpeciesId } from '../lib/species';
import type { CalcNotes } from './types';

/**
 * A superset of the app's `ScrewGauge`, the same way `SpeciesId` supersets `Species`: the three the
 * spec models are literal members, so anything `screwGauge()` returns is valid here.
 */
export type PilotGauge = ScrewGauge | '#4' | '#12';

export interface ScrewSpec {
    readonly gauge: PilotGauge;
    /** Outside diameter of the unthreaded shank, inches. */
    readonly shank: number;
    /** Pilot for softwood — the thread cuts its own way in. */
    readonly pilotSoft: number;
    /** Pilot for hardwood: bigger, because the wood will not compress and splits instead. */
    readonly pilotHard: number;
    /**
     * The top board is drilled full size so it is pulled down, not held off. Always the nearest
     * common bit AT OR ABOVE the shank: a "clearance" hole narrower than the shank is not one, and
     * the two charts that quote 7/64 for #4 and 3/16 for #10 are both a hair under.
     */
    readonly clearance: number;
    readonly headDiameter: number;
    /** Plug-cutter diameter when the head is to be buried and covered. */
    readonly counterbore: number;
}

export const SCREW_SPECS: readonly ScrewSpec[] = [
    {
        gauge: '#4',
        shank: 0.112,
        pilotSoft: 0.0625,
        pilotHard: 0.078125,
        clearance: 0.125,
        headDiameter: 0.225,
        counterbore: 0.375,
    },
    {
        gauge: '#6',
        shank: 0.138,
        pilotSoft: 0.078125,
        pilotHard: 0.09375,
        clearance: 0.140625,
        headDiameter: 0.279,
        counterbore: 0.375,
    },
    {
        gauge: '#8',
        shank: 0.164,
        pilotSoft: 0.09375,
        pilotHard: 0.109375,
        clearance: 0.171875,
        headDiameter: 0.332,
        counterbore: 0.375,
    },
    {
        gauge: '#10',
        shank: 0.19,
        pilotSoft: 0.109375,
        pilotHard: 0.125,
        clearance: 0.203125,
        headDiameter: 0.385,
        counterbore: 0.5,
    },
    {
        gauge: '#12',
        shank: 0.216,
        pilotSoft: 0.125,
        pilotHard: 0.140625,
        clearance: 0.21875,
        headDiameter: 0.438,
        counterbore: 0.5,
    },
];

const BY_GAUGE: ReadonlyMap<PilotGauge, ScrewSpec> = new Map(SCREW_SPECS.map((s) => [s.gauge, s]));

export function screwSpecOf(gauge: PilotGauge): ScrewSpec | undefined {
    return BY_GAUGE.get(gauge);
}

/** Edge distance as a multiple of the shank, and the extra a split-prone end grain wants. */
const EDGE_SHANK_MULTIPLE = 5;
const END_GRAIN_EDGE_FACTOR = 1.5;

export interface PilotHoleInput {
    readonly joint: 'faceScrew' | 'pocketScrew';
    /** The board the screw goes through. */
    readonly topThickness: number;
    /** The board it lands in. */
    readonly bottomThickness: number;
    readonly speciesId: SpeciesId;
    /** Null lets `spec/fasteners.ts` choose, exactly as the editor does. */
    readonly gauge: PilotGauge | null;
    readonly endGrain: boolean;
    readonly counterbore: boolean;
}

export interface PilotHoleResult {
    readonly gauge: PilotGauge;
    readonly length: number;
    readonly thread: ScrewThread;
    readonly pilot: number;
    readonly clearance: number;
    readonly countersinkDepth: number;
    readonly counterbore: { readonly diameter: number; readonly depth: number } | null;
    readonly minEdgeDistance: number;
    readonly notes: CalcNotes;
}

export function computePilotHole(input: PilotHoleInput): PilotHoleResult | null {
    const { joint, topThickness, bottomThickness, speciesId, endGrain } = input;

    const gauge = input.gauge ?? screwGauge(bottomThickness);
    const spec = screwSpecOf(gauge);
    if (spec === undefined) {
        return null;
    }

    const species = speciesById(speciesId);
    const hard = species?.hardForFasteners ?? false;

    const length =
        joint === 'pocketScrew'
            ? pocketScrewLength(topThickness, bottomThickness)
            : woodScrewLength(topThickness, bottomThickness);

    // Coarse bites softwood and sheet goods; fine holds in hardwood without splitting it. This is
    // `pocketScrewThread`'s rule restated over the species table rather than a Material, and
    // pilotHoles.spec.ts asserts the two agree for every species the spec can name.
    const thread: ScrewThread = species !== undefined && species.kind !== 'panel' && hard ? 'fine' : 'coarse';

    // The head sinks until its cone is flush: a countersink is about half the head diameter deep.
    const countersinkDepth = spec.headDiameter / 2;

    const notes: string[] = [];
    if (endGrain) {
        notes.push(
            'End grain holds roughly half what face grain does — consider a dowel, a plug or a different joint.',
        );
    }
    if (hard) {
        notes.push(
            'Hardwood wants the larger pilot and a fine thread; the smaller pilot is what splits a rail.',
        );
    }
    if (countersinkDepth > topThickness) {
        notes.push('The countersink is deeper than the top board — the head will break through.');
    }
    if (joint === 'pocketScrew' && species?.kind === 'panel') {
        notes.push('Coarse thread in sheet goods; fine thread strips the core.');
    }

    return {
        gauge,
        length,
        thread,
        pilot: hard ? spec.pilotHard : spec.pilotSoft,
        clearance: spec.clearance,
        countersinkDepth,
        counterbore: input.counterbore
            ? { diameter: spec.counterbore, depth: Math.min(0.25, Math.max(0.125, topThickness / 3)) }
            : null,
        minEdgeDistance: spec.shank * EDGE_SHANK_MULTIPLE * (endGrain ? END_GRAIN_EDGE_FACTOR : 1),
        notes,
    };
}
