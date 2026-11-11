/** Choose size, orientation and count before a preset part is added. Nothing is added until Add. */
import { useState } from 'react';
import { PART_PRESETS, type AddPartOptions, type Orientation } from '@/engine';
import { Modal } from './Modal';
import { getUnits, len, lenValue, parseLen } from '@/lib/display';

const ORIENTATIONS: { value: Orientation; label: string; hint: string }[] = [
    { value: 'upright', label: 'Upright', hint: 'Standing on end, like a leg' },
    { value: 'onEdge', label: 'On edge', hint: 'Standing on its long edge, like an apron' },
    { value: 'flat', label: 'Flat', hint: 'Face up, like a shelf or a top' },
];

export function AddPartDialog({
    options,
    onAdd,
    onClose,
}: {
    options: AddPartOptions;
    onAdd: (o: AddPartOptions) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<AddPartOptions>({ ...options });
    const [lengthText, setLengthText] = useState(lenValue(options.l));
    const [widthText, setWidthText] = useState(lenValue(options.w));
    const length = parseLen(lengthText);
    const width = parseLen(widthText);
    const valid =
        length !== null && length > 0 && length <= 240 && width !== null && width > 0 && width <= 240;
    const preset = PART_PRESETS[draft.kind];

    const how = ORIENTATIONS.find((o) => o.value === draft.orientation)!.label.toLowerCase();
    const summary = !valid
        ? `Enter a length and width (${getUnits() === 'metric' ? '19, 38, 450' : '3/4, 1 1/2, 18'}).`
        : draft.qty > 1
          ? `${draft.qty} × ${preset.label}, ${len(length!)} × ${len(width!)}, ${how}`
          : `One ${preset.label.toLowerCase()}, ${len(length!)} × ${len(width!)}, ${how}`;

    const submit = () => valid && onAdd({ ...draft, l: length!, w: width! });
    const setQty = (n: number) => setDraft({ ...draft, qty: Math.min(12, Math.max(1, n)) });
    const input =
        'bg-surface-2 focus:border-accent border-fg/10 h-10 w-full rounded-lg border px-2 text-center text-sm focus:outline-none';

    return (
        <Modal onClose={onClose} testId="add-part-dialog">
            <h2 className="mb-3 text-[15px] font-semibold">Add {preset.label.toLowerCase()}</h2>
            <div className="mb-3 flex items-end gap-2">
                <label className="flex-1">
                    <span className="text-muted mb-1 block text-[11px]">Length</span>
                    <input
                        autoFocus
                        value={lengthText}
                        onChange={(e) => setLengthText(e.target.value)}
                        className={input}
                        data-testid="add-length"
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                    />
                </label>
                <span className="text-muted pb-3">×</span>
                <label className="flex-1">
                    <span className="text-muted mb-1 block text-[11px]">Width</span>
                    <input
                        value={widthText}
                        onChange={(e) => setWidthText(e.target.value)}
                        className={input}
                        data-testid="add-width"
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                    />
                </label>
            </div>
            <div className="mb-3">
                <span className="text-muted mb-1 block text-[11px]">How it stands</span>
                <div className="flex gap-1">
                    {ORIENTATIONS.map((o) => (
                        <button
                            key={o.value}
                            className={`h-10 flex-1 rounded-lg border text-[12px] font-medium ${draft.orientation === o.value ? 'border-accent bg-accent/15 text-accent' : 'border-fg/10 text-muted hover:bg-fg/5'}`}
                            title={o.hint}
                            data-testid={`orientation-${o.value}`}
                            onClick={() => setDraft({ ...draft, orientation: o.value })}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mb-3">
                <span className="text-muted mb-1 block text-[11px]">How many</span>
                <div className="flex items-center gap-2">
                    <button
                        className="bg-surface-2 hover:bg-fg/10 h-10 w-10 flex-none rounded-lg text-lg"
                        data-testid="qty-down"
                        onClick={() => setQty(draft.qty - 1)}
                    >
                        −
                    </button>
                    <span className="flex-1 text-center text-sm font-semibold tabular-nums" data-testid="qty">
                        {draft.qty}
                    </span>
                    <button
                        className="bg-surface-2 hover:bg-fg/10 h-10 w-10 flex-none rounded-lg text-lg"
                        data-testid="qty-up"
                        onClick={() => setQty(draft.qty + 1)}
                    >
                        +
                    </button>
                </div>
            </div>
            <p className="text-muted mb-3 text-[11.5px]" data-testid="add-summary">
                {summary}
            </p>
            <div className="flex gap-2">
                <button
                    className="border-fg/10 text-fg/70 hover:bg-fg/5 h-10 flex-1 rounded-lg border text-[13px]"
                    onClick={onClose}
                >
                    Cancel
                </button>
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong h-10 flex-1 rounded-lg text-[13px] font-semibold disabled:opacity-40"
                    disabled={!valid}
                    data-testid="add-confirm"
                    onClick={submit}
                >
                    Add
                </button>
            </div>
        </Modal>
    );
}
