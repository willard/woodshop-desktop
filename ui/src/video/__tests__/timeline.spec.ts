import { describe, expect, it } from 'vitest';
import {
    FILL_SECONDS,
    MIN_STEP_SECONDS,
    SWATCH_BLEND,
    SWATCH_SECONDS,
    easeOutCubic,
    frameCount,
    paintAt,
    planFilm,
    poseAt,
    randomPaints,
    swatchCount,
} from '../timeline';
import type { AssemblyStep } from '@/cutlist';

const steps: AssemblyStep[] = [
    { heading: 'Start with Bottom', lines: [], partIds: ['p_bottom'], pieces: [], hardware: [] },
    {
        heading: 'Add Left Side and Right Side',
        lines: ['Left Side: 2 pocket screws from Bottom.'],
        partIds: ['p_l', 'p_r'],
        pieces: [],
        hardware: [],
    },
    {
        heading: 'Add Top',
        lines: ['Top: against Left Side (no joint recorded).'],
        partIds: ['p_top'],
        pieces: [],
        hardware: [],
    },
    { heading: 'Fit the hardware', lines: ['Pull on Top.'], partIds: [], pieces: [], hardware: [] },
];

describe('planFilm', () => {
    it('opens, builds step by step and closes within about the length asked for', () => {
        const plan = planFilm(steps, 30);
        expect(plan.seconds).toBeCloseTo(30);
        expect(plan.intro).toBeCloseTo(3);
        expect(plan.steps.map((s) => s.counter)).toEqual([
            'Step 1 of 4',
            'Step 2 of 4',
            'Step 3 of 4',
            'Step 4 of 4',
        ]);
        expect(plan.steps[0].start).toBeCloseTo(plan.intro);
        expect(plan.steps[3].end).toBeCloseTo(plan.finale);
        expect(frameCount(plan, 30)).toBe(900);
    });

    it('runs longer rather than rush a design with many steps', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            heading: `Add ${i}`,
            lines: [],
            partIds: [`p_${i}`],
            pieces: [],
            hardware: [],
        }));
        const plan = planFilm(many, 15);
        expect(plan.steps[0].end - plan.steps[0].start).toBeCloseTo(MIN_STEP_SECONDS);
        expect(plan.seconds).toBeGreaterThan(40 * MIN_STEP_SECONDS);
    });

    it('captions a step with its first line, but never a note meant for the maker', () => {
        const plan = planFilm(steps, 30);
        expect(plan.steps[0].detail).toBeNull();
        expect(plan.steps[1].detail).toBe('Left Side: 2 pocket screws from Bottom.');
        expect(plan.steps[2].detail).toBeNull();
    });
});

describe('poseAt', () => {
    const plan = planFilm(steps, 30);

    it('opens on the whole piece under its title', () => {
        const pose = poseAt(plan, 0);
        expect(pose.caption.kind).toBe('title');
        expect(pose.arrival.size).toBe(0);
        expect(pose.framing).toBe(0);
    });

    it("brings a step's parts in together, and later ones wait", () => {
        const second = plan.steps[1];
        const pose = poseAt(plan, second.start + 0.01);
        expect(pose.caption).toMatchObject({
            kind: 'step',
            step: { heading: 'Add Left Side and Right Side' },
        });
        expect(pose.arrival.get('p_bottom')).toBe(1);
        expect(pose.arrival.get('p_l')).toBeGreaterThan(0);
        expect(pose.arrival.get('p_l')).toBe(pose.arrival.get('p_r'));
        expect(pose.arrival.get('p_top')).toBe(0);
        expect(pose.framing).toBe(1);
        // By the end of its step, everything in it has landed.
        expect(poseAt(plan, second.end - 0.01).arrival.get('p_l')).toBe(1);
    });

    it('closes by pulling the piece apart and back, on the closing card', () => {
        const middle = poseAt(plan, plan.finale + (plan.seconds - plan.finale) * 0.35);
        expect(middle.caption.kind).toBe('end');
        expect(middle.explode).toBeGreaterThan(0.4);
        expect(poseAt(plan, plan.seconds - 0.01).explode).toBe(0);
        expect(poseAt(plan, plan.seconds - 0.01).framing).toBe(0);
    });

    it('turns the camera steadily', () => {
        expect(poseAt(plan, 0).orbit).toBe(0);
        expect(poseAt(plan, plan.seconds / 2).orbit).toBeCloseTo(55);
    });
});

describe('easeOutCubic', () => {
    it('starts fast and lands softly', () => {
        expect(easeOutCubic(0)).toBe(0);
        expect(easeOutCubic(1)).toBe(1);
        expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
        expect(easeOutCubic(2)).toBe(1);
    });
});

describe('a piece with props', () => {
    const plan = planFilm(steps, 30, true);

    it('opens with them in place, builds without them, and ends with them sliding in', () => {
        expect(plan.fill).not.toBeNull();
        expect(plan.seconds).toBeCloseTo(plan.fill! + FILL_SECONDS + 1);
        expect(poseAt(plan, 0).props).toBe(1);
        expect(poseAt(plan, plan.steps[1].start + 0.1).props).toBe(0);
        // The pull-apart is over before they come in.
        expect(poseAt(plan, plan.fill! - 0.01).explode).toBeCloseTo(0, 5);
        expect(poseAt(plan, plan.fill! - 0.01).props).toBe(0);
        expect(poseAt(plan, plan.fill! + FILL_SECONDS / 2).props).toBeCloseTo(0.5);
        expect(poseAt(plan, plan.seconds - 0.01).props).toBe(1);
        expect(poseAt(plan, plan.seconds - 0.01).caption.kind).toBe('end');
    });

    it('leaves a piece without props as it was', () => {
        expect(planFilm(steps, 30).fill).toBeNull();
        expect(planFilm(steps, 30).seconds).toBeCloseTo(30);
    });
});

describe('the colour swatches film', () => {
    /** A repeatable stand-in for Math.random. */
    function seeded(seed: number): () => number {
        let s = seed;
        return () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
    }

    it('fits about one colour a second, never fewer than four', () => {
        expect(swatchCount(15)).toBe(14);
        expect(swatchCount(30)).toBe(27);
        expect(swatchCount(2)).toBe(4);
    });

    it('picks colours at random, each clearly unlike the one before', () => {
        const paints = randomPaints(40, seeded(7));
        expect(paints).toHaveLength(40);
        for (const p of paints) expect(p).toMatch(/^#[0-9a-f]{6}$/);
        for (let i = 1; i < paints.length; i++) expect(paints[i]).not.toBe(paints[i - 1]);
        expect(new Set(paints).size).toBeGreaterThan(30);
        // Another run, another set.
        expect(randomPaints(10, seeded(8))).not.toEqual(randomPaints(10, seeded(7)));
    });

    it('holds each colour, then changes quickly to the next', () => {
        const paints = ['#111111', '#222222', '#333333'];
        expect(paintAt(paints, 0)).toEqual({ from: '#111111', to: '#111111', mix: 1 });
        expect(paintAt(paints, SWATCH_SECONDS + SWATCH_BLEND / 2)).toMatchObject({
            from: '#111111',
            to: '#222222',
        });
        expect(paintAt(paints, SWATCH_SECONDS + SWATCH_BLEND / 2).mix).toBeCloseTo(0.5);
        expect(paintAt(paints, SWATCH_SECONDS * 1.5)).toEqual({ from: '#111111', to: '#222222', mix: 1 });
        // Past the end it stays on the last.
        expect(paintAt(paints, 99).to).toBe('#333333');
    });
});
