import { describe, it, expect } from 'vitest';
import { assessSturdiness, DEFAULT_STRUCT_CONFIG } from '@/struct';
import { makeSpec, sidePanel, shelf, shelfBetweenSides, type PartDef } from './helpers';

describe('assessSturdiness — shelf sag', () => {
    it('warns when a long 3/4" ply span exceeds the sag limit', () => {
        const report = assessSturdiness(makeSpec(shelfBetweenSides(40)));
        expect(report.issues.map((i) => i.code)).toEqual(['struct.sag']);
        expect(report.issues[0].partId).toBe('p_shelf');
        expect(report.issues[0].message).toContain('add a center support');
        expect(report.shelves).toHaveLength(1);
        expect(report.shelves[0].span).toBeCloseTo(40, 5);
        expect(report.shelves[0].deflection).toBeGreaterThan(report.shelves[0].allowed);
    });

    it('passes a short span and still records the analyzed row', () => {
        const report = assessSturdiness(makeSpec(shelfBetweenSides(24)));
        expect(report.issues).toEqual([]);
        expect(report.shelves).toHaveLength(1);
        expect(report.shelves[0].span).toBeCloseTo(24, 5);
        expect(report.shelves[0].deflection).toBeCloseTo(0.0155, 3);
    });

    it('a center divider halves the span and clears the warning', () => {
        const divider: PartDef = {
            id: 'p_divider',
            size: { l: 12, w: 19.625 },
            pos: [0, 9.8125, 0],
            rot: [0, 90, 0],
        };
        // Back panel keeps the ≥4-part open frame from tripping the racking check;
        // it is still excluded as a sag support, so the span comes from the divider.
        const back: PartDef = { id: 'p_back', size: { l: 41.5, w: 30 }, pos: [0, 15, -6.375] };
        const report = assessSturdiness(makeSpec([...shelfBetweenSides(40), divider, back]));
        expect(report.issues).toEqual([]);
        expect(report.shelves[0].span).toBeCloseTo(19.625, 3);
    });

    it('skips panels resting on the floor', () => {
        const report = assessSturdiness(makeSpec([...shelfBetweenSides(40, { y: 0.375 })]));
        expect(report.issues).toEqual([]);
        expect(report.shelves).toEqual([]);
    });

    it('does not count a back panel as a support', () => {
        // Back panel touches the shelf's rear edge and runs the full span, but only
        // overlaps 0 of its depth — the span stays 40 and the warning stays.
        const back: PartDef = { id: 'p_back', size: { l: 41.5, w: 30 }, pos: [0, 15, -6.375] };
        const report = assessSturdiness(makeSpec([...shelfBetweenSides(40), back]));
        expect(report.issues.map((i) => i.code)).toEqual(['struct.sag']);
        expect(report.shelves[0].span).toBeCloseTo(40, 5);
    });

    it('skips a shelf whose only neighbor is a back panel (no supports)', () => {
        const back: PartDef = { id: 'p_back', size: { l: 41.5, w: 30 }, pos: [0, 15, -6.375] };
        const report = assessSturdiness(makeSpec([shelf('p_shelf', 40), back]));
        expect(report.shelves).toEqual([]);
    });

    it('skips tilted parts instead of mis-measuring them', () => {
        const tilted: PartDef = { id: 'p_tilted', size: { l: 40, w: 12 }, pos: [0, 20, 0], rot: [60, 0, 0] };
        const report = assessSturdiness(
            makeSpec([sidePanel('p_side_l', -20.375), sidePanel('p_side_r', 20.375), tilted]),
        );
        expect(report.shelves).toEqual([]);
    });

    it('uses the species stiffness table — oak passes where pine warns', () => {
        const build = (species: string) =>
            makeSpec(shelfBetweenSides(36), {
                materials: [{ id: 'mat_wood', type: 'lumber', thickness: 0.75, species }],
            });
        expect(assessSturdiness(build('pine')).issues.map((i) => i.code)).toEqual(['struct.sag']);
        expect(assessSturdiness(build('oak')).issues).toEqual([]);
    });

    it('honors config overrides — a heavy load makes a short span warn', () => {
        const spec = makeSpec(shelfBetweenSides(24));
        const report = assessSturdiness(spec, { ...DEFAULT_STRUCT_CONFIG, shelfLoadPerFoot: 100 });
        expect(report.issues.map((i) => i.code)).toEqual(['struct.sag']);
    });
});
