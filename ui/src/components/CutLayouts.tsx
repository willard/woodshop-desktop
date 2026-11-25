/**
 * The sheet and board layouts of a cut list: each sheet or board drawn with the pieces cut from
 * it, the saw cuts in order when asked, and the leftovers worth keeping with their sizes. Pieces
 * tick off as they are cut (a click, again to undo), with a count per sheet or board; the same
 * pieces read as a plain checklist, and the layouts and checklist print on their own.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CutList, SawCut } from '@/cutlist/types';
import type { Spec } from '@/spec';
import { len } from '@/lib/display';
import { plural } from '@/app/format';
import { boardLength, boardSizes, boughtBoards } from '@/cutlist/boards';

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Which pieces are cut, and ticking one: copy `copy` (from 0) of a part. */
export interface PieceTicks {
    isCut(partId: string, copy: number): boolean;
    /** Left out, the pieces only show what is cut (on paper). */
    toggle?(partId: string, copy: number): void;
}

/**
 * Each item's copy number among the items of the same part, in order: the first leg 0, the
 * second 1. A part's pieces are alike, so a layout that moves them keeps the ticks on the part.
 */
export function copyNumbers(items: readonly { partId: string }[]): number[] {
    const seen = new Map<string, number>();
    return items.map((item) => {
        const n = seen.get(item.partId) ?? 0;
        seen.set(item.partId, n + 1);
        return n;
    });
}

/** The pieces on sheet or board `n` of a plan's placements or cuts, and how many are cut. */
function countOn(
    items: readonly { partId: string }[],
    on: (i: number) => number,
    n: number,
    ticks: PieceTicks,
): { cut: number; total: number } {
    const copies = copyNumbers(items);
    let cut = 0;
    let total = 0;
    items.forEach((item, i) => {
        if (on(i) !== n) return;
        total += 1;
        if (ticks.isCut(item.partId, copies[i])) cut += 1;
    });
    return { cut, total };
}

/** What one length of stock is called: a board of lumber, a stick of dowel. */
export function boardWord(spec: Spec, materialId: string): string {
    return spec.materials.find((m) => m.id === materialId)?.type === 'round' ? 'stick' : 'board';
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
    return <h3 className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">{children}</h3>;
}

/** "Sheet 2 · 3 of 7 cut" over one sheet or board; the name alone when nothing is ticked. */
function StockCaption({
    name,
    count,
    testId,
}: {
    name: string;
    count?: { cut: number; total: number };
    testId: string;
}) {
    return (
        <p className="text-muted mb-1 text-xs" data-testid={testId}>
            {name}
            {count !== undefined && count.total > 0 && (
                <span className={count.cut === count.total ? 'text-accent' : undefined}>
                    {' · '}
                    {count.cut === count.total ? 'all cut' : `${count.cut} of ${count.total} cut`}
                </span>
            )}
        </p>
    );
}

