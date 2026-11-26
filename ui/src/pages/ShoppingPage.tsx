/**
 * One shopping list for several designs. Tick the ones you're building: the same material in two
 * of them is bought once, their pieces packed onto shared sheets and boards, and the hardware is
 * added up, priced from the one price list.
 */
import { useCallback, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api, failure } from '@/app/api';
import { chooseSavePath } from '@/app/files';
import { plural } from '@/app/format';
import { useDefaultKerf } from '@/app/settings';
import {
    boardSizes,
    clearFinishLabel,
    coatingLabel,
    shoppingList,
    tools,
    type DesignItem,
    type Tool,
} from '@/cutlist';
import { TOOLS, haveFor, haveOf, setHave, useHaveChanges } from '@/cutlist/have';
import { PrintShopping, type ShoppingItem } from '@/components/ShoppingChecklist';
import { shoppingCsv } from '@/cutlist/shoppingCsv';
import { finishArea, len } from '@/lib/display';
import { parseSpec } from '@/spec';
import { useToast } from '@/components/Toast';

const SELECTED_KEY = 'woodshop.shopping.selected';

const money = (n: number | null | undefined): string => (n == null ? '' : `$${n.toFixed(2)}`);

/** The tools for several designs: each once, required when any design needs it. */
function toolsFor(lists: Tool[][]): Tool[] {
    const out: Tool[] = [];
    for (const tool of lists.flat()) {
        const seen = out.find((t) => t.name === tool.name);
        if (seen === undefined) out.push({ ...tool });
        else seen.required ||= tool.required;
    }
    return out.sort((a, b) => Number(b.required) - Number(a.required));
}

function remembered(): number[] {
    try {
        const raw: unknown = JSON.parse(window.localStorage.getItem(SELECTED_KEY) ?? '[]');
        return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : [];
    } catch {
        return [];
    }
}

