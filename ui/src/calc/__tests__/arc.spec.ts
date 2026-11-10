import { describe, it, expect } from 'vitest';
import { computeArc, computeSegmentedRing } from '@/calc/arc';

describe('computeArc', () => {
    it('works the reference curve: a 48in chord standing 6in proud', () => {
        const r = computeArc({ kind: 'chordRise', chord: 48, rise: 6 });
        expect(r?.radius).toBeCloseTo(51, 10);
        expect(r?.includedDeg).toBeCloseTo(56.145, 3);
        expect(r?.arcLength).toBeCloseTo(49.976, 3);
        expect(r?.centreOffset).toBeCloseTo(45, 10);
    });

    it('reaches the same arc from any two knowns', () => {
        const fromRise = computeArc({ kind: 'chordRise', chord: 48, rise: 6 });
        const fromRadius = computeArc({ kind: 'chordRadius', chord: 48, radius: 51 });
        const fromBoth = computeArc({ kind: 'riseRadius', rise: 6, radius: 51 });

        for (const r of [fromRadius, fromBoth]) {
            expect(r?.radius).toBeCloseTo(fromRise?.radius as number, 8);
            expect(r?.chord).toBeCloseTo(fromRise?.chord as number, 8);
            expect(r?.rise).toBeCloseTo(fromRise?.rise as number, 8);
            expect(r?.arcLength).toBeCloseTo(fromRise?.arcLength as number, 8);
        }
    });

    it('handles a half circle', () => {
        const r = computeArc({ kind: 'chordRise', chord: 20, rise: 10 });
        expect(r?.radius).toBeCloseTo(10, 10);
        expect(r?.includedDeg).toBeCloseTo(180, 6);
        expect(r?.arcLength).toBeCloseTo(Math.PI * 10, 8);
        expect(r?.centreOffset).toBeCloseTo(0, 10); // the centre sits on the chord
    });

    it('lays out ordinates that peak at the rise and are symmetric', () => {
        const r = computeArc({ kind: 'chordRise', chord: 48, rise: 6 }, 8);
        const o = r?.ordinates as { along: number; offset: number }[];
        expect(o).toHaveLength(9);
        expect(o[0].offset).toBeCloseTo(0, 8);
        expect(o[8].offset).toBeCloseTo(0, 8);
        expect(o[4].offset).toBeCloseTo(6, 8); // the middle is the rise
        for (let i = 0; i < 4; i += 1) {
            expect(o[i].offset).toBeCloseTo(o[8 - i].offset, 8);
        }
    });

    it('refuses geometry that cannot exist', () => {
        expect(computeArc({ kind: 'chordRadius', chord: 100, radius: 10 })).toBeNull(); // chord > diameter
        expect(computeArc({ kind: 'riseRadius', rise: 20, radius: 10 })).toBeNull(); // rise > radius
        expect(computeArc({ kind: 'chordRise', chord: 48, rise: 0 })).toBeNull(); // a straight line
        expect(computeArc({ kind: 'chordRise', chord: -48, rise: 6 })).toBeNull();
    });

    it('suggests a batten for a very flat curve', () => {
        expect(computeArc({ kind: 'chordRise', chord: 48, rise: 0.5 })?.notes.join(' ')).toContain('batten');
    });
});

describe('computeSegmentedRing', () => {
    it('gives the saw setting for a twelve-segment ring', () => {
        const r = computeSegmentedRing({
            outerDiameter: 12,
            ringWidth: 1.5,
            segments: 12,
            kerf: 0.125,
            boardLength: 96,
        });
        expect(r?.miterDeg).toBeCloseTo(15, 10);
        expect(r?.segmentAngleDeg).toBeCloseTo(30, 10);
        expect(r?.outerLength).toBeCloseTo(12 * Math.tan(Math.PI / 12), 10);
    });

    it('cuts the inner edge shorter than the outer', () => {
        const r = computeSegmentedRing({
            outerDiameter: 12,
            ringWidth: 1.5,
            segments: 12,
            kerf: 0.125,
            boardLength: 96,
        });
        expect(r?.innerLength as number).toBeLessThan(r?.outerLength as number);
        expect(r?.innerLength).toBeCloseTo(9 * Math.tan(Math.PI / 12), 10);
    });

    it('adds a kerf per segment to the stock needed', () => {
        const r = computeSegmentedRing({
            outerDiameter: 12,
            ringWidth: 1.5,
            segments: 12,
            kerf: 0.125,
            boardLength: 96,
        });
        expect(r?.stockPerRing).toBeCloseTo(12 * ((r?.outerLength as number) + 0.125), 10);
        expect(r?.boardsPerRing).toBe(1);
    });

    it('needs more boards for a bigger ring', () => {
        const big = computeSegmentedRing({
            outerDiameter: 36,
            ringWidth: 2,
            segments: 16,
            kerf: 0.125,
            boardLength: 48,
        });
        expect(big?.boardsPerRing as number).toBeGreaterThan(1);
    });

    it('warns about an odd segment count', () => {
        expect(
            computeSegmentedRing({
                outerDiameter: 12,
                ringWidth: 1.5,
                segments: 11,
                kerf: 0.125,
                boardLength: 96,
            })?.notes.join(' '),
        ).toContain('odd number');
    });

    it('refuses a ring that would close on itself or has too few segments', () => {
        expect(
            computeSegmentedRing({
                outerDiameter: 12,
                ringWidth: 6,
                segments: 12,
                kerf: 0.125,
                boardLength: 96,
            }),
        ).toBeNull();
        expect(
            computeSegmentedRing({
                outerDiameter: 12,
                ringWidth: 1.5,
                segments: 2,
                kerf: 0.125,
                boardLength: 96,
            }),
        ).toBeNull();
    });
});
