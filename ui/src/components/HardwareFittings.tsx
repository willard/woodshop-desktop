/**
 * Inspector pieces for catalog hardware (spec 1.15): the hardware mounted on a part, and the
 * hinge, slide and pull a door or drawer uses.
 */
import { useEffect, useState } from 'react';
import type { HardwareMount, Movable, Part, Side } from '@/spec';
import { findItem, itemsForRole, sideExtent } from '@/hardware/catalog';
import type { HardwarePatch } from '@/engine';
import { formatFraction, parseFraction } from '@/lib/fraction';
import { Field, Select, TextInput } from './form';

const SIDES: { value: Side; label: string }[] = [
    { value: 'front', label: 'Front face' },
    { value: 'back', label: 'Back face' },
    { value: 'l0', label: 'Bottom edge (l0)' },
    { value: 'l1', label: 'Top edge (l1)' },
    { value: 'w0', label: 'Left end (w0)' },
    { value: 'w1', label: 'Right end (w1)' },
];

/** A length field that takes shop fractions and commits on blur or Enter. */
function LengthInput(props: {
    value: number;
    max: number;
    label: string;
    testId?: string;
    onCommit(v: number): void;
}) {
    const [draft, setDraft] = useState(formatFraction(props.value, 16));
    useEffect(() => setDraft(formatFraction(props.value, 16)), [props.value]);

    function commit(): void {
        const parsed = parseFraction(draft);
        if (parsed === null || parsed < 0) {
            setDraft(formatFraction(props.value, 16));
            return;
        }
        // Keep it on the part: a piece off the edge is never what was meant.
        const next = Math.min(parsed, props.max);
        if (next !== props.value) props.onCommit(next);
        else setDraft(formatFraction(props.value, 16));
    }

    return (
        <TextInput
            value={draft}
            aria-label={props.label}
            data-testid={props.testId}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
    );
}

export function PartHardware(props: {
    part: Part;
    thickness: number;
    mounts: HardwareMount[];
    onAdd(): void;
    onUpdate(id: string, patch: HardwarePatch): void;
    onRemove(id: string): void;
}) {
    return (
        <div className="mb-4" data-testid="part-hardware">
            {props.mounts.map((mount) => {
                const item = findItem(mount.item);
                const [maxX, maxY] = sideExtent(props.part, props.thickness, mount.side);
                const onFace = mount.side === 'front' || mount.side === 'back';
                return (
                    <div
                        key={mount.id}
                        className="bg-surface-2/60 mb-2 rounded-lg p-2.5"
                        data-testid="hardware-row"
                    >
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-fg/85 min-w-0 truncate text-[12.5px] font-semibold">
                                {item?.name ?? mount.item}
                            </span>
                            <span className="flex flex-none gap-2">
                                <button
                                    className="text-muted hover:text-fg-strong text-[11px]"
                                    title="Turn a quarter turn"
                                    data-testid="hardware-rotate"
                                    onClick={() =>
                                        props.onUpdate(mount.id, {
                                            rot: (((mount.rot ?? 0) + 90) % 360) as HardwareMount['rot'],
                                        })
                                    }
                                >
                                    Turn 90°
                                </button>
                                <button
                                    className="text-muted hover:text-danger-fg text-[11px]"
                                    data-testid="hardware-remove"
                                    onClick={() => props.onRemove(mount.id)}
                                >
                                    Remove
                                </button>
                            </span>
                        </div>
                        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
                            <Field label="On">
                                <Select
                                    value={mount.side}
                                    data-testid="hardware-side"
                                    onChange={(e) => {
                                        // A new side has a new size: start from its centre.
                                        const side = e.target.value as Side;
                                        const [a, b] = sideExtent(props.part, props.thickness, side);
                                        props.onUpdate(mount.id, { side, x: a / 2, y: b / 2 });
                                    }}
                                >
                                    {SIDES.map((s) => (
                                        <option key={s.value} value={s.value}>
                                            {s.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field
                                label={
                                    mount.side === 'w0' || mount.side === 'w1'
                                        ? 'Along width'
                                        : 'Along length'
                                }
                            >
                                <LengthInput
                                    value={mount.x}
                                    max={maxX}
                                    label="Position along the side, in inches"
                                    testId="hardware-x"
                                    onCommit={(x) => props.onUpdate(mount.id, { x })}
                                />
                            </Field>
                            <Field label={onFace ? 'Up from bottom' : 'From back'}>
                                <LengthInput
                                    value={mount.y}
                                    max={maxY}
                                    label="Position across the side, in inches"
                                    testId="hardware-y"
                                    onCommit={(y) => props.onUpdate(mount.id, { y })}
                                />
                            </Field>
                        </div>
                        {item === undefined && (
                            <p className="text-warn-fg mt-1.5 text-[11px]">
                                Not in this version's catalog; shown as a plain block.
                            </p>
                        )}
                    </div>
                );
            })}
            <button
                className="hover:border-accent/60 border-fg/15 text-fg/65 h-9 w-full rounded-lg border border-dashed text-xs"
                data-testid="add-hardware"
                onClick={props.onAdd}
            >
                + Add hardware
            </button>
        </div>
    );
}

/** Which hinge, slide and pull a door or drawer uses. "Standard" leaves the choice to the app. */
export function MovableFittings(props: { movable: Movable; onChange(patch: Record<string, unknown>): void }) {
    const m = props.movable;
    const pick = (field: 'hinge' | 'slide' | 'pull', label: string, standard: string, withNone = false) => {
        const current = (m as Record<string, unknown>)[field] as string | undefined;
        return (
            <Field label={label}>
                <Select
                    value={current ?? ''}
                    data-testid={`movable-${field}`}
                    onChange={(e) =>
                        props.onChange({ [field]: e.target.value === '' ? undefined : e.target.value })
                    }
                >
                    <option value="">{standard}</option>
                    {withNone && <option value="none">None</option>}
                    {itemsForRole(field).map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                    {/* Keep a choice this version's catalog doesn't know visible rather than silently swapping it. */}
                    {current !== undefined && current !== 'none' && findItem(current) === undefined && (
                        <option value={current}>{current}</option>
                    )}
                </Select>
            </Field>
        );
    };
    return (
        <div className="mt-2 grid grid-cols-2 gap-2" data-testid="movable-fittings">
            {m.kind === 'door'
                ? pick('hinge', 'Hinge', m.style === 'inset' ? 'Standard (butt)' : 'Standard (concealed)')
                : pick('slide', 'Slides', 'Standard (side-mount)')}
            {pick('pull', 'Pull', 'Standard (knob)', true)}
        </div>
    );
}
