/**
 * The assembly video's script: when each step's parts come in, what the caption says, and where
 * the camera is. Pure, so the timing can be tested without WebGL or a video encoder.
 *
 * The film has three acts. It opens on the finished piece, turning, with its name and size; it
 * then builds the piece step by step, in the order the PDF plan prints, each step's parts flying
 * in to where they belong under a caption saying what to do; and it ends by pulling the piece
 * apart and closing it up again, with a closing card.
 */
import type { AssemblyStep } from '@/cutlist';

export interface FilmLength {
    id: 'short' | 'standard' | 'long';
    label: string;
    seconds: number;
}

export const FILM_LENGTHS: readonly FilmLength[] = [
    { id: 'short', label: 'About 15 seconds', seconds: 15 },
    { id: 'standard', label: 'About 30 seconds', seconds: 30 },
    { id: 'long', label: 'About 1 minute', seconds: 60 },
];

export interface FilmShape {
    id: 'tall' | 'square' | 'wide';
    label: string;
    width: number;
    height: number;
}

/** Tall for Reels, TikTok and Shorts; square for a feed; wide for YouTube. */
export const FILM_SHAPES: readonly FilmShape[] = [
    { id: 'tall', label: 'Tall 9:16 (Reels, TikTok, Shorts)', width: 1080, height: 1920 },
    { id: 'square', label: 'Square 1:1 (feed post)', width: 1080, height: 1080 },
    { id: 'wide', label: 'Wide 16:9 (YouTube)', width: 1920, height: 1080 },
];

/** A step is never shorter than this, however many there are: the caption has to be read. */
export const MIN_STEP_SECONDS = 1.2;
/** Of each step, the share spent bringing its parts in; the rest holds still to read. */
const ARRIVE_SHARE = 0.55;
/** How far round the piece the camera travels over the whole film, in degrees. */
const ORBIT_DEGREES = 110;

export interface FilmStep {
    /** "Step 3 of 9". */
    counter: string;
    heading: string;
    /** The step's first line, when it says more than the heading. */
    detail: string | null;
    partIds: string[];
    start: number;
    end: number;
}

export interface FilmPlan {
    seconds: number;
    intro: number;
    steps: FilmStep[];
    /** When the closing explode begins. */
    finale: number;
}

/**
 * Lays the steps out over about `seconds`. The opening and closing take a fixed share, the
 * steps split the rest; a design with many steps runs longer rather than rush its captions.
 * Steps that put nothing in place (the hardware) keep their caption.
 */
export function planFilm(steps: readonly AssemblyStep[], seconds: number): FilmPlan {
    const intro = Math.min(3, seconds * 0.12);
    const outro = Math.min(4, seconds * 0.15);
    const each = Math.max(MIN_STEP_SECONDS, (seconds - intro - outro) / Math.max(1, steps.length));
    const filmSteps = steps.map((step, i) => ({
        counter: `Step ${i + 1} of ${steps.length}`,
        heading: step.heading,
        // A line the plan flags for the maker ("no joint recorded") is not for the audience.
        detail: step.lines.find((l) => !/no joint recorded/i.test(l)) ?? null,
        partIds: step.partIds,
        start: intro + i * each,
        end: intro + (i + 1) * each,
    }));
    const finale = intro + steps.length * each;
    return { seconds: finale + outro, intro, steps: filmSteps, finale };
}

export type Caption = { kind: 'title' } | { kind: 'step'; step: FilmStep } | { kind: 'end' };

export interface FilmPose {
    /**
     * How far each part has come in, 0 (not yet shown) to 1 (in place). Parts missing from the
     * map are in place: the opening and closing show the whole piece.
     */
    arrival: Map<string, number>;
    /** The closing pull-apart: 0 assembled, 1 fully exploded. */
    explode: number;
    /** The camera's turn round the piece, in degrees from where it starts. */
    orbit: number;
    /**
     * Which frame the camera keeps clear: 0 the top, for the title card; 1 the bottom, for the
     * step captions. It eases between the two as the film moves from act to act.
     */
    framing: number;
    caption: Caption;
}

/** Fast out, soft landing. */
export function easeOutCubic(x: number): number {
    const c = Math.min(1, Math.max(0, x));
    return 1 - (1 - c) ** 3;
}

function easeInOut(x: number): number {
    const c = Math.min(1, Math.max(0, x));
    return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** Where everything is at `t` seconds into the film. */
export function poseAt(plan: FilmPlan, t: number): FilmPose {
    const orbit = (ORBIT_DEGREES * Math.min(t, plan.seconds)) / plan.seconds;
    const framing =
        t < plan.finale ? easeInOut((t - (plan.intro - 0.6)) / 0.8) : 1 - easeInOut((t - plan.finale) / 0.8);
    if (t < plan.intro) {
        return { arrival: new Map(), explode: 0, orbit, framing, caption: { kind: 'title' } };
    }
    if (t >= plan.finale) {
        // Out to half exploded and back, then hold on the finished piece.
        const span = plan.seconds - plan.finale;
        const x = (t - plan.finale) / Math.max(span * 0.7, 1e-6);
        const explode = x >= 1 ? 0 : 0.5 * Math.sin(Math.PI * easeInOut(x));
        return { arrival: new Map(), explode, orbit, framing, caption: { kind: 'end' } };
    }
    const arrival = new Map<string, number>();
    let current = plan.steps[0];
    for (const step of plan.steps) {
        const progress =
            t < step.start ? 0 : easeOutCubic((t - step.start) / ((step.end - step.start) * ARRIVE_SHARE));
        for (const id of step.partIds) arrival.set(id, progress);
        if (t >= step.start) current = step;
    }
    return { arrival, explode: 0, orbit, framing, caption: { kind: 'step', step: current } };
}

/** Frames in the film at `fps`. */
export function frameCount(plan: FilmPlan, fps: number): number {
    return Math.max(1, Math.round(plan.seconds * fps));
}