/** Every sheet and board of the cut list, material by material. */
export function CutLayouts({
    cutList,
    spec,
    cutOrder = false,
    ticks,
    paper = false,
}: {
    cutList: CutList;
    spec: Spec;
    cutOrder?: boolean;
    ticks?: PieceTicks;
    /** Drawn for print: light sheets, nothing to click. */
    paper?: boolean;
}) {
    return (
        <>
            {cutList.sheets.map((plan) => {
                const count = (n: number) =>
                    ticks && countOn(plan.placements, (i) => plan.placements[i].sheet, n, ticks);
                return (
                    <div key={plan.materialId} className="mb-4 break-inside-avoid-page">
                        <SectionHeading>
                            {plan.materialName}: {plural(plan.sheetCount, 'sheet')}
                            {(plan.offcuts ?? []).length > 0 &&
                                ` + ${plural(plan.offcuts!.length, 'piece')} on hand`}
                            , {pct(plan.waste)} offcut
                        </SectionHeading>
                        <div className="space-y-3">
                            {Array.from({ length: plan.sheetCount }, (_, n) => (
                                <div key={n} className="break-inside-avoid">
                                    {(ticks || plan.sheetCount > 1) && (
                                        <StockCaption
                                            name={`Sheet ${n + 1}`}
                                            count={count(n)}
                                            testId="cutlist-sheet-count"
                                        />
                                    )}
                                    <SheetDiagram
                                        plan={plan}
                                        sheet={n}
                                        cutOrder={cutOrder}
                                        ticks={ticks}
                                        paper={paper}
                                    />
                                    {cutOrder && <CutSteps cuts={plan.cuts} sheet={n} trim={plan.trim} />}
                                </div>
                            ))}
                            {(plan.offcuts ?? []).map((o, i) => (
                                <div
                                    key={o.id}
                                    className="break-inside-avoid"
                                    data-testid="cutlist-on-hand-sheet"
                                >
                                    <StockCaption
                                        name={`On hand, ${len(o.l)} × ${len(o.w ?? 0)}`}
                                        count={count(plan.sheetCount + i)}
                                        testId="cutlist-sheet-count"
                                    />
                                    <SheetDiagram
                                        plan={plan}
                                        sheet={plan.sheetCount + i}
                                        size={{ l: o.l, w: o.w ?? 0 }}
                                        cutOrder={cutOrder}
                                        ticks={ticks}
                                        paper={paper}
                                    />
                                    {cutOrder && <CutSteps cuts={plan.cuts} sheet={plan.sheetCount + i} />}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}

            {cutList.lumber.map((plan) => {
                const count = (n: number) => ticks && countOn(plan.cuts, (i) => plan.cuts[i].stick, n, ticks);
                const word = boardWord(spec, plan.materialId);
                const name = word === 'stick' ? 'Stick' : 'Board';
                return (
                    <div
                        key={plan.materialId}
                        className="mb-4 break-inside-avoid-page"
                        data-testid="cutlist-boards"
                    >
                        <SectionHeading>
                            {plan.materialName}: {plural(plan.stickCount, word)}
                            {boughtBoards(plan).length > 1
                                ? ` (${boardSizes(plan, len)})`
                                : ` of ${len(plan.stockLength)}`}
                            {(plan.offcuts ?? []).length > 0 &&
                                ` + ${plural(plan.offcuts!.length, 'piece')} on hand`}
                            , {pct(plan.waste)} offcut
                        </SectionHeading>
                        <div className="space-y-1.5">
                            {Array.from({ length: plan.stickCount }, (_, n) => (
                                <div key={n} className="break-inside-avoid">
                                    {ticks && (
                                        <StockCaption
                                            name={`${name} ${n + 1}`}
                                            count={count(n)}
                                            testId="cutlist-board-count"
                                        />
                                    )}
                                    <BoardDiagram
                                        plan={plan}
                                        board={n}
                                        parts={cutList.parts}
                                        length={boardLength(plan, n)}
                                        cutOrder={cutOrder}
                                        ticks={ticks}
                                        paper={paper}
                                    />
                                    {cutOrder && (
                                        <CutSteps cuts={plan.sawCuts} sheet={n} trim={plan.trim} ends />
                                    )}
                                </div>
                            ))}
                            {(plan.offcuts ?? []).map((o, i) => (
                                <div
                                    key={o.id}
                                    className="break-inside-avoid"
                                    data-testid="cutlist-on-hand-board"
                                >
                                    <StockCaption
                                        name={`On hand, ${len(o.l)}`}
                                        count={count(plan.stickCount + i)}
                                        testId="cutlist-board-count"
                                    />
                                    <BoardDiagram
                                        plan={plan}
                                        board={plan.stickCount + i}
                                        parts={cutList.parts}
                                        length={o.l}
                                        cutOrder={cutOrder}
                                        ticks={ticks}
                                        paper={paper}
                                    />
                                    {cutOrder && <CutSteps cuts={plan.sawCuts} sheet={plan.stickCount + i} />}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </>
    );
}

/**
 * The same pieces as the layouts, as a list to tick: sheet by sheet and board by board, each piece
 * with its size.
 */
export function CutChecklist({ cutList, spec, ticks }: { cutList: CutList; spec: Spec; ticks?: PieceTicks }) {
    const size = (id: string) => {
        const row = cutList.parts.find((r) => r.partId === id);
        return row ? `${len(row.length)} × ${len(row.width)}` : '';
    };
    type Item = { partId: string; name: string; copy: number };
    const stocks: { key: string; heading: string; items: Item[] }[] = [];
    for (const plan of cutList.sheets) {
        const copies = copyNumbers(plan.placements);
        const pieces = plan.sheetCount + (plan.offcuts ?? []).length;
        for (let n = 0; n < pieces; n++) {
            const o = n >= plan.sheetCount ? plan.offcuts![n - plan.sheetCount] : undefined;
            stocks.push({
                key: `${plan.materialId}-${n}`,
                heading: `${plan.materialName}, ${o ? `on hand ${len(o.l)} × ${len(o.w ?? 0)}` : `sheet ${n + 1}`}`,
                items: plan.placements
                    .map((p, i) => ({ partId: p.partId, name: p.name, copy: copies[i], on: p.sheet }))
                    .filter((p) => p.on === n),
            });
        }
    }
    for (const plan of cutList.lumber) {
        const copies = copyNumbers(plan.cuts);
        const word = boardWord(spec, plan.materialId);
        const pieces = plan.stickCount + (plan.offcuts ?? []).length;
        for (let n = 0; n < pieces; n++) {
            const o = n >= plan.stickCount ? plan.offcuts![n - plan.stickCount] : undefined;
            stocks.push({
                key: `${plan.materialId}-${n}`,
                heading: `${plan.materialName}, ${o ? `on hand ${len(o.l)}` : `${word} ${n + 1} of ${len(boardLength(plan, n))}`}`,
                items: plan.cuts
                    .map((c, i) => ({ partId: c.partId, name: c.name, copy: copies[i], on: c.stick }))
                    .filter((c) => c.on === n),
            });
        }
    }
    return (
        <div className="mb-4 space-y-3" data-testid="cutlist-checklist">
            {stocks
                .filter((s) => s.items.length > 0)
                .map((s) => (
                    <div key={s.key} className="break-inside-avoid">
                        <h4 className="text-muted mb-1 text-xs font-semibold">{s.heading}</h4>
                        <ul className="space-y-px">
                            {s.items.map((item) => {
                                const cut = ticks?.isCut(item.partId, item.copy) ?? false;
                                return (
                                    <li key={`${item.partId}-${item.copy}`}>
                                        <label className="hover:bg-fg/5 flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] pointer-coarse:py-2">
                                            <input
                                                type="checkbox"
                                                className="accent-accent pointer-coarse:size-5"
                                                data-testid="cutlist-checklist-tick"
                                                checked={cut}
                                                disabled={ticks?.toggle === undefined}
                                                onChange={() => ticks?.toggle?.(item.partId, item.copy)}
                                            />
                                            <span
                                                className={`min-w-0 flex-1 ${cut ? 'text-faint line-through' : ''}`}
                                            >
                                                {item.name}
                                            </span>
                                            <span className="text-faint text-xs whitespace-nowrap tabular-nums">
                                                {size(item.partId)}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
        </div>
    );
}

/**
 * The layouts and the checklist alone, printed: drawn into the page while printing and hidden
 * everywhere else, with the rest of the page hidden from the printer (`app.css`).
 */
export function PrintCutList({
    cutList,
    spec,
    ticks,
    onDone,
}: {
    cutList: CutList;
    spec: Spec;
    ticks?: PieceTicks;
    onDone: () => void;
}) {
    const [root] = useState(() => {
        const el = document.createElement('div');
        el.className = 'cutlist-print';
        el.dataset.testid = 'cutlist-printout';
        return el;
    });
    const paperTicks = useMemo(() => ticks && { isCut: ticks.isCut }, [ticks]);
    useEffect(() => {
        const html = document.documentElement;
        document.body.append(root);
        html.dataset.printing = 'cutlist';
        let printed = false;
        const done = () => {
            if (printed) return;
            printed = true;
            onDone();
        };
        window.addEventListener('afterprint', done);
        // After the portal has drawn.
        const timer = window.setTimeout(() => window.print(), 50);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('afterprint', done);
            delete html.dataset.printing;
            root.remove();
        };
    }, [root, onDone]);
    return createPortal(
        <div className="p-2 text-sm text-black">
            <h1 className="mb-1 text-lg font-semibold">{spec.name}: cut list</h1>
            <p className="mb-4 text-xs text-neutral-600">
                {plural(
                    cutList.parts.reduce((n, r) => n + r.qty, 0),
                    'piece',
                )}{' '}
                to cut. Tick each one off as it comes off the saw.
            </p>
            <CutLayouts cutList={cutList} spec={spec} ticks={paperTicks} paper />
            <div className="break-before-page">
                <SectionHeading>Checklist</SectionHeading>
                <CutChecklist cutList={cutList} spec={spec} ticks={paperTicks} />
            </div>
        </div>,
        root,
    );
}

/** One physical sheet with its placed parts (SVG origin is top-left, so y flips). */
export function SheetDiagram({
    plan,
    sheet,
    size = plan.sheetSize,
    cutOrder = false,
    ticks,
    paper = false,
}: {
    plan: CutList['sheets'][number];
    sheet: number;
    /** A piece on hand's own size; a bought sheet is the plan's. */
    size?: { l: number; w: number };
    /** Draw the saw cuts, numbered in the order to make them. */
    cutOrder?: boolean;
    /** The pieces cut, drawn faded; clicked to tick off when `ticks` can toggle. */
    ticks?: PieceTicks;
    /** Drawn for print, on a light sheet. */
    paper?: boolean;
}) {
    const copies = copyNumbers(plan.placements);
    // A piece on hand is drawn to the same scale as a full sheet, against the left edge.
    const scale = Math.max(size.l / plan.sheetSize.l, 0.0001);
    // Number markers are sized to the full sheet so they read the same on every diagram.
    const r = Math.min(plan.sheetSize.l, plan.sheetSize.w) * 0.03;
    return (
        <svg
            viewBox={`-1 -1 ${size.l + 2} ${size.w + 2}`}
            style={size === plan.sheetSize ? undefined : { width: `${Math.min(scale, 1) * 100}%` }}
            className="bg-surface-2 border-fg/10 w-full rounded-lg border"
            preserveAspectRatio="xMidYMid meet"
            data-testid="cutlist-sheet"
        >
            <rect
                width={size.l}
                height={size.w}
                fill={paper ? '#fafaf9' : '#16171b'}
                stroke={paper ? '#a8a29e' : '#3a3d44'}
                strokeWidth="0.3"
            />
            {sheet < plan.sheetCount && (plan.trim ?? 0) > 0 && (
                <rect
                    x={plan.trim}
                    y={plan.trim}
                    width={size.l - 2 * (plan.trim ?? 0)}
                    height={size.w - 2 * (plan.trim ?? 0)}
                    fill="none"
                    stroke="#71717a"
                    strokeWidth="0.3"
                    strokeDasharray="1 1"
                    data-testid="cutlist-sheet-trim"
                >
                    <title>Trimmed edges: {len(plan.trim ?? 0)} off each</title>
                </rect>
            )}
            {(plan.leftovers ?? [])
                .filter((left) => left.sheet === sheet)
                .map((left) => {
                    const w = left.w ?? 0;
                    const y = size.w - left.y - w;
                    // Its size, written across it: small enough to fit, and no bigger than a part's name.
                    const font = Math.min(w * 0.3, left.l * 0.08, plan.sheetSize.w * 0.04);
                    return (
                        <g key={`left-${left.x}-${left.y}`} data-testid="cutlist-leftover">
                            <title>
                                Leftover worth keeping: {len(left.l)} × {len(w)}
                            </title>
                            <rect
                                x={left.x}
                                y={y}
                                width={left.l}
                                height={w}
                                fill="none"
                                stroke={paper ? '#78716c' : '#a3a3a3'}
                                strokeWidth="0.3"
                                strokeDasharray="1.5 1"
                            />
                            <text
                                x={left.x + left.l / 2}
                                y={y + w / 2}
                                fill={paper ? '#57534e' : '#a3a3a3'}
                                fontSize={font}
                                textAnchor="middle"
                                dominantBaseline="central"
                                data-testid="cutlist-leftover-size"
                            >
                                {len(left.l)} × {len(w)}
                            </text>
                        </g>
                    );
                })}
            {plan.placements.map((p, i) => {
                if (p.sheet !== sheet) return null;
                const y = size.w - p.y - p.h;
                const copy = copies[i];
                const cut = ticks?.isCut(p.partId, copy) ?? false;
                const toggle = ticks?.toggle;
                return (
                    <g
                        key={`${p.partId}-${p.x}-${p.y}`}
                        data-testid="cutlist-piece"
                        data-cut={cut ? 'true' : undefined}
                        {...(toggle && {
                            role: 'button',
                            tabIndex: 0,
                            'aria-pressed': cut,
                            'aria-label': `${p.name}${cut ? ', cut' : ''}`,
                            className: 'cursor-pointer outline-none focus-visible:[&>rect]:stroke-[0.8]',
                            onClick: () => toggle(p.partId, copy),
                            onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                toggle(p.partId, copy);
                            },
                        })}
                    >
                        <title>{`${p.name}${cut ? ': cut' : toggle ? ': click once it is cut' : ''}`}</title>
                        <rect
                            x={p.x}
                            y={y}
                            width={p.w}
                            height={p.h}
                            fill="#b98a55"
                            fillOpacity={cut ? 0.3 : 0.85}
                            stroke="#78350f"
                            strokeWidth="0.25"
                        />
                        <text
                            x={p.x + p.w / 2}
                            y={y + p.h / 2}
                            fill="#1c1917"
                            fontSize={Math.min(p.w, p.h) * 0.22}
                            textAnchor="middle"
                            dominantBaseline="central"
                        >
                            {cut ? `✓ ${p.name}` : p.name}
                        </text>
                    </g>
                );
            })}
            {cutOrder &&
                (plan.cuts ?? [])
                    .filter((c) => c.sheet === sheet)
                    .map((c) => {
                        // A rip runs along the length at y; a crosscut runs up from y at x.
                        const [x1, y1] = [c.x, size.w - c.y];
                        const [x2, y2] = c.rip ? [c.x + c.l, y1] : [x1, y1 - c.l];
                        const [cx, cy] = c.rip ? [x1 + r * 1.3, y1] : [x1, y1 - r * 1.3];
                        return (
                            <g key={`cut-${c.n}`} data-testid="cutlist-saw-cut">
                                <title>
                                    Cut {c.n}: {c.rip ? 'rip' : 'crosscut'} {len(c.off)} off, {len(c.l)} long
                                </title>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ef4444" strokeWidth="0.4" />
                                <circle cx={cx} cy={cy} r={r} fill="#ef4444" />
                                <text
                                    x={cx}
                                    y={cy}
                                    fill="#fff"
                                    fontSize={r * 1.2}
                                    fontWeight="600"
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                >
                                    {c.n}
                                </text>
                            </g>
                        );
                    })}
        </svg>
    );
}

/**
 * One sheet's or board's saw cuts in order, each with where the fence or stop goes: the width or
 * length of the piece it takes off.
 */
function CutSteps({
    cuts: all,
    sheet,
    trim = 0,
    ends = false,
}: {
    cuts: SawCut[] | undefined;
    sheet: number;
    /** Trimmed off first: off each edge of a sheet, or each end of a board (`ends`). */
    trim?: number;
    ends?: boolean;
}) {
    const cuts = (all ?? []).filter((c) => c.sheet === sheet);
    if (cuts.length === 0) return null;
    return (
        <ol
            className="text-muted mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
            data-testid="cutlist-cut-steps"
        >
            {trim > 0 && (
                <li>
                    Trim {len(trim)} off each {ends ? 'end' : 'edge'}, then:
                </li>
            )}
            {cuts.map((c) => (
                <li key={c.n}>
                    <span className="font-semibold text-red-400">{c.n}</span> {c.rip ? 'Rip' : 'Crosscut'}{' '}
                    {len(c.off)}
                </li>
            ))}
        </ol>
    );
}

/**
 * One board with its cuts, drawn to the plan's stock length. Boards are long and thin, so this is
 * a bar of fixed height rather than a drawing to scale across the board; ripped pieces sit in
 * lanes across it.
 */
export function BoardDiagram({
    plan,
    board,
    parts,
    length = plan.stockLength,
    cutOrder = false,
    ticks,
    paper = false,
}: {
    plan: CutList['lumber'][number];
    board: number;
    parts: CutList['parts'];
    /** A piece on hand's own length; a bought board is the plan's. */
    length?: number;
    /** Draw the saw cuts, numbered in the order to make them. */
    cutOrder?: boolean;
    /** The pieces cut, drawn faded; clicked to tick off when `ticks` can toggle. */
    ticks?: PieceTicks;
    /** Drawn for print, on a light board. */
    paper?: boolean;
}) {
    const width = (id: string) => parts.find((r) => r.partId === id)?.width ?? 0;
    const copies = copyNumbers(plan.cuts);
    const cuts = plan.cuts.map((c, i) => ({ ...c, copy: copies[i] })).filter((c) => c.stick === board);
    const across = plan.stockWidth ?? Math.max(...plan.cuts.map((c) => width(c.partId)), 1);
    const ripped = cuts.some((c) => (c.y ?? 0) > 0);
    const at = (v: number, of: number) => `${(v / of) * 100}%`;
    return (
        <div
            className={`${paper ? 'border-neutral-400 bg-stone-50' : 'bg-surface-2 border-fg/10'} relative overflow-hidden rounded border`}
            style={{
                height: ripped ? 52 : 28,
                width:
                    length === plan.stockLength
                        ? undefined
                        : at(Math.min(length, plan.stockLength), plan.stockLength),
            }}
            data-testid="cutlist-board"
        >
            {board < plan.stickCount &&
                (plan.trim ?? 0) > 0 &&
                [plan.trim ?? 0, length - (plan.trim ?? 0)].map((x) => (
                    <div
                        key={x}
                        className="absolute inset-y-0 border-l border-dashed border-neutral-500"
                        style={{ left: at(x, length) }}
                        title={`Trimmed end: ${len(plan.trim ?? 0)} off`}
                        data-testid="cutlist-board-trim"
                    />
                ))}
            {(plan.leftovers ?? [])
                .filter((left) => left.sheet === board)
                .map((left) => (
                    <div
                        key={`left-${left.x}`}
                        className="absolute inset-y-0.5 flex items-center justify-center overflow-hidden rounded-sm border border-dashed border-neutral-400 text-[10px] leading-none whitespace-nowrap text-neutral-400"
                        style={{ left: at(left.x, length), width: at(left.l, length) }}
                        title={`Leftover worth keeping: ${len(left.l)}`}
                        data-testid="cutlist-leftover"
                    >
                        <span data-testid="cutlist-leftover-size">{len(left.l)}</span>
                    </div>
                ))}
            {cuts.map((c) => {
                const y = c.y ?? 0;
                // Across the board, a piece of full width fills the bar.
                const w = ripped ? width(c.partId) : across;
                const cut = ticks?.isCut(c.partId, c.copy) ?? false;
                const toggle = ticks?.toggle;
                const Piece = toggle ? 'button' : 'div';
                return (
                    <Piece
                        key={`${c.partId}-${c.x}-${y}`}
                        className={`absolute truncate rounded-sm border border-amber-900 px-1 text-left text-xs leading-none text-stone-900 ${toggle ? 'focus-visible:outline-accent cursor-pointer focus-visible:outline-2' : ''}`}
                        data-testid="cutlist-piece"
                        data-cut={cut ? 'true' : undefined}
                        {...(toggle && {
                            type: 'button' as const,
                            'aria-pressed': cut,
                            'aria-label': `${c.name}, ${len(c.length)}${cut ? ', cut' : ''}`,
                            onClick: () => toggle(c.partId, c.copy),
                        })}
                        style={{
                            left: at(c.x, length),
                            width: at(c.length, length),
                            bottom: at(y, across),
                            height: at(Math.min(w, across), across),
                            background: 'rgb(185 138 85 / 0.85)',
                            opacity: cut ? 0.35 : 1,
                            display: 'flex',
                            alignItems: 'center',
                        }}
                        title={`${c.name}, ${len(c.length)}${cut ? ': cut' : toggle ? ': click once it is cut' : ''}`}
                    >
                        {cut ? `✓ ${c.name}` : c.name}
                    </Piece>
                );
            })}
            {cutOrder &&
                (plan.sawCuts ?? [])
                    // Unripped, the bar is not to scale across: crosscuts span it, rips are only listed.
                    .filter((c) => c.sheet === board && (ripped || !c.rip))
                    .map((c) => {
                        const line = c.rip
                            ? {
                                  left: at(c.x, length),
                                  width: at(c.l, length),
                                  bottom: at(c.y, across),
                                  height: 2,
                              }
                            : {
                                  left: at(c.x, length),
                                  width: 2,
                                  bottom: ripped ? at(c.y, across) : 0,
                                  height: ripped ? at(c.l, across) : '100%',
                              };
                        // A rip's number sits a quarter along it, a crosscut's halfway up.
                        const badge = c.rip
                            ? {
                                  left: `calc(${at(c.x + c.l / 4, length)} - 7px)`,
                                  bottom: `calc(${at(c.y, across)} - 6px)`,
                              }
                            : {
                                  left: `calc(${at(c.x, length)} - 6px)`,
                                  bottom: ripped
                                      ? `calc(${at(c.y + c.l / 2, across)} - 7px)`
                                      : 'calc(50% - 7px)',
                              };
                        return (
                            <div
                                key={`saw-${c.n}`}
                                data-testid="cutlist-saw-cut"
                                title={`Cut ${c.n}: ${c.rip ? 'rip' : 'crosscut'} ${len(c.off)} off, ${len(c.l)} long`}
                            >
                                <div className="absolute bg-red-500" style={line} />
                                <div
                                    className="absolute flex size-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none font-semibold text-white"
                                    style={badge}
                                >
                                    {c.n}
                                </div>
                            </div>
                        );
                    })}
        </div>
    );
}