export default function ShoppingPage() {
    const toast = useToast();
    const kerf = useDefaultKerf();
    const projects = useQuery({ queryKey: ['projects', false], queryFn: () => api.listProjects(false) });
    const [selected, setSelected] = useState<number[]>(remembered);
    const all = projects.data ?? [];
    // Only designs still in the library count, in library order.
    const chosen = all.filter((p) => selected.includes(p.id));

    const loaded = useQueries({
        queries: chosen.map((p) => ({
            queryKey: ['project', p.id],
            queryFn: () => api.getProject(p.id),
        })),
    });
    const ready = loaded.every((q) => q.data !== undefined);
    const specs = ready ? loaded.map((q) => parseSpec(q.data!.draft)) : [];
    // What each design already has (ticked here or in its cut list) is left off the list.
    useHaveChanges();
    const keys = chosen.map((p) => String(p.id));
    // A few milliseconds for a handful of designs: no need to memoise.
    const list = specs.length > 0 ? shoppingList(specs, { kerf }, keys.map(haveFor)) : null;
    const toolList = toolsFor(specs.map((s) => tools(s)));
    const hasTool = (t: Tool) => haveOf(TOOLS).has(t.name);
    const sourceOf = (key: string): DesignItem[] => list?.sources.find((s) => s.key === key)?.designs ?? [];
    /** Ticks or unticks an item in each design it comes from. */
    function markHave(designs: readonly DesignItem[], had: boolean): void {
        for (const d of designs) setHave(keys[d.design], [d.item], had);
    }
    const toGet: ShoppingItem[] =
        list === null
            ? []
            : [
                  ...list.sheets.map((p) => ({
                      store: '',
                      item: p.materialId,
                      label: p.materialName,
                      qty: p.sheetCount,
                      size: `${len(p.sheetSize.l)} × ${len(p.sheetSize.w)} sheet`,
                      needed: true,
                      group: 'Materials' as const,
                  })),
                  ...list.lumber.map((p) => ({
                      store: '',
                      item: p.materialId,
                      label: p.materialName,
                      qty: p.stickCount,
                      size: `${boardSizes(p, len)} long`,
                      needed: true,
                      group: 'Materials' as const,
                  })),
                  ...list.hardware.map((h) => ({
                      store: '',
                      item: h.key,
                      label: h.description,
                      qty: h.qty,
                      needed: true,
                      group: 'Hardware' as const,
                  })),
                  ...toolList
                      .filter((t) => !hasTool(t))
                      .map((t) => ({
                          store: TOOLS,
                          item: t.name,
                          label: t.name,
                          size: t.required ? t.detail : 'nice to have',
                          needed: t.required,
                          group: 'Tools' as const,
                      })),
              ];
    const toGetCount = toGet.filter((i) => i.needed).length;
    const [printing, setPrinting] = useState(0);
    const donePrinting = useCallback(() => setPrinting(0), []);

    function toggle(id: number): void {
        const next = selected.includes(id) ? selected.filter((n) => n !== id) : [...selected, id];
        setSelected(next);
        try {
            window.localStorage.setItem(SELECTED_KEY, JSON.stringify(next));
        } catch {
            // Storage unavailable: the choice lasts until the page closes.
        }
    }

    async function saveCsv(): Promise<void> {
        if (list === null) return;
        const path = await chooseSavePath('Shopping list.csv', {
            name: 'Shopping list (CSV)',
            extensions: ['csv'],
        });
        if (path === null) return;
        try {
            await api.writeTextFile(
                path,
                shoppingCsv(
                    list,
                    chosen.map((p) => p.name),
                    toolList.filter((t) => !hasTool(t)),
                ),
            );
            toast.success('Shopping list saved.');
        } catch (e) {
            toast.error(failure('save the shopping list', e));
        }
    }

    const savedSheets = list === null ? 0 : list.separateSheets - list.totals.sheetCount;
    const boards = list === null ? 0 : list.lumber.reduce((n, p) => n + p.stickCount, 0);
    const savedBoards = list === null ? 0 : list.separateBoards - boards;
    const th = 'text-muted pb-1.5 text-left text-xs font-medium';
    const td = 'border-fg/[0.06] border-t py-1.5';

    return (
        <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-xl font-semibold tracking-tight">Shopping list</h1>
                <Link to="/" className="text-accent hover:text-accent-strong text-sm">
                    ← Your projects
                </Link>
            </div>
            <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
                <section aria-label="Designs to buy for">
                    <p className="text-muted mb-2 text-[13px]">Tick the designs you&apos;re building.</p>
                    {projects.isError && (
                        <p className="text-danger-fg text-sm">
                            {failure('load your projects', projects.error)}
                        </p>
                    )}
                    {projects.isSuccess && all.length === 0 && (
                        <p className="text-muted text-sm">No projects yet. Start one from a template.</p>
                    )}
                    <ul className="space-y-0.5">
                        {all.map((p) => (
                            <li key={p.id}>
                                <label className="hover:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                                    <input
                                        type="checkbox"
                                        className="accent-accent"
                                        checked={selected.includes(p.id)}
                                        onChange={() => toggle(p.id)}
                                        data-testid="shopping-design"
                                    />
                                    <span className="truncate">{p.name}</span>
                                </label>
                            </li>
                        ))}
                    </ul>
                </section>

                <section aria-label="What to buy" aria-live="polite" data-testid="shopping-list">
                    {chosen.length === 0 ? (
                        <p className="text-muted text-sm">
                            Pick one or more designs. Anything they share is bought once: their pieces are
                            packed onto the same sheets and boards, and the hardware is added up.
                        </p>
                    ) : list === null ? (
                        <p className="text-muted text-sm">Working it out…</p>
                    ) : (
                        <>
                            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                                <div className="text-sm">
                                    <p className="inline" data-testid="shopping-summary">
                                        {plural(chosen.length, 'design')}:{' '}
                                        {[
                                            list.totals.sheetCount > 0
                                                ? plural(list.totals.sheetCount, 'sheet')
                                                : null,
                                            boards > 0 ? plural(boards, 'board') : null,
                                            list.totals.boardFeet > 0
                                                ? `${list.totals.boardFeet.toFixed(1)} board feet`
                                                : null,
                                            list.totals.estimatedCost != null
                                                ? `about ${money(list.totals.estimatedCost)}`
                                                : null,
                                        ]
                                            .filter(Boolean)
                                            .join(', ') || 'no wood to buy'}
                                        .
                                    </p>{' '}
                                    <span className="text-muted" data-testid="shopping-to-get">
                                        {toGetCount === 0 ? 'You have everything.' : `${toGetCount} to get.`}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className="border-fg/12 hover:bg-surface-2 rounded-md border px-3 py-1.5 text-sm"
                                        data-testid="shopping-print"
                                        onClick={() => setPrinting((n) => n + 1)}
                                    >
                                        Print list
                                    </button>
                                    <button
                                        className="border-fg/12 hover:bg-surface-2 rounded-md border px-3 py-1.5 text-sm"
                                        data-testid="shopping-csv"
                                        onClick={() => void saveCsv()}
                                    >
                                        Save as CSV…
                                    </button>
                                </div>
                            </div>
                            {printing > 0 && (
                                <PrintShopping
                                    key={printing}
                                    title={`Shopping list: ${chosen.map((p) => p.name).join(', ')}`}
                                    items={toGet}
                                    onDone={donePrinting}
                                />
                            )}
                            {(savedSheets > 0 || savedBoards > 0) && (
                                <p
                                    className="bg-accent/10 text-fg mb-4 rounded-lg px-3 py-2 text-[13px]"
                                    data-testid="shopping-saving"
                                >
                                    Buying together saves{' '}
                                    {[
                                        savedSheets > 0 ? plural(savedSheets, 'sheet') : null,
                                        savedBoards > 0 ? plural(savedBoards, 'board') : null,
                                    ]
                                        .filter(Boolean)
                                        .join(' and ')}
                                    : one design&apos;s offcuts cover pieces of another.
                                </p>
                            )}
                            <table className="w-full text-sm">
                                <thead>
                                    <tr>
                                        <th className={`${th} w-8`}>
                                            <span className="sr-only">Have it</span>
                                        </th>
                                        <th className={th}>Item</th>
                                        <th className={`${th} text-right`}>Qty</th>
                                        <th className={`${th} pl-4`}>Size</th>
                                        <th className={`${th} text-right`}>Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.sheets.map((p) => (
                                        <tr key={p.materialId} data-testid="shopping-row">
                                            <HaveCell
                                                label={p.materialName}
                                                onHave={() => markHave(sourceOf(p.materialId), true)}
                                            />
                                            <td className={td}>{p.materialName}</td>
                                            <td className={`${td} text-right tabular-nums`}>
                                                {p.sheetCount}
                                            </td>
                                            <td className={`${td} text-muted pl-4`}>
                                                {len(p.sheetSize.l)} × {len(p.sheetSize.w)} sheet
                                            </td>
                                            <td className={`${td} text-right tabular-nums`}>
                                                {money(p.cost)}
                                            </td>
                                        </tr>
                                    ))}
                                    {list.lumber.map((p) => (
                                        <tr key={p.materialId} data-testid="shopping-row">
                                            <HaveCell
                                                label={p.materialName}
                                                onHave={() => markHave(sourceOf(p.materialId), true)}
                                            />
                                            <td className={td}>{p.materialName}</td>
                                            <td className={`${td} text-right tabular-nums`}>
                                                {p.stickCount}
                                            </td>
                                            <td className={`${td} text-muted pl-4`}>
                                                {boardSizes(p, len)} long
                                            </td>
                                            <td className={`${td} text-right tabular-nums`}>
                                                {money(p.cost)}
                                            </td>
                                        </tr>
                                    ))}
                                    {list.hardware.map((h) => (
                                        <tr key={h.key} data-testid="shopping-row">
                                            <HaveCell
                                                label={h.description}
                                                onHave={() => markHave(sourceOf(h.key), true)}
                                            />
                                            <td className={td}>{h.description}</td>
                                            <td className={`${td} text-right tabular-nums`}>{h.qty}</td>
                                            <td className={`${td} pl-4`} />
                                            <td className={`${td} text-right tabular-nums`}>
                                                {money(h.cost)}
                                            </td>
                                        </tr>
                                    ))}
                                    {(list.totals.coatings ?? []).map((c) => (
                                        <tr
                                            key={`${c.kind}${c.color ?? ''}${c.name ?? ''}`}
                                            data-testid="shopping-coating"
                                        >
                                            <td className={td} />
                                            <td className={td}>{coatingLabel(c)}</td>
                                            <td className={td} />
                                            <td className={`${td} text-muted pl-4`}>{finishArea(c.area)}</td>
                                            <td className={td} />
                                        </tr>
                                    ))}
                                    {list.totals.finishArea > 0 && (
                                        <tr data-testid="shopping-finish">
                                            <td className={td} />
                                            <td className={td}>{clearFinishLabel(list.totals)}</td>
                                            <td className={td} />
                                            <td className={`${td} text-muted pl-4`}>
                                                {finishArea(list.totals.finishArea)}
                                            </td>
                                            <td className={td} />
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {toolList.length > 0 && (
                                <div className="mt-5" data-testid="shopping-tools">
                                    <h2 className="text-muted mb-1.5 text-xs font-medium">Tools</h2>
                                    <ul className="space-y-px">
                                        {toolList.map((t) => (
                                            <li key={t.name}>
                                                <label className="hover:bg-surface-2 flex cursor-pointer items-baseline gap-2 rounded-md px-1 py-1 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        className="accent-accent self-center"
                                                        data-testid="shopping-tool-have"
                                                        aria-label={`Have ${t.name}`}
                                                        checked={hasTool(t)}
                                                        onChange={(e) =>
                                                            setHave(TOOLS, [t.name], e.target.checked)
                                                        }
                                                    />
                                                    <span
                                                        className={
                                                            hasTool(t) ? 'text-faint line-through' : ''
                                                        }
                                                    >
                                                        {t.name}
                                                    </span>
                                                    <span className="text-faint text-xs">
                                                        {t.required ? t.usedFor : 'nice to have'}
                                                    </span>
                                                </label>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {list.had.length > 0 && (
                                <div className="mt-5" data-testid="shopping-had">
                                    <h2 className="text-muted mb-1.5 text-xs font-medium">Already have</h2>
                                    <ul className="space-y-px">
                                        {list.had.map((h) => (
                                            <li key={`${h.label}|${h.qty ?? ''}`}>
                                                <label className="hover:bg-surface-2 flex cursor-pointer items-baseline gap-2 rounded-md px-1 py-1 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        className="accent-accent self-center"
                                                        data-testid="shopping-had-tick"
                                                        aria-label={`Have ${h.label}`}
                                                        checked
                                                        onChange={() => markHave(h.designs, false)}
                                                    />
                                                    <span className="text-faint line-through">
                                                        {h.qty !== undefined && `${h.qty} × `}
                                                        {h.label}
                                                    </span>
                                                </label>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <p className="text-faint mt-3 text-xs">
                                Tick what you already have and it comes off the list, for that design too.
                                Prices come from each material and from the hardware price list in the cut
                                list. Finish covers both faces and every edge of each part, at 100 sq ft a
                                quart.
                            </p>
                        </>
                    )}
                </section>
            </div>
        </>
    );
}

/** The first cell of a line to buy: tick it once you have it, and it comes off the list. */
function HaveCell({ label, onHave }: { label: string; onHave: () => void }) {
    return (
        <td className="border-fg/[0.06] border-t py-1.5">
            <input
                type="checkbox"
                className="accent-accent"
                data-testid="shopping-have"
                aria-label={`Have ${label}`}
                checked={false}
                onChange={onHave}
            />
        </td>
    );
}
