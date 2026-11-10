import { describe, it, expect } from 'vitest';
import { computePilotHole, SCREW_SPECS, screwSpecOf, type PilotHoleInput } from '@/calc/pilotHoles';
import { pocketScrewThread, screwGauge, woodScrewLength, pocketScrewLength } from '@/spec/fasteners';
import { SPEC_SPECIES, speciesById } from '@/lib/species';
import type { Material } from '@/spec/types';

function joint(over: Partial<PilotHoleInput> = {}): PilotHoleInput {
    return {
        joint: 'faceScrew',
        topThickness: 0.75,
        bottomThickness: 0.75,
        speciesId: 'oak',
        gauge: null,
        endGrain: false,
        counterbore: false,
        ...over,
    };
}

describe('the drill-size table', () => {
    it('grows monotonically with the gauge', () => {
        for (let i = 1; i < SCREW_SPECS.length; i += 1) {
            const previous = SCREW_SPECS[i - 1];
            const current = SCREW_SPECS[i];
            expect(current.shank).toBeGreaterThan(previous.shank);
            expect(current.pilotSoft).toBeGreaterThan(previous.pilotSoft);
            expect(current.clearance).toBeGreaterThan(previous.clearance);
        }
    });

    it('always drills the hardwood pilot larger than the softwood one', () => {
        for (const s of SCREW_SPECS) {
            expect(s.pilotHard).toBeGreaterThan(s.pilotSoft);
            // The clearance hole must pass the shank, or the boards will not pull together.
            expect(s.clearance).toBeGreaterThanOrEqual(s.shank);
            // And the pilot must be smaller than the shank, or there is nothing for the thread.
            expect(s.pilotHard).toBeLessThan(s.shank);
        }
    });
});

describe('computePilotHole', () => {
    it('drills bigger in oak than in pine for the same screw', () => {
        expect(computePilotHole(joint({ speciesId: 'oak', gauge: '#8' }))?.pilot).toBe(0.109375);
        expect(computePilotHole(joint({ speciesId: 'pine', gauge: '#8' }))?.pilot).toBe(0.09375);
    });

    it('lets the app choose the gauge when none is given', () => {
        expect(computePilotHole(joint({ bottomThickness: 0.75 }))?.gauge).toBe('#8');
        expect(computePilotHole(joint({ bottomThickness: 0.375 }))?.gauge).toBe('#6');
    });

    it('opens the edge distance in end grain and says why', () => {
        const face = computePilotHole(joint({ endGrain: false }));
        const end = computePilotHole(joint({ endGrain: true }));
        expect(end?.minEdgeDistance as number).toBeGreaterThan(face?.minEdgeDistance as number);
        expect(end?.notes.join(' ')).toContain('half what face grain');
    });

    it('offers a counterbore only when asked, sized for a plug cutter', () => {
        expect(computePilotHole(joint())?.counterbore).toBeNull();
        const bored = computePilotHole(joint({ counterbore: true }));
        expect(bored?.counterbore?.diameter).toBe(0.375);
        expect(bored?.counterbore?.depth).toBeGreaterThan(0);
    });

    it('warns when the head would break through a thin top board', () => {
        expect(computePilotHole(joint({ topThickness: 0.125, gauge: '#10' }))?.notes.join(' ')).toContain(
            'break through',
        );
    });

    it('uses coarse thread in sheet goods whatever the pilot table says', () => {
        const r = computePilotHole(joint({ speciesId: 'mdf', joint: 'pocketScrew' }));
        expect(r?.thread).toBe('coarse');
    });

    it('returns null for a gauge it has no data for', () => {
        expect(screwSpecOf('#99' as never)).toBeUndefined();
        expect(computePilotHole(joint({ gauge: '#99' as never }))).toBeNull();
    });
});

describe('parity with spec/fasteners.ts', () => {
    it('takes screw length straight from the app, for both joint kinds', () => {
        // The calculator must not invent its own length rule, or it would disagree with the screws
        // the editor draws and the cut list orders (D86).
        for (const top of [0.5, 0.75, 1]) {
            for (const bottom of [0.5, 0.75, 1.5]) {
                expect(computePilotHole(joint({ topThickness: top, bottomThickness: bottom }))?.length).toBe(
                    woodScrewLength(top, bottom),
                );
                expect(
                    computePilotHole(
                        joint({ joint: 'pocketScrew', topThickness: top, bottomThickness: bottom }),
                    )?.length,
                ).toBe(pocketScrewLength(top, bottom));
            }
        }
    });

    it('picks the same gauge the app would', () => {
        for (const bottom of [0.25, 0.375, 0.5, 0.75, 1.5]) {
            expect(computePilotHole(joint({ bottomThickness: bottom }))?.gauge).toBe(screwGauge(bottom));
        }
    });

    it('agrees with pocketScrewThread for every species the spec can name', () => {
        for (const id of SPEC_SPECIES) {
            const material = {
                id: 'm',
                type: 'lumber',
                name: id,
                thickness: 0.75,
                species: id,
            } as unknown as Material;

            expect(computePilotHole(joint({ speciesId: id, joint: 'pocketScrew' }))?.thread).toBe(
                pocketScrewThread(material),
            );
        }
    });

    it('agrees with pocketScrewThread that sheet goods take coarse', () => {
        const sheet = { id: 'm', type: 'sheet', name: 'ply', thickness: 0.75 } as unknown as Material;
        expect(pocketScrewThread(sheet)).toBe('coarse');
        for (const id of ['mdf', 'plywood_baltic', 'particleboard'] as const) {
            expect(computePilotHole(joint({ speciesId: id, joint: 'pocketScrew' }))?.thread).toBe('coarse');
        }
    });

    it('only calls a species hard when the species table does', () => {
        for (const s of SCREW_SPECS) {
            const hardPilot = computePilotHole(joint({ speciesId: 'oak', gauge: s.gauge }))?.pilot;
            const softPilot = computePilotHole(joint({ speciesId: 'pine', gauge: s.gauge }))?.pilot;
            expect(hardPilot).toBe(s.pilotHard);
            expect(softPilot).toBe(s.pilotSoft);
        }
        expect(speciesById('oak')?.hardForFasteners).toBe(true);
        expect(speciesById('pine')?.hardForFasteners).toBe(false);
    });
});
