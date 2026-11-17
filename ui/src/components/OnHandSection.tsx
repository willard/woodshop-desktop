/**
 * The cut list's "On hand" section: pieces left from other jobs that this design's materials can
 * use. The cut list cuts from them before it buys anything. Pieces are one list for every design
 * (the `offcuts` setting); this shows the ones that are this design's materials.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import type { CutList, Offcut } from '@/cutlist/types';
import { addOffcut, isOffcutOf, removeOffcuts, useOffcuts } from '@/cutlist/offcuts';
import { len, parseLen } from '@/lib/display';
import { plural } from '@/app/format';
import type { Spec } from '@/spec';

export function OnHandSection({ spec, cutList }: { spec: Spec; cutList: CutList }) {
    const all = useOffcuts();
    const stock = spec.materials.filter(
        (m) => m.type === 'sheet' || m.type === 'lumber' || m.type === 'round',
    );
    const mine = all.filter((o) => stock.some((m) => isOffcutOf(o, m)));
    const used = new Set(
        [...cutList.sheets, ...cutList.lumber].flatMap((p) => (p.offcuts ?? []).map((o) => o.id)),
    );
    const [materialId, setMaterialId] = useState(stock[0]?.id ?? '');
    const [lText, setLText] = useState('');
    const [wText, setWText] = useState('');
    const material = stock.find((m) => m.id === materialId) ?? stock[0];
    const sheet = material?.type === 'sheet';
    const l = parseLen(lText);
    const w = parseLen(wText);
    const valid = material !== undefined && l !== null && l > 0 && (!sheet || (w !== null && w > 0));

    function add(): void {
        if (!valid || material === undefined) return;
        void addOffcut(material, l!, sheet ? w! : undefined);
        setLText('');
        setWText('');
    }

    const describe = (o: Offcut) =>
        `${o.material}, ${o.w === undefined ? `${len(o.l)} long` : `${len(o.l)} × ${len(o.w)}`}`;
    const input =
        'bg-surface-2 border-fg/10 focus:border-accent h-7 w-full min-w-0 rounded-lg border px-2 text-xs focus:outline-none';

    if (stock.length === 0) return null;
    return (
        <div className="mb-4" data-testid="on-hand">
            <h3 className="text-muted mb-1 text-xs font-semibold tracking-wider uppercase">On hand</h3>
            <p className="text-faint mb-2 text-xs">
                Pieces left from other jobs. The cut list cuts from them before it has you buy more.
            </p>
            {mine.length > 0 && (
                <ul className="bg-surface-2 mb-2 rounded-lg px-3 py-1">
                    {mine.map((o) => (
                        <li
                            key={o.id}
                            className="border-fg/5 flex items-center gap-2 border-b py-1.5 text-xs last:border-0"
                            data-testid="on-hand-piece"
                        >
                            <span className="min-w-0 flex-1 truncate">{describe(o)}</span>
                            {used.has(o.id) && (
                                <span className="bg-accent/15 text-accent rounded-full px-2 py-0.5 font-semibold">
                                    used here
                                </span>
                            )}
                            <button
                                className="text-muted hover:text-fg"
                                aria-label={`Remove ${describe(o)}`}
                                onClick={() => void removeOffcuts([o.id])}
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {used.size > 0 && (
                <button
                    className="text-accent mb-2 text-xs font-semibold"
                    title="Once you've cut them, take the pieces this design uses off the list"
                    data-testid="on-hand-used-up"
                    onClick={() => void removeOffcuts([...used])}
                >
                    Cut them? Remove the {plural(used.size, 'piece')} used here
                </button>
            )}
            <div className="flex items-end gap-1.5">
                <label className="min-w-0 flex-[2]">
                    <span className="text-muted mb-0.5 block text-xs">Material</span>
                    <select
                        className={input}
                        value={material?.id}
                        data-testid="on-hand-material"
                        onChange={(e) => setMaterialId(e.target.value)}
                    >
                        {stock.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="min-w-0 flex-1">
                    <span className="text-muted mb-0.5 block text-xs">Length</span>
                    <input
                        className={input}
                        value={lText}
                        data-testid="on-hand-length"
                        onChange={(e) => setLText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && add()}
                    />
                </label>
                {sheet && (
                    <label className="min-w-0 flex-1">
                        <span className="text-muted mb-0.5 block text-xs">Width</span>
                        <input
                            className={input}
                            value={wText}
                            data-testid="on-hand-width"
                            onChange={(e) => setWText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && add()}
                        />
                    </label>
                )}
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong h-7 rounded-lg px-2.5 text-xs font-semibold disabled:opacity-50"
                    disabled={!valid}
                    aria-label="Add this piece on hand"
                    data-testid="on-hand-add"
                    onClick={add}
                >
                    Add
                </button>
            </div>
        </div>
    );
}
