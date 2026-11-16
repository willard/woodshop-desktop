/**
 * The five-step editor tour: orbit, select, drag, the cut list, export. A small card walks
 * through them; a step that is about a control rings it. Skippable at any point (Esc too).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Step {
    title: string;
    body: string;
    /** `data-testid` of the control the step is about, ringed while it shows. */
    target?: string;
}

export const TOUR_STEPS: readonly Step[] = [
    {
        title: 'Look around',
        body: 'Drag empty space to turn the model. Scroll (or pinch) to zoom; right-drag, or drag with two fingers, to pan.',
    },
    {
        title: 'Select a part',
        body: 'Click a part to select it. Its size, material, cuts and hardware show in the inspector on the right. Click a knob or hinge to select just that piece.',
    },
    {
        title: 'Move it',
        body: 'Drag a part to move it: it snaps to the faces and edges around it. Hold Shift to lift it, use the arrow keys to nudge it, and ⌘Z (Ctrl+Z) to undo.',
    },
    {
        title: 'The cut list',
        body: 'Every board and sheet you need, laid out to cut with the least waste, plus the hardware to buy. It updates as you design.',
        target: 'cutlist-toggle',
    },
    {
        title: 'Take it to the shop',
        body: 'This menu exports a printable PDF plan, the cut list as a spreadsheet, and full-size templates; the cut list has PDF and CSV buttons too. Re-run this tour any time from Help.',
        target: 'toolbar-overflow-toggle',
    },
];

function useTargetRect(testId: string | undefined): DOMRect | null {
    const [rect, setRect] = useState<DOMRect | null>(null);
    useLayoutEffect(() => {
        if (testId === undefined) {
            setRect(null);
            return;
        }
        let frame = 0;
        const measure = () => {
            const el = document.querySelector(`[data-testid="${testId}"]`);
            const next = el?.getBoundingClientRect() ?? null;
            setRect((prev) =>
                prev !== null &&
                next !== null &&
                prev.x === next.x &&
                prev.y === next.y &&
                prev.width === next.width &&
                prev.height === next.height
                    ? prev
                    : next,
            );
            frame = requestAnimationFrame(measure);
        };
        measure();
        return () => cancelAnimationFrame(frame);
    }, [testId]);
    return rect;
}

export function GuidedTour({ onClose }: { onClose: (finished: boolean) => void }) {
    const [index, setIndex] = useState(0);
    const step = TOUR_STEPS[index];
    const last = index === TOUR_STEPS.length - 1;
    const rect = useTargetRect(step.target);
    const next = useRef<HTMLButtonElement>(null);

    useEffect(() => next.current?.focus(), [index]);

    const skip = useCallback(() => onClose(false), [onClose]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            skip();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [skip]);

    return (
        <>
            {rect !== null && rect.width > 0 && (
                <div
                    className="ring-accent pointer-events-none fixed z-40 rounded-lg ring-2 ring-offset-2 ring-offset-transparent transition-all"
                    style={{
                        left: rect.x - 2,
                        top: rect.y - 2,
                        width: rect.width + 4,
                        height: rect.height + 4,
                    }}
                    data-testid="tour-ring"
                />
            )}
            <div
                role="dialog"
                aria-label="Guided tour"
                aria-describedby="tour-body"
                className="bg-surface-1/95 border-fg/12 absolute top-16 left-1/2 z-40 w-[min(92vw,380px)] -translate-x-1/2 rounded-2xl border p-4 shadow-xl backdrop-blur"
                data-testid="tour"
            >
                <div className="text-faint mb-1 text-xs" data-testid="tour-progress">
                    Step {index + 1} of {TOUR_STEPS.length}
                </div>
                <h2 className="text-fg-strong mb-1 text-[15px] font-semibold" data-testid="tour-title">
                    {step.title}
                </h2>
                <p id="tour-body" className="text-muted mb-4 text-[13px] leading-snug">
                    {step.body}
                </p>
                <div className="flex items-center gap-2">
                    <button
                        className="text-muted hover:text-fg-strong mr-auto rounded-md px-1 py-1 text-[13px]"
                        onClick={skip}
                        data-testid="tour-skip"
                    >
                        {last ? 'Close' : 'Skip tour'}
                    </button>
                    {index > 0 && (
                        <button
                            className="border-fg/12 hover:bg-fg/5 rounded-lg border px-3 py-1.5 text-[13px]"
                            onClick={() => setIndex(index - 1)}
                            data-testid="tour-back"
                        >
                            Back
                        </button>
                    )}
                    <button
                        ref={next}
                        className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-1.5 text-[13px] font-semibold"
                        onClick={() => (last ? onClose(true) : setIndex(index + 1))}
                        data-testid="tour-next"
                    >
                        {last ? 'Done' : 'Next'}
                    </button>
                </div>
            </div>
        </>
    );
}
