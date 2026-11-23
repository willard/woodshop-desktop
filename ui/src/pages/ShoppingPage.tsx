/**
 * One shopping list for several designs. Tick the ones you're building: the same material in two
 * of them is bought once, their pieces packed onto shared sheets and boards, and the hardware is
 * added up, priced from the one price list.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api, failure } from '@/app/api';
import { chooseSavePath } from '@/app/files';
import { plural } from '@/app/format';
import { useDefaultKerf } from '@/app/settings';
import { boardSizes, clearFinishLabel, coatingLabel, shoppingList } from '@/cutlist';
import { shoppingCsv } from '@/cutlist/shoppingCsv';
import { finishArea, len } from '@/lib/display';
import { parseSpec } from '@/spec';
import { useToast } from '@/components/Toast';

const SELECTED_KEY = 'woodshop.shopping.selected';

const money = (n: number | null | undefined): string => (n == null ? '' : `$${n.toFixed(2)}`);

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
    // A few milliseconds for a handful of designs: no need to memoise.
    const list = specs.length > 0 ? shoppingList(specs, { kerf }) : null;

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
                                <p className="text-sm" data-testid="shopping-summary">
                                    {plural(chosen.length, 'design')}:{' '}
                                    {[
                                        list.totals.sheetCount > 0
                                            ? plural(list.totals.sheetCount, 'sheet')
                                            : null,
                                        boards > 0 ? plural(boards, 'board') : null,
                                        `${list.totals.boardFeet.toFixed(1)} board feet`,
                                        list.totals.estimatedCost != null
                                            ? `about ${money(list.totals.estimatedCost)}`
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(', ')}
                                    .
                                </p>
                                <button
                                    className="border-fg/12 hover:bg-surface-2 rounded-md border px-3 py-1.5 text-sm"
                                    data-testid="shopping-csv"
                                    onClick={() => void saveCsv()}
                                >
                                    Save as CSV…
                                </button>
                            </div>
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
                                        <th className={th}>Item</th>
                                        <th className={`${th} text-right`}>Qty</th>
                                        <th className={`${th} pl-4`}>Size</th>
                                        <th className={`${th} text-right`}>Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.sheets.map((p) => (
                                        <tr key={p.materialId} data-testid="shopping-row">
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
                                            <td className={td}>{coatingLabel(c)}</td>
                                            <td className={td} />
                                            <td className={`${td} text-muted pl-4`}>{finishArea(c.area)}</td>
                                            <td className={td} />
                                        </tr>
                                    ))}
                                    {list.totals.finishArea > 0 && (
                                        <tr data-testid="shopping-finish">
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
                            <p className="text-faint mt-3 text-xs">
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
