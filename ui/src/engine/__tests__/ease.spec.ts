import { describe, it, expect } from 'vitest';
import {
    easeProfile,
    easesByEdge,
    easeSize,
    easeFaces,
    maxEaseSize,
    insetAt,
    insetOf,
    runFactor,
    runBreakpoints,
    easeChord,
    easeLabel,
} from '@/engine/ease';
import type { EaseOp } from '@/engine/ease';

const THICKNESS = 0.75;

const SIZE = { l: 24, w: 12 };

const roundover = (radius: number, face?: 'front' | 'back'): EaseOp =>
    ({ type: 'ease', edge: 'w1', profile: 'roundover', radius, ...(face ? { face } : {}) }) as EaseOp;

describe('ease profiles (spec 1.10, stopped runs 1.11)', () => {
    it('starts at the face with the full inset and finishes tangent to the side', () => {
        const profile = easeProfile(roundover(0.25), THICKNESS);
        expect(profile[0].depth).toBe(0);
        expect(profile[0].inset).toBeCloseTo(0.25, 9);

        const last = profile[profile.length - 1];
        expect(last.depth).toBeCloseTo(0.25, 9);
        expect(last.inset).toBeCloseTo(0, 9);
    });

    it('traces a real quarter-circle — every sample sits on the bit radius', () => {
        const r = 0.25;
        for (const sample of easeProfile(roundover(r), THICKNESS)) {
            // Centre is r in from both the face and the side; the cut surface is r away from it.
            expect(Math.hypot(r - sample.inset, r - sample.depth)).toBeCloseTo(r, 9);
        }
    });

    it('cuts a chamfer as its two 45 degree endpoints', () => {
        const chamfer = { type: 'ease', edge: 'l0', profile: 'chamfer', width: 0.125 } as EaseOp;
        expect(easeProfile(chamfer, THICKNESS)).toEqual([
            { depth: 0, inset: 0.125 },
            { depth: 0.125, inset: 0 },
        ]);
    });

    it('sizes a bullnose from the stock and rounds both arrises', () => {
        const bullnose = { type: 'ease', edge: 'w0', profile: 'bullnose' } as EaseOp;
        expect(easeSize(bullnose, THICKNESS)).toBe(THICKNESS / 2);
        expect(easeFaces(bullnose)).toEqual(['front', 'back']);

        const eased = easesByEdge([bullnose], THICKNESS, SIZE);
        const edge = eased.get('w0')!;
        // The two quarter-rounds meet in the middle: half the thickness of cut from each side.
        const frontProfile = edge.front[0].profile;
        const backProfile = edge.back[0].profile;
        expect(frontProfile[frontProfile.length - 1].depth).toBeCloseTo(THICKNESS / 2, 9);
        expect(backProfile[backProfile.length - 1].depth).toBeCloseTo(THICKNESS / 2, 9);
    });

    it('allows a one-face profile the whole thickness but a two-face profile only half', () => {
        expect(maxEaseSize(roundover(1), THICKNESS)).toBe(THICKNESS / 2);
        expect(maxEaseSize(roundover(1, 'front'), THICKNESS)).toBe(THICKNESS);
    });

    it('clamps an oversized profile instead of folding the board inside out', () => {
        const profile = easeProfile(roundover(4), THICKNESS);
        expect(profile[0].inset).toBeCloseTo(THICKNESS / 2, 9);
    });

    it('eases only the named face when one is given', () => {
        const eased = easesByEdge([roundover(0.25, 'front')], THICKNESS, SIZE);
        expect(eased.get('w1')!.front).not.toHaveLength(0);
        expect(eased.get('w1')!.back).toHaveLength(0);
    });

    it('keeps the deeper cut where two passes on one arris overlap', () => {
        const eased = easesByEdge([roundover(0.125), roundover(0.375)], THICKNESS, SIZE);
        const cuts = eased.get('w1')!.front;
        expect(cuts).toHaveLength(2);
        expect(insetOf(cuts, 0, 6)).toBeCloseTo(0.375, 9);
    });

    it('interpolates between samples and reads zero past the profile', () => {
        const chamfer = easeProfile(
            { type: 'ease', edge: 'l0', profile: 'chamfer', width: 0.2 } as EaseOp,
            THICKNESS,
        );
        expect(insetAt(chamfer, 0.1)).toBeCloseTo(0.1, 9);
        expect(insetAt(chamfer, 0.3)).toBe(0);
        expect(insetAt([], 0)).toBe(0);
    });

    it('runs the whole edge when no run is named', () => {
        const cut = easesByEdge([roundover(0.25)], THICKNESS, SIZE).get('w1')!.front[0];
        // w1 is a w-edge, so its chord is the part's width and the run spans it end to end.
        expect([cut.from, cut.to]).toEqual([0, SIZE.w]);
        // Both ends are open, so the taper is never applied — the bit leaves the wood at full depth.
        expect(cut.openFrom && cut.openTo).toBe(true);
        expect(runFactor(cut, 0)).toBe(1);
        expect(runFactor(cut, SIZE.w)).toBe(1);
    });

    it('tapers a stopped end and leaves a through end square to the edge', () => {
        const leg = { type: 'ease', edge: 'w1', profile: 'roundover', radius: 0.25, to: 8 } as EaseOp;
        const cut = easesByEdge([leg], THICKNESS, SIZE).get('w1')!.front[0];
        expect(cut.openFrom).toBe(true);
        expect(cut.openTo).toBe(false);
        expect(cut.runOut).toBeCloseTo(0.25, 9);

        // Full depth right off the open end, full depth through the middle…
        expect(runFactor(cut, 0)).toBe(1);
        expect(runFactor(cut, 4)).toBe(1);
        // …then the taper across the last radius, and nothing past the stop.
        expect(runFactor(cut, 7.875)).toBeCloseTo(0.5, 9);
        expect(runFactor(cut, 8)).toBe(0);
        expect(runFactor(cut, 9)).toBe(0);
    });

    it('lets two run-outs meet when the stopped pass is shorter than two tapers', () => {
        const stub = {
            type: 'ease',
            edge: 'l0',
            profile: 'roundover',
            radius: 0.25,
            from: 4,
            to: 4.3,
        } as EaseOp;
        const cut = easesByEdge([stub], THICKNESS, SIZE).get('l0')!.front[0];
        // The bit never reaches full depth — which is what happens in the wood.
        expect(cut.runOut).toBeCloseTo(0.15, 9);
        expect(runFactor(cut, 4.15)).toBeCloseTo(1, 9);
        expect(runFactor(cut, 4)).toBe(0);
    });

    it('cuts nothing outside a stopped run, at any depth', () => {
        const stopped = {
            type: 'ease',
            edge: 'l0',
            profile: 'roundover',
            radius: 0.25,
            from: 6,
            to: 18,
        } as EaseOp;
        const cuts = easesByEdge([stopped], THICKNESS, SIZE).get('l0')!.front;
        expect(insetOf(cuts, 0, 2)).toBe(0);
        expect(insetOf(cuts, 0, 12)).toBeCloseTo(0.25, 9);
        expect(insetOf(cuts, 0, 22)).toBe(0);
    });

    it('marks a vertex where each pass starts, tops out, falls away, and ends', () => {
        const stopped = {
            type: 'ease',
            edge: 'l0',
            profile: 'roundover',
            radius: 0.25,
            from: 6,
            to: 18,
        } as EaseOp;
        const cuts = easesByEdge([stopped], THICKNESS, SIZE).get('l0')!.front;
        expect(runBreakpoints(cuts)).toEqual([6, 6.25, 17.75, 18]);

        // A through pass turns nowhere in between — just its two ends.
        const through = easesByEdge([roundover(0.25)], THICKNESS, SIZE).get('w1')!.front;
        expect(runBreakpoints(through)).toEqual([0, SIZE.w]);
    });

    it('measures the run along the edge it names (§3.1 chord)', () => {
        expect(easeChord('l0', SIZE)).toBe(SIZE.l);
        expect(easeChord('w1', SIZE)).toBe(SIZE.w);
    });

    it('names the bit a woodworker would reach for', () => {
        const inch = (n: number): string => `${n}"`;
        expect(easeLabel(roundover(0.25), THICKNESS, inch)).toBe('0.25" roundover');
        expect(easeLabel({ type: 'ease', edge: 'w0', profile: 'bullnose' } as EaseOp, THICKNESS, inch)).toBe(
            'bullnose',
        );
    });
});
