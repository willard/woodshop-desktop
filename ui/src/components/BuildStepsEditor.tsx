/**
 * Your own build steps (spec 1.18): rename a step, add a note, move parts between steps, reorder,
 * add and remove steps, or go back to the suggested order. Every change is one undoable command
 * (`SetBuildSteps`); the fastening lines are still worked out for each part by the core.
 */
import { useState } from 'react';
import type { Spec } from '@/spec';
import type { AssemblyStep } from '@/cutlist';

export type BuildStep = NonNullable<NonNullable<Spec['meta']>['buildSteps']>[number];

/** The suggested order as editable steps: the hardware step is not one (it follows the parts). */
export function stepsFrom(order: readonly AssemblyStep[], spec: Spec): BuildStep[] {
    const own = spec.meta?.buildSteps;
    if (own !== undefined && own.length > 0) return own;
    return order
        .filter((s) => s.partIds.length > 0)
        .map((s) => ({ heading: s.heading, partIds: [...s.partIds] }));
}

export function BuildStepsEditor({
    spec,
    steps,
    onChange,
    onReset,
    onDone,
}: {
    spec: Spec;
    steps: BuildStep[];
    onChange: (steps: BuildStep[]) => void;
    onReset: () => void;
    onDone: () => void;
}) {
    const nameOf = (id: string) => spec.parts.find((p) => p.id === id)?.name ?? id;
    const update = (i: number, patch: Partial<BuildStep>) =>
        onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const move = (i: number, by: number) => {
        const next = [...steps];
        const [step] = next.splice(i, 1);
        next.splice(i + by, 0, step);
        onChange(next);
    };
    /** A step's parts go to the step before it (or after, for the first), so none is lost. */
    const remove = (i: number) => {
        const into = i === 0 ? 1 : i - 1;
        const next = steps.map((s, j) =>
            j === into ? { ...s, partIds: [...s.partIds, ...steps[i].partIds] } : s,
        );
        next.splice(i, 1);
        onChange(next);
    };
    const movePart = (id: string, from: number, to: number | 'new') => {
        const next = steps.map((s, j) =>
            j === from ? { ...s, partIds: s.partIds.filter((p) => p !== id) } : s,
        );
        if (to === 'new') next.push({ heading: `Add ${nameOf(id)}`, partIds: [id] });
        else next[to] = { ...next[to], partIds: [...next[to].partIds, id] };
        onChange(next);
    };
    const field =
        'bg-surface-1 border-fg/10 focus:border-accent w-full rounded-md border px-2 py-1 text-[13px] focus:outline-none';
    const small = 'text-fg/70 enabled:hover:bg-fg/[0.07] rounded px-1.5 py-0.5 text-xs disabled:opacity-35';

    return (
        <div className="space-y-2" data-testid="build-steps-editor">
            {steps.map((step, i) => (
                <div key={i} className="bg-surface-2 rounded-lg p-2.5" data-testid="build-step-edit">
                    <div className="mb-1.5 flex items-center gap-1">
                        <span className="text-muted w-5 text-xs">{i + 1}.</span>
                        <StepText
                            className={`${field} font-medium`}
                            value={step.heading}
                            label={`Step ${i + 1} heading`}
                            testId="build-step-heading-input"
                            onCommit={(heading) => heading !== '' && update(i, { heading })}
                        />
                        <button
                            className={small}
                            title="Move up"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                        >
                            ↑
                        </button>
                        <button
                            className={small}
                            title="Move down"
                            disabled={i === steps.length - 1}
                            onClick={() => move(i, 1)}
                        >
                            ↓
                        </button>
                        <button
                            className={small}
                            title="Remove this step (its parts join the step before)"
                            data-testid="build-step-remove"
                            disabled={steps.length === 1}
                            onClick={() => remove(i)}
                        >
                            ✕
                        </button>
                    </div>
                    <StepText
                        className={`${field} text-xs`}
                        value={step.note ?? ''}
                        label={`Step ${i + 1} note`}
                        placeholder="A note for this step (optional)"
                        testId="build-step-note-input"
                        onCommit={(note) => update(i, { note: note === '' ? undefined : note })}
                    />
                    <ul className="mt-1.5 space-y-1">
                        {step.partIds.map((id) => (
                            <li key={id} className="flex items-center gap-2 text-xs">
                                <span className="flex-1 truncate">{nameOf(id)}</span>
                                <select
                                    className="bg-surface-1 border-fg/10 rounded border px-1 py-0.5 text-xs"
                                    aria-label={`Step for ${nameOf(id)}`}
                                    data-testid="build-step-part-move"
                                    value={i}
                                    onChange={(e) =>
                                        movePart(
                                            id,
                                            i,
                                            e.target.value === 'new' ? 'new' : Number(e.target.value),
                                        )
                                    }
                                >
                                    {steps.map((_, j) => (
                                        <option key={j} value={j}>
                                            Step {j + 1}
                                        </option>
                                    ))}
                                    <option value="new">A new step</option>
                                </select>
                            </li>
                        ))}
                        {step.partIds.length === 0 && (
                            <li className="text-faint text-xs">
                                No parts: a step for glue-up, checks or finishing.
                            </li>
                        )}
                    </ul>
                </div>
            ))}
            <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                    className="border-fg/15 text-fg/80 hover:bg-fg/5 h-7 rounded-lg border px-2.5 text-xs"
                    data-testid="build-step-add"
                    onClick={() => onChange([...steps, { heading: 'A new step', partIds: [] }])}
                >
                    Add a step
                </button>
                <button
                    className="border-fg/15 text-fg/80 hover:bg-fg/5 h-7 rounded-lg border px-2.5 text-xs"
                    data-testid="build-steps-reset"
                    title="Forget your steps and use the order Woodshop suggests"
                    onClick={onReset}
                >
                    Reset to suggested
                </button>
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong ml-auto h-7 rounded-lg px-3 text-xs font-semibold"
                    data-testid="build-steps-done"
                    onClick={onDone}
                >
                    Done
                </button>
            </div>
        </div>
    );
}

/** A text box that commits on blur or Enter, so typing a heading is one undo, not one per key. */
function StepText(props: {
    className: string;
    value: string;
    label: string;
    placeholder?: string;
    testId: string;
    onCommit: (value: string) => void;
}) {
    const [draft, setDraft] = useState(props.value);
    const [was, setWas] = useState(props.value);
    if (props.value !== was) {
        // The step changed under us (undo, a move): show what it says now.
        setWas(props.value);
        setDraft(props.value);
    }
    const commit = () => {
        const value = draft.trim();
        if (value !== props.value) props.onCommit(value);
    };
    return (
        <input
            className={props.className}
            value={draft}
            aria-label={props.label}
            placeholder={props.placeholder}
            data-testid={props.testId}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
    );
}
