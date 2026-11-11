/** Group panel: act on a group as a unit, or drill into a member. Presentational. */
import { useEffect, useRef, useState } from 'react';
import type { Group, Movable, Part } from '@/spec';
import { Field, SectionLabel, Select } from './form';
import { MovableFittings } from './HardwareFittings';
import { len } from '@/lib/display';

type Axis3 = 0 | 1 | 2;
const ROTATIONS: { axis: Axis3; label: string }[] = [
    { axis: 0, label: 'Rot X' },
    { axis: 1, label: 'Rot Y' },
    { axis: 2, label: 'Rot Z' },
];
const EDGE_LABELS = [
    { value: 'w0', label: 'w0 (low X / left)' },
    { value: 'w1', label: 'w1 (high X / right)' },
    { value: 'l0', label: 'l0 (low Y / bottom)' },
    { value: 'l1', label: 'l1 (high Y / top)' },
];

export interface GroupInspectorProps {
    group: Group;
    parts: Part[];
    movable: Movable | null;
    onRename(name: string): void;
    onRotate(axis: Axis3): void;
    onRotateBy(axis: Axis3, delta: number): void;
    onDuplicate(): void;
    onUngroup(): void;
    onFocus(): void;
    onHide(): void;
    onRemove(): void;
    onDrill(partId: string): void;
    onMakeDoor(): void;
    onUpdateMovable(patch: Record<string, unknown>): void;
    onDissolveMovable(): void;
    /** Start a new project holding just this group's parts. */
    onNewProject?(): void;
}

const btn = 'border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs';

