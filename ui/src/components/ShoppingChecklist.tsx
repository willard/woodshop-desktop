/**
 * One design's shopping list, to tick what you already have: its sheets and boards, its hardware,
 * and the tools for the build. It counts what is left to get and prints only that. Ticks are kept
 * per design on this device (tools once for every design: see `cutlist/have.ts`), and the
 * shopping page reads the same ticks.
 */
import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { boardSizes } from '@/cutlist/boards';
import { TOOLS, haveOf, setHave, useHaveChanges } from '@/cutlist/have';
import type { CutList, Tool } from '@/cutlist';
import { len } from '@/lib/display';
import { plural } from '@/app/format';
import { PrintPortal } from './PrintPortal';

/** One thing to get: in the design's list (`m:`/`h:`) or, for a tool, in `TOOLS`. */
export interface ShoppingItem {
    /** Where the tick is kept: the design's key, or `TOOLS`. */
    store: string;
    item: string;
    label: string;
    qty?: number;
    size?: string;
    /** Counted in what is left to get: everything but a nice-to-have tool. */
    needed: boolean;
    group: 'Materials' | 'Hardware' | 'Tools';
}

/** A design's things to get, its ticks kept under `key`. */
export function shoppingItems(cutList: CutList, tools: readonly Tool[], key: string): ShoppingItem[] {
    const items: ShoppingItem[] = [];
    for (const p of cutList.sheets) {
        if (p.sheetCount === 0) continue;
        items.push({
            store: key,
            item: `m:${p.materialId}`,
            label: p.materialName,
            qty: p.sheetCount,
            size: `${len(p.sheetSize.l)} × ${len(p.sheetSize.w)} sheet`,
            needed: true,
            group: 'Materials',
        });
    }
    for (const p of cutList.lumber) {
        if (p.stickCount === 0) continue;
        items.push({
            store: key,
            item: `m:${p.materialId}`,
            label: p.materialName,
            qty: p.stickCount,
            size: `${boardSizes(p, len)} long`,
            needed: true,
            group: 'Materials',
        });
    }
    for (const h of cutList.hardware) {
        items.push({
            store: key,
            item: `h:${h.key}`,
            label: h.description,
            qty: h.qty,
            needed: true,
            group: 'Hardware',
        });
    }
    for (const t of tools) {
        items.push({
            store: TOOLS,
            item: t.name,
            label: t.name,
            size: t.required ? t.detail : 'nice to have',
            needed: t.required,
            group: 'Tools',
        });
    }
    return items;
}

const GROUPS = ['Materials', 'Hardware', 'Tools'] as const;

/** The items still to get, as a list to take to the store. */
export function PrintShopping({
    title,
    items,
    onDone,
}: {
    title: string;
    items: readonly ShoppingItem[];
    onDone: () => void;
}) {
    return (
        <PrintPortal testId="shopping-printout" onDone={onDone}>
            <h1 className="mb-1 text-lg font-semibold">{title}</h1>
            <p className="mb-4 text-xs text-neutral-600">
                {items.length === 0 ? 'Nothing left to get.' : `${plural(items.length, 'thing')} to get.`}
            </p>
            {GROUPS.map((group) => {
                const rows = items.filter((i) => i.group === group);
                if (rows.length === 0) return null;
                return (
                    <div key={group} className="mb-4 break-inside-avoid">
                        <h2 className="mb-1 text-xs font-semibold tracking-wider text-neutral-600 uppercase">
                            {group}
                        </h2>
                        <ul>
                            {rows.map((i) => (
                                <li
                                    key={`${i.store}|${i.item}`}
                                    className="flex gap-2 border-b border-neutral-200 py-1"
                                    data-testid="shopping-print-row"
                                >
                                    <span>☐</span>
                                    <span className="w-8 text-right tabular-nums">{i.qty ?? ''}</span>
                                    <span className="flex-1">{i.label}</span>
                                    <span className="text-neutral-600">{i.size ?? ''}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </PrintPortal>
    );
}

export function ShoppingChecklist({
    title,
    items,
}: {
    /** What the printed list is called. */
    title: string;
    items: readonly ShoppingItem[];
}) {
    useHaveChanges();
    const [open, setOpen] = useState(false);
    const [printing, setPrinting] = useState(0);
    const donePrinting = useCallback(() => setPrinting(0), []);
    const has = (i: ShoppingItem) => haveOf(i.store).has(i.item);
    const toGet = items.filter((i) => i.needed && !has(i));
    if (items.length === 0) return null;
    return (
        <div className="mb-4" data-testid="cutlist-shopping">
            <div className="mb-2 flex items-center gap-2">
                <button
                    className="flex flex-1 items-center text-left"
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                    data-testid="cutlist-shopping-toggle"
                >
                    {open ? (
                        <ChevronDown size={13} aria-hidden="true" className="text-faint mr-1" />
                    ) : (
                        <ChevronRight size={13} aria-hidden="true" className="text-faint mr-1" />
                    )}
                    <span className="text-muted text-xs font-semibold tracking-wider uppercase">
                        Shopping list
                    </span>
                    <span className="text-faint ml-1 text-xs" data-testid="cutlist-shopping-count">
                        ({toGet.length === 0 ? 'you have everything' : `${toGet.length} to get`})
                    </span>
                </button>
                <button
                    className="text-accent text-xs font-semibold hover:underline"
                    data-testid="cutlist-shopping-print"
                    title="Print what is left to get"
                    onClick={() => setPrinting((n) => n + 1)}
                >
                    Print list
                </button>
            </div>
            {open && (
                <div className="bg-surface-2 space-y-2 rounded-lg px-2 py-2">
                    <p className="text-faint px-1 text-xs">Tick what you already have.</p>
                    {GROUPS.map((group) => {
                        const rows = items.filter((i) => i.group === group);
                        if (rows.length === 0) return null;
                        return (
                            <div key={group}>
                                <div className="text-faint px-1 text-[10px] font-semibold tracking-wider uppercase">
                                    {group}
                                </div>
                                <ul>
                                    {rows.map((i) => {
                                        const had = has(i);
                                        return (
                                            <li key={`${i.store}|${i.item}`}>
                                                <label className="hover:bg-fg/5 flex cursor-pointer items-baseline gap-2 rounded-md px-1 py-0.5 text-[13px] pointer-coarse:py-2">
                                                    <input
                                                        type="checkbox"
                                                        className="accent-accent self-center pointer-coarse:size-5"
                                                        data-testid="cutlist-have"
                                                        aria-label={`Have ${i.label}`}
                                                        checked={had}
                                                        onChange={(e) =>
                                                            setHave(i.store, [i.item], e.target.checked)
                                                        }
                                                    />
                                                    <span className="w-6 flex-none text-right tabular-nums">
                                                        {i.qty ?? ''}
                                                    </span>
                                                    <span
                                                        className={`min-w-0 flex-1 ${had ? 'text-faint line-through' : ''}`}
                                                    >
                                                        {i.label}
                                                    </span>
                                                    {i.size && (
                                                        <span className="text-faint text-xs">{i.size}</span>
                                                    )}
                                                </label>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            )}
            {printing > 0 && (
                <PrintShopping
                    key={printing}
                    title={title}
                    items={items.filter((i) => !has(i))}
                    onDone={donePrinting}
                />
            )}
        </div>
    );
}
