/**
 * Step through the build over the 3D view: the parts up to the step show, the rest hide, and the
 * step's new parts are outlined. Each step says what to have to hand, what to do and what to check
 * before moving on, and is ticked off when done. Shared by the editor and the exported plan (sized
 * for a phone or tablet in the shop).
 */
import type { AssemblyStep } from '@/cutlist';
import { stepKey, type BuildProgress } from '@/cutlist/progress';

/** Every part not yet put in place by the end of step `index`: the ones to hide. */
export function hiddenAtStep(
    partIds: readonly string[],
    steps: readonly AssemblyStep[],
    index: number,
): Set<string> {
    const placed = new Set(steps.slice(0, index + 1).flatMap((s) => s.partIds));
    return new Set(partIds.filter((id) => !placed.has(id)));
}

export function BuildStepBar({
    steps,
    index,
    onStep,
    progress,
}: {
    steps: readonly AssemblyStep[];
    index: number;
    /** A step to show, or null to show the whole piece again. */
    onStep: (index: number | null) => void;
    /** The steps ticked off; left out, steps cannot be ticked. */
    progress?: BuildProgress;
}) {
    const step = steps[index];
    if (step === undefined) return null;
    const keys = steps.map(stepKey);
    const isDone = (i: number) => progress?.done.has(keys[i]) ?? false;
    const doneCount = keys.filter((_, i) => isDone(i)).length;
    const last = index === steps.length - 1;
    const btn =
        'border-fg/10 text-fg/80 enabled:hover:bg-fg/[0.07] h-8 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-sm';
    const gather = step.pieces.length + step.hardware.length > 0;
    return (
        <div
            className="bg-surface-1/95 border-fg/10 absolute right-3 bottom-3 left-3 z-20 flex max-h-[60%] flex-col rounded-xl border shadow-lg backdrop-blur"
            data-testid="build-step-bar"
            role="region"
            aria-label="Build step"
        >
            <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-0">
                <div className="flex items-center gap-2">
                    <div
                        className="text-accent text-[11px] font-semibold tracking-wider uppercase"
                        data-testid="build-step-count"
                    >
                        Step {index + 1} of {steps.length}
                    </div>
                    {progress && doneCount > 0 && (
                        <>
                            <span className="text-faint text-[11px]" data-testid="build-step-done-count">
                                {doneCount === steps.length ? 'All done' : `${doneCount} done`}
                            </span>
                            <button
                                className="text-faint hover:text-fg-strong ml-auto text-[11px] underline-offset-2 hover:underline"
                                data-testid="build-step-reset"
                                onClick={() => progress.clear()}
                            >
                                Start over
                            </button>
                        </>
                    )}
                </div>
                {steps.length > 1 && (
                    <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5" role="list" aria-label="Steps">
                        {steps.map((s, i) => (
                            <button
                                key={i}
                                role="listitem"
                                className={`h-6 min-w-6 flex-none rounded-md border px-1 text-[11px] tabular-nums pointer-coarse:h-9 pointer-coarse:min-w-9 pointer-coarse:text-xs ${
                                    i === index
                                        ? 'border-accent text-fg-strong bg-accent/15'
                                        : isDone(i)
                                          ? 'border-fg/10 text-accent'
                                          : 'border-fg/10 text-fg/60 hover:bg-fg/[0.07]'
                                }`}
                                data-testid="build-step-chip"
                                aria-current={i === index ? 'step' : undefined}
                                aria-label={`Step ${i + 1}: ${s.heading}${isDone(i) ? ', done' : ''}`}
                                title={s.heading}
                                onClick={() => onStep(i)}
                            >
                                {isDone(i) ? '✓' : i + 1}
                            </button>
                        ))}
                    </div>
                )}
                <div className="text-fg-strong mt-1.5 text-sm font-semibold" data-testid="build-step-heading">
                    {step.heading}
                </div>
                {gather && (
                    <div className="mt-1.5" data-testid="build-step-gather">
                        <div className="text-faint text-[10px] font-semibold tracking-wider uppercase">
                            You need
                        </div>
                        <ul className="text-fg/80 mt-0.5 space-y-0.5 text-xs pointer-coarse:text-sm">
                            {step.pieces.map((p, i) => (
                                <li key={`p${i}`} className="flex gap-2">
                                    <span className="w-7 flex-none text-right tabular-nums">{p.qty} ×</span>
                                    <span className="min-w-0">
                                        {p.name}{' '}
                                        <span className="text-faint whitespace-nowrap">{p.size}</span>
                                    </span>
                                </li>
                            ))}
                            {step.hardware.map((h, i) => (
                                <li key={`h${i}`} className="flex gap-2">
                                    <span className="w-7 flex-none text-right tabular-nums">{h.qty} ×</span>
                                    <span className="min-w-0">{h.description}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {step.lines.length > 0 && (
                    <ul className="text-fg/70 mt-1.5 space-y-0.5 text-xs pointer-coarse:text-sm">
                        {step.lines.map((line, i) => (
                            <li key={i}>{line}</li>
                        ))}
                    </ul>
                )}
                {step.check && (
                    <p
                        className="border-accent/40 bg-accent/10 text-fg/85 mt-2 rounded-lg border px-2.5 py-1.5 text-xs pointer-coarse:text-sm"
                        data-testid="build-step-check"
                    >
                        <span className="text-fg-strong font-semibold">Check before you move on: </span>
                        {step.check}
                    </p>
                )}
            </div>
            <div className="flex flex-none flex-wrap gap-1.5 p-3 pt-2.5">
                <button
                    className={btn}
                    data-testid="build-step-prev"
                    disabled={index === 0}
                    onClick={() => onStep(index - 1)}
                >
                    Previous
                </button>
                <button
                    className={btn}
                    data-testid="build-step-next"
                    disabled={last}
                    onClick={() => onStep(index + 1)}
                >
                    Next
                </button>
                {progress &&
                    (isDone(index) ? (
                        <button
                            className={btn}
                            data-testid="build-step-mark"
                            aria-pressed="true"
                            onClick={() => progress.set([keys[index]], false)}
                        >
                            ✓ Done
                        </button>
                    ) : (
                        <button
                            className="bg-accent text-accent-ink hover:bg-accent-strong h-8 rounded-lg px-3 text-xs font-semibold pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-sm"
                            data-testid="build-step-mark"
                            aria-pressed="false"
                            onClick={() => {
                                progress.set([keys[index]], true);
                                if (!last) onStep(index + 1);
                            }}
                        >
                            {last ? 'Mark done' : 'Done, next step'}
                        </button>
                    ))}
                <button
                    className={`${btn} ml-auto`}
                    data-testid="build-step-done"
                    onClick={() => onStep(null)}
                >
                    Show all
                </button>
            </div>
        </div>
    );
}
