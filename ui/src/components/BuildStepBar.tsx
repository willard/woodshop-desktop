/**
 * Step through the build over the 3D view: the parts up to the step show, the rest hide, and the
 * step's new parts are outlined. Shared by the editor and the exported plan (sized for a tablet).
 */
import type { AssemblyStep } from '@/cutlist';

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
}: {
    steps: readonly AssemblyStep[];
    index: number;
    /** A step to show, or null to show the whole piece again. */
    onStep: (index: number | null) => void;
}) {
    const step = steps[index];
    if (step === undefined) return null;
    const btn =
        'border-fg/10 text-fg/80 enabled:hover:bg-fg/[0.07] h-8 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-sm';
    return (
        <div
            className="bg-surface-1/95 border-fg/10 absolute right-3 bottom-3 left-3 z-20 rounded-xl border p-3 shadow-lg backdrop-blur"
            data-testid="build-step-bar"
            role="region"
            aria-label="Build step"
        >
            <div
                className="text-accent text-[11px] font-semibold tracking-wider uppercase"
                data-testid="build-step-count"
            >
                Step {index + 1} of {steps.length}
            </div>
            <div className="text-fg-strong mt-0.5 text-sm font-semibold" data-testid="build-step-heading">
                {step.heading}
            </div>
            {step.lines.length > 0 && (
                <ul className="text-fg/70 mt-1 space-y-0.5 text-xs pointer-coarse:text-sm">
                    {step.lines.map((line, i) => (
                        <li key={i}>{line}</li>
                    ))}
                </ul>
            )}
            <div className="mt-2.5 flex gap-1.5">
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
                    disabled={index === steps.length - 1}
                    onClick={() => onStep(index + 1)}
                >
                    Next
                </button>
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