export function GroupInspector(p: GroupInspectorProps) {
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const input = useRef<HTMLInputElement>(null);
    const name = p.group.name ?? 'Group';

    useEffect(() => setRenaming(false), [p.group]);
    useEffect(() => {
        if (renaming) input.current?.select();
    }, [renaming]);

    function commit(): void {
        if (!renaming) return;
        setRenaming(false);
        const next = nameDraft.trim();
        if (next !== '' && next !== name) p.onRename(next);
    }

    const size = (part: Part) => `${len(part.size.l)} × ${len(part.size.w)}`;

    return (
        <div data-testid="group-inspector">
            <div className="mb-1 flex items-center justify-between">
                {renaming ? (
                    <input
                        ref={input}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') setRenaming(false);
                        }}
                        className="border-accent w-full border-b bg-transparent text-[15px] font-semibold outline-none"
                        data-testid="rename-input"
                    />
                ) : (
                    <button
                        className="hover:bg-fg/5 -mx-1 truncate rounded px-1 text-[15px] font-semibold"
                        data-testid="rename-start"
                        title="Click to rename this group"
                        onClick={() => {
                            setNameDraft(name);
                            setRenaming(true);
                        }}
                    >
                        {name}
                    </button>
                )}
                <span className="bg-fg/10 text-fg/70 rounded-full px-2 py-0.5 text-[11.5px] font-semibold">
                    {p.parts.length} parts
                </span>
            </div>
            <div className="text-muted mb-4 text-xs">Click a member to edit it on its own.</div>

            <div className="mb-4 flex flex-col gap-1" data-testid="group-members">
                {p.parts.map((part) => (
                    <button
                        key={part.id}
                        className="bg-surface-2 hover:bg-fg/10 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left"
                        data-testid={`group-member-${part.id}`}
                        onClick={() => p.onDrill(part.id)}
                    >
                        <span className="text-fg/80 min-w-0 truncate text-xs">{part.name}</span>
                        <span className="text-muted flex-none text-[11px]">{size(part)}</span>
                    </button>
                ))}
            </div>

            <SectionLabel>Door</SectionLabel>
            {p.movable === null ? (
                <div className="mb-4" data-testid="group-movable-none">
                    <p className="text-muted mb-2 text-[11px]">
                        Hang this group on hardware so it swings open as a unit. The spec keeps the closed
                        position — the Open toggle is a view.
                    </p>
                    <button
                        className="hover:border-accent/60 border-fg/15 text-fg/65 h-9 w-full rounded-lg border border-dashed text-xs"
                        data-testid="group-make-door"
                        onClick={p.onMakeDoor}
                    >
                        Make a door
                    </button>
                </div>
            ) : (
                p.movable.kind === 'door' && (
                    <div className="bg-surface-2/60 mb-4 rounded-lg p-2.5" data-testid="group-movable-panel">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span
                                className="text-fg/80 text-[12.5px] font-semibold"
                                data-testid="group-movable-kind"
                            >
                                Door
                                <span className="text-muted text-[11px] font-normal">
                                    {' '}
                                    · {p.movable.partIds.length}{' '}
                                    {p.movable.partIds.length === 1 ? 'part' : 'parts'}
                                </span>
                            </span>
                            <button
                                className="text-muted hover:text-danger-fg text-[11px]"
                                data-testid="group-movable-dissolve"
                                onClick={p.onDissolveMovable}
                            >
                                Dissolve
                            </button>
                        </div>
                        <div className="mb-2 flex flex-col gap-1.5">
                            <Field label="Panel (reference part)">
                                <Select
                                    value={p.movable.panelPartId}
                                    data-testid="group-movable-panel-select"
                                    onChange={(e) => p.onUpdateMovable({ panelPartId: e.target.value })}
                                >
                                    {p.parts.map((part) => (
                                        <option key={part.id} value={part.id}>
                                            {part.name} ({size(part)})
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <div className="grid grid-cols-2 gap-2">
                                <Field label="Style">
                                    <Select
                                        value={p.movable.style}
                                        data-testid="group-movable-style"
                                        onChange={(e) => p.onUpdateMovable({ style: e.target.value })}
                                    >
                                        <option value="overlay">overlay</option>
                                        <option value="inset">inset</option>
                                    </Select>
                                </Field>
                                <Field label="Hinges on">
                                    <Select
                                        value={p.movable.hingeEdge}
                                        data-testid="group-movable-hinge-edge"
                                        onChange={(e) => p.onUpdateMovable({ hingeEdge: e.target.value })}
                                    >
                                        {EDGE_LABELS.map((e) => (
                                            <option key={e.value} value={e.value}>
                                                {e.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            </div>
                            <MovableFittings movable={p.movable} onChange={p.onUpdateMovable} />
                        </div>
                    </div>
                )
            )}

            <SectionLabel>Rotate group 90°</SectionLabel>
            <div className="mb-2 grid grid-cols-3 gap-2">
                {ROTATIONS.map((r) => (
                    <button
                        key={r.axis}
                        className={btn}
                        data-testid={`group-rot-${r.axis}`}
                        onClick={() => p.onRotate(r.axis)}
                    >
                        {r.label}
                    </button>
                ))}
            </div>
            <div className="mb-2.5 grid grid-cols-3 gap-2">
                {ROTATIONS.map((r) => (
                    <div key={r.axis} className="flex gap-1">
                        {[-15, 15].map((d) => (
                            <button
                                key={d}
                                className="border-fg/10 text-muted hover:bg-fg/5 h-8 flex-1 rounded-lg border text-[11px]"
                                data-testid={`group-rot-${r.axis}-${d < 0 ? 'minus' : 'plus'}`}
                                title={`${r.label} ${d < 0 ? '−' : '+'}15°`}
                                onClick={() => p.onRotateBy(r.axis, d)}
                            >
                                {d < 0 ? '−15' : '+15'}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
                <button className={btn} data-testid="group-duplicate" onClick={p.onDuplicate}>
                    Duplicate
                </button>
                <button className={btn} data-testid="group-ungroup" onClick={p.onUngroup}>
                    Ungroup
                </button>
            </div>
            {p.onNewProject && (
                <button
                    className={`${btn} mb-2 w-full`}
                    data-testid="group-new-project"
                    title="Copy this group's parts into a new project of their own, with their materials and joints."
                    onClick={p.onNewProject}
                >
                    New project from group
                </button>
            )}
            <div className="mb-2 grid grid-cols-2 gap-2">
                <button
                    className={btn}
                    data-testid="group-focus"
                    title="Edit this group in isolation like a new project."
                    onClick={p.onFocus}
                >
                    Focus group
                </button>
                <button
                    className={btn}
                    data-testid="group-hide"
                    title="Hide this group in the 3D view (H). Its parts are still cut and still built."
                    onClick={p.onHide}
                >
                    Hide from view
                </button>
            </div>
            <button
                className="border-danger/40 bg-danger/10 text-danger-fg hover:bg-danger/20 h-9 w-full rounded-lg border text-xs"
                data-testid="group-delete"
                onClick={p.onRemove}
            >
                Delete group
            </button>
        </div>
    );
}
