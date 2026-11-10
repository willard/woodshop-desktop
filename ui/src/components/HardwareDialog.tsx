/**
 * The hardware browser: the catalog by category, with search. Picking an item mounts it on the
 * chosen part, centred on its front face; the inspector then moves it to where it belongs.
 */
import { useState } from 'react';
import { catalog, type HardwareItem } from '@/hardware/catalog';
import { formatFraction } from '@/lib/fraction';
import { Modal } from './Modal';
import { PrimaryButton, Select, TextInput } from './form';

/** The two or three numbers a buyer checks first, in shop notation. */
export function keySize(item: HardwareItem): string {
    const m = item.model;
    const inches = (key: string) =>
        typeof m[key] === 'number' ? `${formatFraction(m[key] as number, 16)}"` : null;
    const parts: (string | null)[] = (() => {
        switch (m.shape) {
            case 'knob':
                return [
                    inches('diameter') && `${inches('diameter')} across`,
                    inches('projection') && `stands ${inches('projection')}`,
                ];
            case 'barPull':
            case 'archPull':
                return [
                    inches('length') && `${inches('length')} long`,
                    inches('projection') && `stands ${inches('projection')}`,
                ];
            case 'cupPull':
                return [inches('width') && `${inches('width')} wide`];
            case 'buttHinge':
                return [
                    inches('height') && `${inches('height')} tall`,
                    inches('width') && `${inches('width')} open`,
                ];
            case 'pianoHinge':
            case 'teeHinge':
            case 'lidStay':
            case 'flatPlate':
            case 'barrelBolt':
            case 'hasp':
            case 'block':
                return [inches('length') && `${inches('length')} long`];
            case 'caster':
                return [
                    inches('wheel') && `${inches('wheel')} wheel`,
                    inches('height') && `adds ${inches('height')} of height`,
                ];
            case 'leveler':
                return [
                    inches('base') && `${inches('base')} base`,
                    inches('height') && `adds ${inches('height')}`,
                ];
            case 'cornerBracket':
                return [inches('leg') && `${inches('leg')} legs`];
            case 'chestHandle':
                return [inches('width') && `${inches('width')} wide`];
            case 'hook':
                return [
                    inches('height') && `${inches('height')} tall`,
                    inches('projection') && `reaches ${inches('projection')}`,
                ];
            default:
                return [];
        }
    })();
    return parts.filter(Boolean).join(' · ');
}

export function HardwareDialog(props: {
    parts: { id: string; name: string }[];
    /** The part to mount on by default (the selection), if any. */
    partId: string | null;
    onAdd(itemId: string, partId: string): void;
    onClose(): void;
}) {
    const { categories, items } = catalog();
    const [category, setCategory] = useState<string>('pulls');
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState<string | null>(null);
    const [partId, setPartId] = useState<string>(props.partId ?? props.parts[0]?.id ?? '');

    // Slides belong to a drawer, not a part: they are chosen on the drawer itself.
    const placeable = items.filter((i) => i.placeable !== false);
    const q = query.trim().toLowerCase();
    const shown =
        q === ''
            ? placeable.filter((i) => i.category === category)
            : placeable.filter((i) => `${i.name} ${i.list} ${i.description ?? ''}`.toLowerCase().includes(q));
    const pickedItem = placeable.find((i) => i.id === picked) ?? null;
    const tabs = categories.filter((c) => placeable.some((i) => i.category === c.id));

    return (
        <Modal onClose={props.onClose} testId="hardware-dialog" className="max-w-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Add hardware</h2>
                <TextInput
                    h="md"
                    className="w-56"
                    placeholder="Search hardware"
                    value={query}
                    autoFocus
                    data-testid="hardware-search"
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            <div className="flex min-h-0 gap-3">
                <nav className="flex w-40 flex-none flex-col gap-0.5" aria-label="Hardware categories">
                    {tabs.map((c) => (
                        <button
                            key={c.id}
                            className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] ${q === '' && c.id === category ? 'bg-accent/15 text-accent font-semibold' : 'text-fg/70 hover:bg-fg/5'}`}
                            data-testid={`hardware-category-${c.id}`}
                            onClick={() => {
                                setCategory(c.id);
                                setQuery('');
                            }}
                        >
                            {c.name}
                        </button>
                    ))}
                </nav>

                <ul
                    className="border-fg/8 h-80 min-w-0 flex-1 overflow-y-auto rounded-lg border p-1"
                    data-testid="hardware-list"
                >
                    {shown.map((item) => (
                        <li key={item.id}>
                            <button
                                className={`w-full rounded-md px-2.5 py-2 text-left ${item.id === picked ? 'bg-accent/15' : 'hover:bg-fg/5'}`}
                                data-testid="hardware-item"
                                data-item={item.id}
                                onClick={() => setPicked(item.id)}
                                onDoubleClick={() => partId !== '' && props.onAdd(item.id, partId)}
                            >
                                <div className="text-[13px] font-medium">{item.name}</div>
                                <div className="text-muted text-[11.5px]">{keySize(item)}</div>
                            </button>
                        </li>
                    ))}
                    {shown.length === 0 && (
                        <li className="text-muted px-3 py-6 text-center text-sm">
                            Nothing matches “{query}”.
                        </li>
                    )}
                </ul>
            </div>

            <p className="text-muted mt-3 min-h-8 text-xs" data-testid="hardware-description">
                {pickedItem === null
                    ? 'Pick a piece to mount it on a part. Hinges, slides and pulls for a door or drawer are chosen on the door or drawer itself.'
                    : (pickedItem.description ?? `${pickedItem.name}. ${keySize(pickedItem)}.`)}
            </p>

            <div className="mt-3 flex items-end gap-2">
                <label className="min-w-0 flex-1">
                    <span className="text-muted mb-1 block text-[11.5px]">Mount on</span>
                    <Select
                        h="md"
                        value={partId}
                        data-testid="hardware-part"
                        onChange={(e) => setPartId(e.target.value)}
                    >
                        {props.parts.map((part) => (
                            <option key={part.id} value={part.id}>
                                {part.name}
                            </option>
                        ))}
                    </Select>
                </label>
                <button
                    className="border-fg/12 hover:bg-surface-2 h-9 rounded-lg border px-3 text-sm"
                    onClick={props.onClose}
                >
                    Cancel
                </button>
                <PrimaryButton
                    className="h-9 px-4 text-sm"
                    disabled={pickedItem === null || partId === ''}
                    data-testid="hardware-add"
                    onClick={() => pickedItem && props.onAdd(pickedItem.id, partId)}
                >
                    Add
                </PrimaryButton>
            </div>
        </Modal>
    );
}
