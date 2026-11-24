/**
 * Things to show (spec 1.22): props a piece holds but you don't build, such as the totes on a
 * tote rack. They are drawn in the 3D view and the 3D plan so a client sees the piece in use, and
 * never cut, bought or counted. Add one from the catalog, rest it on two parts (a tote's rim on
 * its runners) or type where it stands, and colour it.
 */
import { useEffect, useState } from 'react';
import type { Prop, Spec } from '@/spec';
import { catalog, findItem, itemName } from '@/hardware/catalog';
import { besideThePiece, restOn } from '@/spec/props';
import { lenValue, parseSignedLen, unitSuffix } from '@/lib/display';
import { uniquePropId, type PropPatch } from '@/engine';
import { Modal } from './Modal';
import { Field, PrimaryButton, SecondaryButton, Select, TextInput, onEnter } from './form';

export function PropsDialog(props: {
    spec: Spec;
    /** The prop to open on (one clicked in the view), if any. */
    focus: string | null;
    shown: boolean;
    onShow(shown: boolean): void;
    onAdd(prop: Prop): void;
    onUpdate(id: string, patch: PropPatch): void;
    onRemove(id: string): void;
    onClose(): void;
}) {
    const items = catalog().items.filter((i) => i.prop === true);
    const placed = props.spec.props ?? [];
    const [selected, setSelected] = useState<string | null>(props.focus ?? placed[0]?.id ?? null);
    const [itemId, setItemId] = useState(items[0]?.id ?? '');
    const current = placed.find((p) => p.id === selected) ?? null;
    const nameOf = (p: Prop) => p.name ?? (findItem(p.item) ? itemName(findItem(p.item)!) : p.item);

    const add = () => {
        const item = items.find((i) => i.id === itemId);
        if (item === undefined) return;
        const id = uniquePropId(props.spec, item.id);
        props.onAdd({ id, item: item.id, pos: besideThePiece(props.spec, item), rot: 0 });
        setSelected(id);
    };

    return (
        <Modal onClose={props.onClose} testId="props-dialog" className="max-w-2xl">
            <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Things to show</h2>
                <label className="text-muted flex items-center gap-1.5 text-xs">
                    <input
                        type="checkbox"
                        checked={props.shown}
                        data-testid="props-shown"
                        onChange={(e) => props.onShow(e.target.checked)}
                    />
                    Show them in the view
                </label>
            </div>
            <p className="text-muted mb-3 text-xs">
                What the piece holds, such as totes on a rack, so a client sees it in use. They are in the 3D
                view, the 3D plan and the 3D exports, and never in the cut list, the cost or the size.
            </p>

            <div className="flex min-h-0 gap-3">
                <div className="flex w-56 flex-none flex-col gap-2">
                    <ul
                        className="border-fg/8 h-64 overflow-y-auto rounded-lg border p-1"
                        data-testid="props-list"
                    >
                        {placed.map((p) => (
                            <li key={p.id}>
                                <button
                                    className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] ${p.id === selected ? 'bg-accent/15' : 'hover:bg-fg/5'}`}
                                    data-testid="prop-row"
                                    data-prop={p.id}
                                    onClick={() => setSelected(p.id)}
                                >
                                    {nameOf(p)}
                                </button>
                            </li>
                        ))}
                        {placed.length === 0 && (
                            <li className="text-muted px-3 py-6 text-center text-xs">Nothing yet.</li>
                        )}
                    </ul>
                    <div className="flex gap-2">
                        <Select
                            h="sm"
                            value={itemId}
                            data-testid="prop-item"
                            onChange={(e) => setItemId(e.target.value)}
                        >
                            {items.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {itemName(item)}
                                </option>
                            ))}
                        </Select>
                        <PrimaryButton className="flex-none px-3" data-testid="prop-add" onClick={add}>
                            Add
                        </PrimaryButton>
                    </div>
                </div>

                <div className="min-w-0 flex-1">
                    {current === null ? (
                        <p className="text-muted px-2 py-6 text-center text-sm">
                            Add a tote, then rest it on its runners.
                        </p>
                    ) : (
                        <PropEditor
                            key={current.id}
                            spec={props.spec}
                            prop={current}
                            onUpdate={(patch) => props.onUpdate(current.id, patch)}
                            onDuplicate={() => {
                                const id = uniquePropId(props.spec, current.item);
                                props.onAdd({ ...current, id, name: undefined });
                                setSelected(id);
                            }}
                            onRemove={() => {
                                const index = placed.findIndex((p) => p.id === current.id);
                                props.onRemove(current.id);
                                setSelected(placed[index + 1]?.id ?? placed[index - 1]?.id ?? null);
                            }}
                        />
                    )}
                </div>
            </div>

            <div className="mt-3 flex justify-end">
                <SecondaryButton
                    className="h-9 px-4 text-sm"
                    data-testid="props-done"
                    onClick={props.onClose}
                >
                    Done
                </SecondaryButton>
            </div>
        </Modal>
    );
}

function PropEditor(props: {
    spec: Spec;
    prop: Prop;
    onUpdate(patch: PropPatch): void;
    onDuplicate(): void;
    onRemove(): void;
}) {
    const { prop, spec } = props;
    const item = findItem(prop.item);
    const [name, setName] = useState(prop.name ?? '');
    const [pos, setPos] = useState(prop.pos.map((n) => lenValue(n)));
    useEffect(() => setPos(prop.pos.map((n) => lenValue(n))), [prop.pos]);
    const parts = [...spec.parts].sort((a, b) => a.name.localeCompare(b.name));
    const [railA, setRailA] = useState('');
    const [railB, setRailB] = useState('');
    const resting = item && railA !== '' && railB !== '' ? restOn(spec, item, railA, railB) : null;
    const commitPos = () => {
        const next = pos.map((v) => parseSignedLen(v));
        if (next.some((n) => n === null)) {
            setPos(prop.pos.map((n) => lenValue(n)));
            return;
        }
        props.onUpdate({ pos: next as number[] });
    };
    const axes = ['Across (X)', 'Height (Y)', 'Depth (Z)'];
    const colour = (key: 'color' | 'accent') => prop[key] ?? String(item?.model[key] ?? '#808080');

    return (
        <div data-testid="prop-editor">
            <Field label="Name" className="mb-2.5">
                <TextInput
                    h="md"
                    value={name}
                    placeholder={item ? itemName(item) : prop.item}
                    data-testid="prop-name"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() =>
                        props.onUpdate({ name: name.trim() === '' ? undefined : name.trim().slice(0, 60) })
                    }
                    onKeyDown={onEnter(() => (document.activeElement as HTMLElement | null)?.blur())}
                />
            </Field>

            <div className="border-fg/8 mb-2.5 rounded-lg border p-2">
                <div className="text-muted mb-1.5 text-xs">
                    Rest it on two parts{item?.model.shape === 'tote' ? ': its rim on a pair of runners' : ''}
                </div>
                <div className="flex gap-2">
                    {[
                        [railA, setRailA, 'prop-rest-a'] as const,
                        [railB, setRailB, 'prop-rest-b'] as const,
                    ].map(([value, set, testId]) => (
                        <Select
                            key={testId}
                            value={value}
                            data-testid={testId}
                            onChange={(e) => set(e.target.value)}
                        >
                            <option value="">Choose a part</option>
                            {parts.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </Select>
                    ))}
                    <PrimaryButton
                        className="flex-none px-3"
                        disabled={resting === null}
                        data-testid="prop-rest"
                        onClick={() => resting && props.onUpdate({ pos: resting.pos, rot: resting.rot })}
                    >
                        Rest
                    </PrimaryButton>
                </div>
                {railA !== '' && railB !== '' && resting === null && (
                    <p className="text-warn-fg mt-1.5 text-xs">
                        Those two don't run side by side with a gap between.
                    </p>
                )}
                {resting !== null &&
                    (resting.problems.length === 0 ? (
                        <p className="text-muted mt-1.5 text-xs" data-testid="prop-fit">
                            It fits between them.
                        </p>
                    ) : (
                        <ul className="text-warn-fg mt-1.5 text-xs" data-testid="prop-fit">
                            {resting.problems.map((p) => (
                                <li key={p}>{p}</li>
                            ))}
                        </ul>
                    ))}
            </div>

            <div className="mb-2.5 grid grid-cols-4 gap-2">
                {axes.map((label, i) => (
                    <Field key={label} label={`${label} (${unitSuffix()})`}>
                        <TextInput
                            value={pos[i]}
                            inputMode="decimal"
                            data-testid={`prop-pos-${i}`}
                            onChange={(e) => setPos(pos.map((v, j) => (j === i ? e.target.value : v)))}
                            onBlur={commitPos}
                            onKeyDown={onEnter(commitPos)}
                        />
                    </Field>
                ))}
                <Field label="Turn">
                    <Select
                        value={String(prop.rot ?? 0)}
                        data-testid="prop-rot"
                        onChange={(e) => props.onUpdate({ rot: Number(e.target.value) })}
                    >
                        {[0, 90, 180, -90].map((r) => (
                            <option key={r} value={r}>
                                {r}°
                            </option>
                        ))}
                        {![0, 90, 180, -90].includes(prop.rot ?? 0) && (
                            <option value={prop.rot}>{prop.rot}°</option>
                        )}
                    </Select>
                </Field>
            </div>
            <p className="text-muted mb-2.5 text-xs">The position is the middle of its bottom.</p>

            <div className="mb-3 flex items-center gap-4">
                {(
                    [
                        ['color', item?.model.shape === 'tote' ? 'Base' : 'Colour'],
                        ['accent', item?.model.shape === 'tote' ? 'Lid' : 'Second colour'],
                    ] as const
                ).map(([key, label]) => (
                    <label key={key} className="text-muted flex items-center gap-1.5 text-xs">
                        <input
                            type="color"
                            value={colour(key)}
                            data-testid={`prop-${key}`}
                            className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                            onChange={(e) => props.onUpdate({ [key]: e.target.value })}
                        />
                        {label}
                    </label>
                ))}
                {(prop.color !== undefined || prop.accent !== undefined) && (
                    <button
                        className="text-accent text-xs hover:underline"
                        data-testid="prop-colour-reset"
                        onClick={() => props.onUpdate({ color: undefined, accent: undefined })}
                    >
                        As sold
                    </button>
                )}
            </div>

            <div className="flex gap-2">
                <SecondaryButton className="px-3" data-testid="prop-duplicate" onClick={props.onDuplicate}>
                    Duplicate
                </SecondaryButton>
                <SecondaryButton className="px-3" data-testid="prop-remove" onClick={props.onRemove}>
                    Remove
                </SecondaryButton>
            </div>
        </div>
    );
}
