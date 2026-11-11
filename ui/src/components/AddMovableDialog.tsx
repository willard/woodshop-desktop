/** Size and style a door or drawer; sized from the selection's opening when there is one. */
import { useState } from 'react';
import type { MovableOptions } from '@/engine';
import { Modal } from './Modal';
import { getUnits, len, lenValue, parseLen } from '@/lib/display';

const HINGE_SIDES: { value: MovableOptions['hingeSide']; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
];

export function AddMovableDialog({
    options,
    detected,
    onAdd,
    onClose,
}: {
    options: MovableOptions;
    detected: boolean;
    onAdd: (o: MovableOptions) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<MovableOptions>({ ...options });
    const [widthText, setWidthText] = useState(lenValue(options.width));
    const [heightText, setHeightText] = useState(lenValue(options.height));
    const width = parseLen(widthText);
    const height = parseLen(heightText);
    const valid =
        width !== null && width > 0 && width <= 240 && height !== null && height > 0 && height <= 240;

    const fit =
        draft.style === 'overlay' ? 'lapping the opening 1/2" a side' : 'inside the opening, 1/16" reveal';
    const opening = valid ? `${len(width!)} × ${len(height!)}` : '';
    const summary = !valid
        ? `Enter the opening size (${getUnits() === 'metric' ? '305, 495' : '12, 19 1/2'}).`
        : draft.kind === 'door'
          ? `A door for a ${opening} opening, ${fit}, hinged on the ${draft.hingeSide}.`
          : `A drawer for a ${opening} opening, front ${fit}. The box gets 1/2" of slide clearance a side.`;

    const submit = () => valid && onAdd({ ...draft, width: width!, height: height! });
    const input =
        'bg-surface-2 focus:border-accent border-fg/10 h-10 w-full rounded-lg border px-2 text-center text-sm focus:outline-none';
    const select = 'bg-surface-2 border-fg/10 h-10 w-full rounded-lg border px-2 text-xs';

    return (
        <Modal onClose={onClose} testId="add-movable-dialog">
            <h2 className="mb-1 text-[15px] font-semibold">
                Add {draft.kind === 'door' ? 'a door' : 'a drawer'}
            </h2>
            <p className="text-muted mb-3 text-[11px]">
                {detected
                    ? 'Sized from the opening your selection frames.'
                    : 'Nothing selected — type the opening it has to fill.'}
            </p>
            <div className="mb-3 grid grid-cols-2 gap-2">
                {(['door', 'drawer'] as const).map((kind) => (
                    <button
                        key={kind}
                        className={`h-10 rounded-lg border text-xs font-semibold ${draft.kind === kind ? 'border-accent text-accent bg-accent/10' : 'border-fg/10 text-fg/65 hover:bg-fg/5'}`}
                        data-testid={`movable-kind-${kind}`}
                        onClick={() => setDraft({ ...draft, kind })}
                    >
                        {kind === 'door' ? 'Door' : 'Drawer'}
                    </button>
                ))}
            </div>
            <div className="mb-3 flex items-end gap-2">
                <label className="flex-1">
                    <span className="text-muted mb-1 block text-[11px]">Opening width</span>
                    <input
                        autoFocus
                        value={widthText}
                        onChange={(e) => setWidthText(e.target.value)}
                        className={input}
                        data-testid="movable-width"
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                    />
                </label>
                <span className="text-muted pb-3">×</span>
                <label className="flex-1">
                    <span className="text-muted mb-1 block text-[11px]">Opening height</span>
                    <input
                        value={heightText}
                        onChange={(e) => setHeightText(e.target.value)}
                        className={input}
                        data-testid="movable-height"
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                    />
                </label>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="block">
                    <span className="text-muted mb-1 block text-[11px]">Style</span>
                    <select
                        value={draft.style}
                        className={select}
                        data-testid="movable-dialog-style"
                        onChange={(e) =>
                            setDraft({ ...draft, style: e.target.value as MovableOptions['style'] })
                        }
                    >
                        <option value="overlay">overlay</option>
                        <option value="inset">inset</option>
                    </select>
                </label>
                {draft.kind === 'door' && (
                    <label className="block">
                        <span className="text-muted mb-1 block text-[11px]">Hinges on</span>
                        <select
                            value={draft.hingeSide}
                            className={select}
                            data-testid="movable-dialog-hinge"
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    hingeSide: e.target.value as MovableOptions['hingeSide'],
                                })
                            }
                        >
                            {HINGE_SIDES.map((s) => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
            <p className="text-muted mb-3 text-[11px]">{summary}</p>
            <div className="grid grid-cols-2 gap-2">
                <button
                    className="border-fg/10 text-fg/70 hover:bg-fg/5 h-10 rounded-lg border text-xs font-semibold"
                    data-testid="movable-cancel"
                    onClick={onClose}
                >
                    Cancel
                </button>
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong h-10 rounded-lg text-xs font-semibold disabled:opacity-40"
                    data-testid="movable-add"
                    disabled={!valid}
                    onClick={submit}
                >
                    Add
                </button>
            </div>
        </Modal>
    );
}
