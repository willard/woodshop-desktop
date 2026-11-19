/**
 * Dock panel: the cut list as a pure function of the spec. Row clicks select parts so the
 * Inspector can take over; shift/⌘-click extends the selection. `readonly` is the exported-plan
 * viewer: the same panel with nothing to change.
 */
import { ChevronDown, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import {
    assemblyOrder,
    joinery,
    computeCutList,
    groupCutList,
    stockAdvice,
    type CutList,
    type CutListGroup,
    type CutListSection,
    type StockSuggestion,
} from '@/cutlist';
import { overallSize, type Material, type Spec } from '@/spec';
import { dims, len, lenValue, parseLen, size as sizeOf, useUnits, weight, finishArea } from '@/lib/display';
import { plural } from '@/app/format';
import { saveHardwarePrice, useHardwarePrices } from '@/cutlist/prices';
import { useOffcuts } from '@/cutlist/offcuts';
import { TRIM_OPTIONS, saveTrim, useTrim, type TrimKey } from '@/cutlist/trim';
import { boardLength, boardSizes, boughtBoards } from '@/cutlist/boards';
import type { SawCut } from '@/cutlist/types';
import { OnHandSection } from './OnHandSection';
import { BoardPrice, stockLabel } from './BoardPrice';
import { useCutProgress } from '@/cutlist/progress';

export interface CutListPanelProps {
    spec: Spec;
    kerf: number;
    onKerfChange?: (kerf: number) => void;
    selectedIds?: readonly string[];
    /** Part ids hidden in the 3D view. A hidden part is still cut and still listed here. */
    hiddenIds?: ReadonlySet<string>;
    readonly?: boolean;
    onMaterial?: (materialId: string, patch: Partial<Material>) => void;
    onDeleteMaterial?: (materialId: string) => void;
    onSelect?: (partId: string, additive: boolean) => void;
    onToggleHidden?: (partId: string) => void;
    /** Header actions (Export PDF / Export 3D …), supplied by the editor. */
    actions?: (cutList: CutList) => React.ReactNode;
    /** Where the parts ticked off as cut are remembered (the project id); no ticks without it. */
    progressKey?: string;
}

const KERF_OPTIONS = [0.0625, 0.09375, 0.125, 0.25];

const fmt = (n: number): string => `${len(n)}`;
const money = (n: number | null): string => (n === null ? '—' : `$${n.toFixed(2)}`);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const kindLabel = (kind: CutListSection['kind']): string =>
    kind === 'sheet' ? 'Sheet goods' : kind === 'lumber' ? 'Lumber' : 'Other stock';

/** The stock advice in the reader's units. */
function adviceText(a: StockSuggestion): string {
    const { neededSize: n, suggestedSize: p, currentSize: c } = a;
    return `These parts fit within ${sizeOf(n.l, n.w)}, so a ${sizeOf(p.l, p.w)} panel would do — the ${sizeOf(c.l, c.w)} sheet is ${Math.round(a.wastePercent)}% offcut.`;
}

/** What one length of stock is called: a board of lumber, a stick of dowel. */
function boardWord(spec: Spec, materialId: string): string {
    return spec.materials.find((m) => m.id === materialId)?.type === 'round' ? 'stick' : 'board';
}

function stockLine(section: CutListSection, spec: Spec): string {
    if (section.stock === null) {
        return 'No stock plan for this material';
    }
    const { count, l, w, lengths } = section.stock;
    const unit = section.stock.unit === 'sheet' ? 'sheet' : boardWord(spec, section.materialId);
    const size =
        w !== undefined
            ? sizeOf(l, w)
            : lengths !== undefined
              ? lengths.map((s) => `${s.count} × ${fmt(s.l)}`).join(', ')
              : fmt(l);
    return `${count} ${unit}${count === 1 ? '' : 's'} · ${size}`;
}

const FLAG_BADGES: {
    key: 'curved' | 'notched' | 'mitered' | 'eased' | 'mixedOps';
    label: string;
    title: string;
}[] = [
    {
        key: 'curved',
        label: 'curved',
        title: 'Cut the rectangular blank, then trim the curve with a template',
    },
    { key: 'notched', label: 'notched', title: 'Cut the rectangular blank, then cut the notch' },
    { key: 'mitered', label: 'mitered', title: 'Cut the blank to size, then bevel the mitered edge' },
    {
        key: 'eased',
        label: 'eased',
        title: 'Cut the blank to size, then soften the eased edges with a router',
    },
    {
        key: 'mixedOps',
        label: 'varies',
        title: 'Same blank, but the joinery differs — expand to see each part',
    },
];

export function CutListPanel(props: CutListPanelProps) {
    const { spec, kerf, readonly = false, selectedIds = [], hiddenIds } = props;
    const units = useUnits();
    const hardwarePrices = useHardwarePrices();
    const onHand = useOffcuts();
    const sheetTrim = useTrim('sheetTrim');
    const boardTrim = useTrim('boardTrim');
    const cutList = useMemo(
        // The exported plan is read elsewhere: it uses no one's stock on hand or trim.
        () =>
            computeCutList(spec, {
                kerf,
                units,
                hardwarePrices,
                offcuts: readonly ? [] : onHand,
                sheetTrim: readonly ? 0 : sheetTrim,
                boardTrim: readonly ? 0 : boardTrim,
            }),
        [spec, kerf, units, hardwarePrices, onHand, sheetTrim, boardTrim, readonly],
    );
    /** Showing a price box on each hardware line. */
    const [pricing, setPricing] = useState(false);
    const sections = useMemo(() => groupCutList(cutList), [cutList]);
    const advice = useMemo(() => stockAdvice(cutList, spec), [cutList, spec]);
    const steps = useMemo(() => assemblyOrder(spec), [spec]);
    const [assemblyOpen, setAssemblyOpen] = useState(false);
    const work = useMemo(() => joinery(spec, units), [spec, units]);
    const [joineryOpen, setJoineryOpen] = useState(false);
    const overall = useMemo(() => overallSize(spec), [spec]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [fastenersOpen, setFastenersOpen] = useState(false);
    /** Drawing the numbered saw cuts over the sheet layouts. */
    const [cutOrder, setCutOrder] = useState(false);
    const progress = useCutProgress(props.progressKey ?? '');
    const tracking = props.progressKey !== undefined;
    const done = tracking ? progress.cut : undefined;
    const pieces = cutList.parts.reduce((n, r) => n + r.qty, 0);
    const piecesCut = cutList.parts.reduce((n, r) => n + (progress.cut.has(r.partId) ? r.qty : 0), 0);
    const fasteners = cutList.hardware.filter((row) => FASTENER_KINDS.has(row.kind));
    const fittings = cutList.hardware.filter((row) => !FASTENER_KINDS.has(row.kind));

    /** "Add prices": take the reader to the first material price, ready to type. */
    function focusFirstPrice(): void {
        const input = document.querySelector<HTMLInputElement>('[data-testid="material-price"]');
        input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        input?.focus();
    }

    const materialUse = useMemo(() => {
        const counts = new Map<string, number>();
        for (const part of spec.parts) {
            counts.set(part.materialId, (counts.get(part.materialId) ?? 0) + 1);
        }
        return counts;
    }, [spec]);

    const isSelected = (id: string) => selectedIds.includes(id);
    const groupSelected = (g: CutListGroup) => g.members.every((m) => isSelected(m.partId));
    const groupPartial = (g: CutListGroup) =>
        !groupSelected(g) && g.members.some((m) => isSelected(m.partId));
    const additive = (e: MouseEvent) => e.shiftKey || e.metaKey || e.ctrlKey;

    function toggleExpanded(key: string): void {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    }

    /** A group stands for all its parts: the first click sets the selection, the rest extend it. */
    function groupClick(group: CutListGroup, e: MouseEvent): void {
        group.members.forEach((member, i) => props.onSelect?.(member.partId, i > 0 || additive(e)));
    }

    function undeletable(material: Material): string | null {
        const uses = materialUse.get(material.id) ?? 0;
        if (uses > 0)
            return `${uses} part${uses === 1 ? '' : 's'} still use this — change their stock first.`;
        return spec.materials.length <= 1 ? 'A design needs at least one material.' : null;
    }

    function commitSheet(material: Material, dim: 'l' | 'w', raw: string): void {
        const value = parseLen(raw);
        if (value === null || value <= 0 || value > 240 || material.sheetSize === undefined) return;
        props.onMaterial?.(material.id, { sheetSize: { ...material.sheetSize, [dim]: value } });
    }

    return (
        <div className="flex-1 overflow-y-auto px-4 pt-3.5 pb-5 text-sm" data-testid="cutlist">
            <div className="mb-3.5 flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">Cut list</h2>
                <div className="flex items-center gap-2">{props.actions?.(cutList)}</div>
            </div>

            <div className="mb-3.5 grid grid-cols-2 gap-2" data-testid="cutlist-totals">
                {/* Size first; cost and offcut last, next to the advice that explains the offcut. */}
                {overall !== null && (
                    <div
                        className="bg-surface-2 col-span-2 rounded-lg px-3 py-2.5"
                        data-testid="cutlist-overall"
                    >
                        <div className="text-muted text-xs">Overall (W × D × H)</div>
                        <div className="mt-0.5 text-lg font-semibold">
                            {dims(overall.width, overall.depth, overall.height)}
                        </div>
                        {cutList.totals.weight > 0 && (
                            <div
                                className="text-muted mt-0.5 text-xs"
                                title="The wood alone, at typical densities for its materials; hardware not included"
                                data-testid="cutlist-weight"
                            >
                                About {weight(cutList.totals.weight)} of wood
                            </div>
                        )}
                        {cutList.totals.finishArea > 0 && (
                            <div
                                className="text-muted text-xs"
                                title="Both faces and every edge of each part; a coat at 100 sq ft a quart, as a brushed polyurethane or paint label gives it (oils go further)"
                                data-testid="cutlist-finish"
                            >
                                Finish: {finishArea(cutList.totals.finishArea)}
                            </div>
                        )}
                    </div>
                )}
                <Stat label="Board feet" value={cutList.totals.boardFeet.toFixed(1)} />
                <Stat label="Sheets" value={String(cutList.totals.sheetCount)} />
                {cutList.totals.estimatedCost === null && !readonly ? (
                    <button
                        className="bg-surface-2 hover:bg-fg/[0.07] rounded-lg px-3 py-2.5 text-left"
                        onClick={focusFirstPrice}
                        data-testid="cutlist-add-prices"
                    >
                        <div className="text-muted text-xs">Est. cost</div>
                        <div className="text-accent mt-0.5 text-[13px] font-semibold">
                            Add prices to see cost
                        </div>
                    </button>
                ) : (
                    <Stat
                        label="Est. cost"
                        value={money(cutList.totals.estimatedCost)}
                        title={
                            cutList.totals.hardwareCost !== undefined
                                ? `Materials ${money(cutList.totals.materialCost ?? 0)} + hardware ${money(cutList.totals.hardwareCost)}`
                                : undefined
                        }
                    />
                )}
                {/* A sheet much bigger than the job is offcut you keep, not waste: say so, and why. */}
                <Stat
                    label={advice.length > 0 ? 'Offcut' : 'Waste'}
                    value={pct(cutList.totals.wastePercent)}
                    tone={advice.length > 0 ? 'warn' : undefined}
                />
            </div>

            {advice.length > 0 && (
                <div
                    className="border-warn/30 bg-warn/10 text-warn-fg -mt-1.5 mb-4 rounded-lg border px-3 py-2 text-xs"
                    data-testid="stock-advice"
                >
                    {advice.map((a) => (
                        <p key={a.materialId}>{adviceText(a)}</p>
                    ))}
                </div>
            )}

            {tracking && piecesCut > 0 && (
                <div
                    className="bg-surface-2 mb-3 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                    data-testid="cutlist-progress"
                >
                    <span className="text-fg/75">
                        {piecesCut === pieces
                            ? `All ${plural(pieces, 'piece')} cut`
                            : `${piecesCut} of ${plural(pieces, 'piece')} cut`}
                    </span>
                    <button
                        className="text-accent hover:underline"
                        data-testid="cutlist-progress-clear"
                        onClick={progress.clear}
                    >
                        Clear
                    </button>
                </div>
            )}
            {sections.map((section, si) => (
                <div key={section.materialId} className="mb-4" data-testid="cutlist-section">
                    {(si === 0 || sections[si - 1].kind !== section.kind) && (
                        <SectionHeading>{kindLabel(section.kind)}</SectionHeading>
                    )}
                    <div className="bg-surface-2 mb-1.5 rounded-lg px-2.5 py-2">
                        <div className="truncate text-[13px] font-semibold">
                            {section.species && (
                                <span
                                    className="bg-accent/15 text-accent mr-1 rounded-full px-1.5 py-px text-xs font-semibold capitalize"
                                    data-testid="species-badge"
                                >
                                    {section.species}
                                </span>
                            )}
                            {section.materialName}
                        </div>
                        <div className="text-muted mt-0.5 text-xs">
                            <span data-testid="cutlist-stock">{stockLine(section, spec)}</span>
                            {section.cost !== null && <span> · {money(section.cost)}</span>}
                            <span> · {section.boardFeet.toFixed(1)} bd ft</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-px">
                        {section.groups.map((group) => {
                            const open = expanded.has(group.key);
                            const sel = groupSelected(group);
                            const ids = group.members.map((m) => m.partId);
                            const cutCount = ids.filter((id) => progress.cut.has(id)).length;
                            const groupCut = tracking && cutCount === ids.length;
                            return (
                                <div key={group.key} className="flex flex-col gap-px">
                                    <div className="flex items-stretch gap-px">
                                        {tracking && (
                                            <label
                                                className="hover:bg-fg/5 flex w-7 flex-none cursor-pointer items-center justify-center rounded-lg"
                                                title={groupCut ? 'Cut. Untick if not' : 'Tick off once cut'}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="accent-accent"
                                                    aria-label={`${group.label} cut`}
                                                    data-testid="cutlist-cut-tick"
                                                    checked={groupCut}
                                                    ref={(el) => {
                                                        if (el) el.indeterminate = cutCount > 0 && !groupCut;
                                                    }}
                                                    onChange={(e) => progress.set(ids, e.target.checked)}
                                                />
                                            </label>
                                        )}
                                        <button
                                            className={`flex flex-1 items-center gap-2.5 rounded-lg border px-2 py-2 text-left ${
                                                sel
                                                    ? 'border-accent/40 bg-accent/15'
                                                    : groupPartial(group)
                                                      ? 'border-accent/20 bg-accent/5'
                                                      : 'hover:bg-fg/5 border-transparent'
                                            }`}
                                            data-testid="cutlist-group-row"
                                            onClick={(e) => groupClick(group, e)}
                                        >
                                            <span
                                                className={`bg-surface-3 flex-none rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${group.qty > 1 ? 'text-fg' : 'text-muted'}`}
                                                data-testid="cutlist-qty"
                                            >
                                                ×{group.qty}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span
                                                    className={`block truncate text-[13px] font-semibold ${groupCut ? 'text-muted line-through' : ''}`}
                                                >
                                                    {group.label}
                                                </span>
                                                <span className="text-muted block truncate text-xs">
                                                    {FLAG_BADGES.filter((b) => group[b.key]).map((b) => (
                                                        <span
                                                            key={b.key}
                                                            className="bg-fg/10 text-muted mr-1 rounded-full px-1.5 py-px text-xs font-medium"
                                                            title={b.title}
                                                        >
                                                            {b.label}
                                                        </span>
                                                    ))}
                                                    <span className="whitespace-nowrap">
                                                        {dims(group.length, group.width, group.thickness)}
                                                    </span>
                                                </span>
                                            </span>
                                        </button>
                                        {group.members.length > 1 ? (
                                            <button
                                                className="text-faint hover:bg-fg/5 hover:text-fg/70 flex w-8 flex-none items-center justify-center rounded-lg"
                                                aria-expanded={open}
                                                title={open ? 'Hide parts' : 'Show the parts in this group'}
                                                data-testid="cutlist-group-expand"
                                                onClick={() => toggleExpanded(group.key)}
                                            >
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    className={`transition-transform ${open ? 'rotate-180' : ''}`}
                                                >
                                                    <path
                                                        d="M6 9l6 6 6-6"
                                                        stroke="currentColor"
                                                        strokeWidth="2.5"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                            </button>
                                        ) : (
                                            <span className="w-8 flex-none" aria-hidden="true" />
                                        )}
                                    </div>
                                    {open &&
                                        group.members.map((member) => {
                                            const hidden = hiddenIds?.has(member.partId) ?? false;
                                            return (
                                                <button
                                                    key={member.partId}
                                                    className={`mr-8 ml-6 flex items-center justify-between gap-2.5 rounded-lg border px-2 py-1.5 text-left ${
                                                        isSelected(member.partId)
                                                            ? 'border-accent/40 bg-accent/15'
                                                            : 'hover:bg-fg/5 border-transparent'
                                                    }`}
                                                    data-testid="cutlist-row"
                                                    onClick={(e) =>
                                                        props.onSelect?.(member.partId, additive(e))
                                                    }
                                                >
                                                    <span
                                                        className={`min-w-0 truncate text-[12px] ${hidden || progress.cut.has(member.partId) ? 'text-faint line-through' : 'text-fg/70'}`}
                                                    >
                                                        {member.name}
                                                    </span>
                                                    <span className="flex flex-none items-center gap-1.5">
                                                        <span className="text-muted text-xs">
                                                            ×{member.qty}
                                                        </span>
                                                        {props.onToggleHidden && (
                                                            <span
                                                                role="button"
                                                                className={`hover:bg-fg/10 flex h-5 w-5 items-center justify-center rounded text-xs ${hidden ? 'text-muted' : 'text-faint'}`}
                                                                title={
                                                                    hidden
                                                                        ? 'Show in the 3D view'
                                                                        : 'Hide in the 3D view'
                                                                }
                                                                data-testid={`cutlist-eye-${member.partId}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    props.onToggleHidden?.(member.partId);
                                                                }}
                                                            >
                                                                {hidden ? (
                                                                    <EyeOff size={14} aria-hidden="true" />
                                                                ) : (
                                                                    <Eye size={14} aria-hidden="true" />
                                                                )}
                                                            </span>
                                                        )}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {(cutList.sheets.some((plan) => (plan.cuts ?? []).length > 0) ||
                cutList.lumber.some((plan) => (plan.sawCuts ?? []).length > 0)) && (
                <label className="text-fg/75 mb-3 flex cursor-pointer items-center gap-2 text-[13px]">
                    <input
                        checked={cutOrder}
                        type="checkbox"
                        data-testid="cutlist-cut-order"
                        className="accent-accent"
                        onChange={(e) => setCutOrder(e.target.checked)}
                    />
                    Show the cut order and fence settings
                </label>
            )}
            {cutList.sheets.map((plan) => (
                <div key={plan.materialId} className="mb-4">
                    <SectionHeading>
                        {plan.materialName}: {plural(plan.sheetCount, 'sheet')}
                        {(plan.offcuts ?? []).length > 0 &&
                            ` + ${plural(plan.offcuts!.length, 'piece')} on hand`}
                        , {pct(plan.waste)} offcut
                    </SectionHeading>
                    <div className="space-y-3">
                        {Array.from({ length: plan.sheetCount }, (_, n) => (
                            <div key={n}>
                                <SheetDiagram plan={plan} sheet={n} cutOrder={cutOrder} done={done} />
                                {cutOrder && <CutSteps cuts={plan.cuts} sheet={n} trim={plan.trim} />}
                            </div>
                        ))}
                        {(plan.offcuts ?? []).map((o, i) => (
                            <div key={o.id} data-testid="cutlist-on-hand-sheet">
                                <p className="text-muted mb-1 text-xs">
                                    On hand, {len(o.l)} × {len(o.w ?? 0)}
                                </p>
                                <SheetDiagram
                                    plan={plan}
                                    sheet={plan.sheetCount + i}
                                    size={{ l: o.l, w: o.w ?? 0 }}
                                    cutOrder={cutOrder}
                                    done={done}
                                />
                                {cutOrder && <CutSteps cuts={plan.cuts} sheet={plan.sheetCount + i} />}
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {cutList.lumber.map((plan) => (
                <div key={plan.materialId} className="mb-4" data-testid="cutlist-boards">
                    <SectionHeading>
                        {plan.materialName}: {plural(plan.stickCount, boardWord(spec, plan.materialId))}
                        {boughtBoards(plan).length > 1
                            ? ` (${boardSizes(plan, len)})`
                            : ` of ${len(plan.stockLength)}`}
                        {(plan.offcuts ?? []).length > 0 &&
                            ` + ${plural(plan.offcuts!.length, 'piece')} on hand`}
                        , {pct(plan.waste)} offcut
                    </SectionHeading>
                    <div className="space-y-1.5">
                        {Array.from({ length: plan.stickCount }, (_, n) => (
                            <div key={n}>
                                <BoardDiagram
                                    plan={plan}
                                    board={n}
                                    parts={cutList.parts}
                                    length={boardLength(plan, n)}
                                    cutOrder={cutOrder}
                                    done={done}
                                />
                                {cutOrder && <CutSteps cuts={plan.sawCuts} sheet={n} trim={plan.trim} ends />}
                            </div>
                        ))}
                        {(plan.offcuts ?? []).map((o, i) => (
                            <div key={o.id} data-testid="cutlist-on-hand-board">
                                <p className="text-muted mb-1 text-xs">On hand, {len(o.l)}</p>
                                <BoardDiagram
                                    plan={plan}
                                    board={plan.stickCount + i}
                                    parts={cutList.parts}
                                    length={o.l}
                                    cutOrder={cutOrder}
                                    done={done}
                                />
                                {cutOrder && <CutSteps cuts={plan.sawCuts} sheet={plan.stickCount + i} />}
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {cutList.hardware.length > 0 && (
                <div className="mb-4" data-testid="cutlist-hardware">
                    <div className="flex items-baseline justify-between">
                        <SectionHeading>Hardware</SectionHeading>
                        {!readonly && (
                            <button
                                className="text-accent mb-2 text-xs font-semibold"
                                aria-pressed={pricing}
                                data-testid="hardware-prices-toggle"
                                onClick={() => {
                                    setPricing(!pricing);
                                    if (!pricing) setFastenersOpen(true);
                                }}
                            >
                                {pricing
                                    ? 'Done'
                                    : cutList.totals.hardwareCost !== undefined
                                      ? 'Prices'
                                      : 'Add prices'}
                            </button>
                        )}
                    </div>
                    {pricing && (
                        <p className="text-faint mb-2 text-xs">
                            Prices are each (banding per foot or metre) and apply to every design.
                        </p>
                    )}
                    <div className="bg-surface-2 rounded-lg px-3 py-1">
                        {fasteners.length > 0 && (
                            <>
                                <button
                                    className="border-fg/5 flex w-full items-center justify-between gap-2 border-b py-2 text-left last:border-0"
                                    aria-expanded={fastenersOpen}
                                    onClick={() => setFastenersOpen(!fastenersOpen)}
                                    data-testid="cutlist-fasteners"
                                >
                                    <span className="text-fg/70">
                                        {fastenersOpen ? (
                                            <ChevronDown
                                                size={13}
                                                aria-hidden="true"
                                                className="text-faint mr-1 inline"
                                            />
                                        ) : (
                                            <ChevronRight
                                                size={13}
                                                aria-hidden="true"
                                                className="text-faint mr-1 inline"
                                            />
                                        )}
                                        Fasteners{' '}
                                        <span className="text-faint">
                                            ({fasteners.length} {fasteners.length === 1 ? 'kind' : 'kinds'})
                                        </span>
                                    </span>
                                    <span className="shrink-0 font-semibold">
                                        ×{fasteners.reduce((n, r) => n + r.qty, 0)}
                                    </span>
                                </button>
                                {fastenersOpen &&
                                    fasteners.map((row) => (
                                        <HardwareLine key={row.key} row={row} indent pricing={pricing} />
                                    ))}
                            </>
                        )}
                        {fittings.map((row) => (
                            <HardwareLine key={row.key} row={row} pricing={pricing} />
                        ))}
                    </div>
                </div>
            )}

            {steps.length > 0 && (
                <div className="mb-4" data-testid="cutlist-assembly">
                    <button
                        className="mb-2 flex w-full items-center text-left"
                        aria-expanded={assemblyOpen}
                        onClick={() => setAssemblyOpen(!assemblyOpen)}
                        data-testid="cutlist-assembly-toggle"
                    >
                        {assemblyOpen ? (
                            <ChevronDown size={13} aria-hidden="true" className="text-faint mr-1" />
                        ) : (
                            <ChevronRight size={13} aria-hidden="true" className="text-faint mr-1" />
                        )}
                        <span className="text-muted text-xs font-semibold tracking-wider uppercase">
                            Assembly order
                        </span>
                        <span className="text-faint ml-1 text-xs">({plural(steps.length, 'step')})</span>
                    </button>
                    {assemblyOpen && (
                        <ol className="bg-surface-2 space-y-2 rounded-lg px-3 py-2">
                            {steps.map((step, i) => (
                                <li key={i} data-testid="assembly-step">
                                    <div className="font-medium">
                                        {i + 1}. {step.heading}
                                    </div>
                                    {step.lines.map((line, j) => (
                                        <div key={j} className="text-fg/70 pl-4">
                                            {line}
                                        </div>
                                    ))}
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}

            {work.parts.length > 0 && (
                <div className="mb-4" data-testid="cutlist-joinery">
                    <button
                        className="mb-2 flex w-full items-center text-left"
                        aria-expanded={joineryOpen}
                        onClick={() => setJoineryOpen(!joineryOpen)}
                        data-testid="cutlist-joinery-toggle"
                    >
                        {joineryOpen ? (
                            <ChevronDown size={13} aria-hidden="true" className="text-faint mr-1" />
                        ) : (
                            <ChevronRight size={13} aria-hidden="true" className="text-faint mr-1" />
                        )}
                        <span className="text-muted text-xs font-semibold tracking-wider uppercase">
                            Joinery
                        </span>
                        <span className="text-faint ml-1 text-xs">
                            ({plural(work.setups.length, 'tool setup')})
                        </span>
                    </button>
                    {joineryOpen && (
                        <div className="bg-surface-2 space-y-2 rounded-lg px-3 py-2">
                            {work.setups.length > 0 && (
                                <ul className="space-y-1" aria-label="Tool setups">
                                    {work.setups.map((s) => (
                                        <li key={s.setup} data-testid="joinery-setup">
                                            <span className="font-medium">{s.setup}</span>
                                            <span className="text-faint">
                                                {' '}
                                                · {plural(s.cuts, 'cut')}: {s.parts}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {work.parts.map((j) => (
                                <div key={j.parts} data-testid="joinery-part">
                                    <div className="font-medium">{j.parts}</div>
                                    {j.lines.map((line, i) => (
                                        <div key={i} className="text-fg/70 pl-4">
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!readonly && <OnHandSection spec={spec} cutList={cutList} />}

            <div className="mb-4" data-testid="cutlist-settings">
                <SectionHeading>Stock &amp; kerf</SectionHeading>
                <label className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-muted">Saw kerf</span>
                    {readonly ? (
                        <span data-testid="kerf-value">{fmt(kerf)}</span>
                    ) : (
                        <select
                            value={kerf}
                            data-testid="kerf-select"
                            className="bg-surface-2 border-fg/10 h-7 rounded-lg border px-1.5 text-xs"
                            onChange={(e) => props.onKerfChange?.(Number(e.target.value))}
                        >
                            {KERF_OPTIONS.map((k) => (
                                <option key={k} value={k}>
                                    {fmt(k)}
                                </option>
                            ))}
                        </select>
                    )}
                </label>
                {!readonly && (
                    <>
                        <TrimSelect
                            setting="sheetTrim"
                            value={sheetTrim}
                            label="Trim sheet edges"
                            title="Cut off every edge of a bought sheet before the parts: factory edges are often dinged or out of square"
                        />
                        <TrimSelect
                            setting="boardTrim"
                            value={boardTrim}
                            label="Trim board ends"
                            title="Cut off each end of a bought board before the parts: ends are often checked or sniped"
                        />
                    </>
                )}
                {spec.materials.map((material) => {
                    const uses = materialUse.get(material.id) ?? 0;
                    const blocked = undeletable(material);
                    return (
                        <div
                            key={material.id}
                            className="bg-surface-2 mb-2 rounded-lg p-3"
                            data-testid="material-row"
                        >
                            <div className="mb-2 flex items-center gap-2">
                                {readonly ? (
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                        {material.name}
                                    </span>
                                ) : (
                                    <>
                                        <input
                                            key={material.name}
                                            defaultValue={material.name}
                                            aria-label="Material name"
                                            data-testid={`material-name-${material.id}`}
                                            className="bg-surface-1 focus:border-accent border-fg/10 h-7 min-w-0 flex-1 rounded-lg border px-2 text-xs focus:outline-none"
                                            onBlur={(e) => {
                                                const name = e.target.value.trim().slice(0, 80);
                                                if (name !== '' && name !== material.name)
                                                    props.onMaterial?.(material.id, { name });
                                            }}
                                        />
                                        <button
                                            disabled={blocked !== null}
                                            title={blocked ?? 'Remove this material'}
                                            data-testid={`material-delete-${material.id}`}
                                            className="text-muted enabled:hover:bg-danger/15 enabled:hover:text-danger-fg flex-none rounded px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30"
                                            aria-label="Remove this material"
                                            onClick={() => props.onDeleteMaterial?.(material.id)}
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="text-muted mb-2 text-xs">
                                <span data-testid={`material-use-${material.id}`}>
                                    {uses === 0 ? 'Unused' : `Used by ${uses}`}
                                </span>{' '}
                                · {material.type} · {fmt(material.thickness)}
                                {material.type === 'round' ? ' dia.' : ''}
                                {material.type !== 'sheet' && ` · ${stockLabel(material)}`}
                            </div>
                            {material.type === 'sheet' && material.sheetSize !== undefined && (
                                <div className="flex items-center gap-2">
                                    {readonly ? (
                                        <>
                                            <span className="text-muted text-xs">
                                                {sizeOf(material.sheetSize.l, material.sheetSize.w)}
                                            </span>
                                            {material.costPerSheet !== undefined && (
                                                <span className="text-muted ml-auto text-xs">
                                                    ${material.costPerSheet}/sheet
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <FractionCell
                                                value={material.sheetSize.l}
                                                testId="sheet-l"
                                                label={`Sheet length of ${material.name}`}
                                                onCommit={(v) => commitSheet(material, 'l', v)}
                                            />
                                            <span className="text-muted">×</span>
                                            <FractionCell
                                                value={material.sheetSize.w}
                                                testId="sheet-w"
                                                label={`Sheet width of ${material.name}`}
                                                onCommit={(v) => commitSheet(material, 'w', v)}
                                            />
                                            <span className="text-muted ml-auto">$</span>
                                            <input
                                                key={String(material.costPerSheet)}
                                                defaultValue={material.costPerSheet ?? ''}
                                                type="number"
                                                min="0"
                                                placeholder="cost"
                                                aria-label={`Price per sheet of ${material.name}`}
                                                data-testid="material-price"
                                                className="bg-surface-1 focus:border-accent border-fg/10 h-7 w-16 rounded-lg border px-1 text-center text-xs focus:outline-none"
                                                onBlur={(e) => {
                                                    const v = Number(e.target.value);
                                                    if (
                                                        e.target.value !== '' &&
                                                        Number.isFinite(v) &&
                                                        v >= 0 &&
                                                        v !== material.costPerSheet
                                                    ) {
                                                        props.onMaterial?.(material.id, { costPerSheet: v });
                                                    }
                                                }}
                                            />
                                        </>
                                    )}
                                </div>
                            )}
                            {material.type !== 'sheet' && (
                                <BoardPrice
                                    material={material}
                                    readonly={readonly}
                                    onCommit={(v) => props.onMaterial?.(material.id, { costPerBoardFoot: v })}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** One physical sheet with its placed parts (SVG origin is top-left, so y flips). */
export function SheetDiagram({
    plan,
    sheet,
    size = plan.sheetSize,
    cutOrder = false,
    done,
}: {
    plan: CutList['sheets'][number];
    sheet: number;
    /** A piece on hand's own size; a bought sheet is the plan's. */
    size?: { l: number; w: number };
    /** Draw the saw cuts, numbered in the order to make them. */
    cutOrder?: boolean;
    /** Parts ticked off as cut, drawn faded. */
    done?: ReadonlySet<string>;
}) {
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
            <rect width={size.l} height={size.w} fill="#16171b" stroke="#3a3d44" strokeWidth="0.3" />
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
                .map((left) => (
                    <rect
                        key={`left-${left.x}-${left.y}`}
                        x={left.x}
                        y={size.w - left.y - (left.w ?? 0)}
                        width={left.l}
                        height={left.w ?? 0}
                        fill="none"
                        stroke="#a3a3a3"
                        strokeWidth="0.3"
                        strokeDasharray="1.5 1"
                        data-testid="cutlist-leftover"
                    >
                        <title>
                            Leftover worth keeping: {len(left.l)} × {len(left.w ?? 0)}
                        </title>
                    </rect>
                ))}
            {plan.placements
                .filter((p) => p.sheet === sheet)
                .map((p) => {
                    const y = size.w - p.y - p.h;
                    return (
                        <g key={`${p.partId}-${p.x}-${p.y}`}>
                            <rect
                                x={p.x}
                                y={y}
                                width={p.w}
                                height={p.h}
                                fill="#b98a55"
                                fillOpacity={done?.has(p.partId) ? 0.3 : 0.85}
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
                                {p.name}
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
/** "Trim sheet edges" or "Trim board ends": one of the trim settings, saved as it changes. */
function TrimSelect({
    setting,
    value,
    label,
    title,
}: {
    setting: TrimKey;
    value: number;
    label: string;
    title: string;
}) {
    return (
        <label className="mb-2 flex items-center justify-between gap-2">
            <span className="text-muted" title={title}>
                {label}
            </span>
            <select
                value={value}
                data-testid={setting === 'sheetTrim' ? 'sheet-trim-select' : 'board-trim-select'}
                className="bg-surface-2 border-fg/10 h-7 rounded-lg border px-1.5 text-xs"
                onChange={(e) => void saveTrim(setting, Number(e.target.value))}
            >
                {TRIM_OPTIONS[setting].map((t) => (
                    <option key={t} value={t}>
                        {t === 0 ? 'None' : fmt(t)}
                    </option>
                ))}
            </select>
        </label>
    );
}

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
    done,
}: {
    plan: CutList['lumber'][number];
    board: number;
    parts: CutList['parts'];
    /** A piece on hand's own length; a bought board is the plan's. */
    length?: number;
    /** Draw the saw cuts, numbered in the order to make them. */
    cutOrder?: boolean;
    /** Parts ticked off as cut, drawn faded. */
    done?: ReadonlySet<string>;
}) {
    const width = (id: string) => parts.find((r) => r.partId === id)?.width ?? 0;
    const cuts = plan.cuts.filter((c) => c.stick === board);
    const across = plan.stockWidth ?? Math.max(...plan.cuts.map((c) => width(c.partId)), 1);
    const ripped = cuts.some((c) => (c.y ?? 0) > 0);
    const at = (v: number, of: number) => `${(v / of) * 100}%`;
    return (
        <div
            className="bg-surface-2 border-fg/10 relative overflow-hidden rounded border"
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
                        className="absolute inset-y-0.5 rounded-sm border border-dashed border-neutral-400"
                        style={{ left: at(left.x, length), width: at(left.l, length) }}
                        title={`Leftover worth keeping: ${len(left.l)}`}
                        data-testid="cutlist-leftover"
                    />
                ))}
            {cuts.map((c) => {
                const y = c.y ?? 0;
                // Across the board, a piece of full width fills the bar.
                const w = ripped ? width(c.partId) : across;
                return (
                    <div
                        key={`${c.partId}-${c.x}-${y}`}
                        className="absolute truncate rounded-sm border border-amber-900 px-1 text-xs leading-none text-stone-900"
                        style={{
                            left: at(c.x, length),
                            width: at(c.length, length),
                            bottom: at(y, across),
                            height: at(Math.min(w, across), across),
                            background: 'rgb(185 138 85 / 0.85)',
                            opacity: done?.has(c.partId) ? 0.35 : 1,
                            display: 'flex',
                            alignItems: 'center',
                        }}
                        title={`${c.name}, ${len(c.length)}`}
                    >
                        {c.name}
                    </div>
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

function Stat({
    label,
    value,
    tone,
    title,
}: {
    label: string;
    value: string;
    tone?: 'warn';
    title?: string;
}) {
    return (
        <div
            title={title}
            className={`rounded-lg px-3 py-2.5 ${tone === 'warn' ? 'bg-warn/10 border-warn/30 border' : 'bg-surface-2'}`}
            data-tone={tone}
        >
            <div className={`text-xs ${tone === 'warn' ? 'text-warn-fg' : 'text-muted'}`}>{label}</div>
            <div className={`mt-0.5 text-lg font-semibold ${tone === 'warn' ? 'text-warn-fg' : ''}`}>
                {value}
            </div>
        </div>
    );
}

/** One line of the hardware list; with `pricing`, a box for its price. */
function HardwareLine({
    row,
    indent = false,
    pricing = false,
}: {
    row: CutList['hardware'][number];
    indent?: boolean;
    pricing?: boolean;
}) {
    const per = row.kind === 'edgeBanding' ? (row.key.endsWith('|m') ? 'per m' : 'per ft') : 'each';
    return (
        <div
            className={`border-fg/5 flex items-center justify-between gap-2 border-b py-2 last:border-0 ${indent ? 'pl-4' : ''}`}
            data-testid="hardware-line"
        >
            <span className="text-fg/70">{row.description}</span>
            <span className="flex shrink-0 items-center gap-2">
                {pricing ? (
                    <label className="text-faint flex items-center gap-1 text-xs">
                        $
                        <input
                            key={row.unitPrice ?? 'none'}
                            defaultValue={row.unitPrice ?? ''}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            aria-label={`Price ${per} for ${row.description}`}
                            data-testid="hardware-price"
                            className="bg-surface-1 focus:border-accent border-fg/10 text-fg h-7 w-16 rounded-lg border px-1 text-center text-xs focus:outline-none"
                            onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const v = Number(raw);
                                if (raw === '') {
                                    if (row.unitPrice !== undefined) void saveHardwarePrice(row.key, null);
                                } else if (Number.isFinite(v) && v >= 0 && v !== row.unitPrice) {
                                    void saveHardwarePrice(row.key, v);
                                }
                            }}
                        />
                        {per}
                    </label>
                ) : (
                    row.cost !== undefined && (
                        <span className="text-faint text-xs" data-testid="hardware-cost">
                            {money(row.cost)}
                        </span>
                    )
                )}
                <span className="font-semibold">×{row.qty}</span>
            </span>
        </div>
    );
}

/** Screws, pocket screws and dowels: bought by the box, so they fold into one line. */
const FASTENER_KINDS = new Set(['pocketScrew', 'woodScrew', 'dowel']);

function SectionHeading({ children }: { children: React.ReactNode }) {
    return <h3 className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">{children}</h3>;
}

/** A fraction input that commits on blur/Enter and snaps back when the value is rejected. */
function FractionCell({
    value,
    testId,
    label,
    onCommit,
}: {
    value: number;
    testId: string;
    label: string;
    onCommit: (raw: string) => void;
}) {
    return (
        <input
            key={value}
            defaultValue={lenValue(value)}
            aria-label={label}
            data-testid={testId}
            className="bg-surface-1 focus:border-accent border-fg/10 h-7 w-16 rounded-lg border px-1 text-center text-xs focus:outline-none"
            onBlur={(e) => {
                onCommit(e.target.value);
                e.target.value = lenValue(value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
    );
}
