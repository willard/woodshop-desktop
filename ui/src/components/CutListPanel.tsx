/**
 * Dock panel: the cut list as a pure function of the spec. Row clicks select parts so the
 * Inspector can take over; shift/⌘-click extends the selection. `readonly` is the exported-plan
 * viewer: the same panel with nothing to change.
 */
import { useMemo, useState, type MouseEvent } from 'react';
import {
    computeCutList,
    groupCutList,
    stockAdvice,
    type CutList,
    type CutListGroup,
    type CutListSection,
} from '@/cutlist';
import { overallSize, type Material, type Spec } from '@/spec';
import { len, lenValue, parseLen } from '@/lib/display';

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
}

const KERF_OPTIONS = [0.0625, 0.09375, 0.125, 0.25];

const fmt = (n: number): string => `${len(n)}`;
const money = (n: number | null): string => (n === null ? '—' : `$${n.toFixed(2)}`);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const kindLabel = (kind: CutListSection['kind']): string =>
    kind === 'sheet' ? 'Sheet goods' : kind === 'lumber' ? 'Lumber' : 'Other stock';

function stockLine(section: CutListSection): string {
    if (section.stock === null) {
        return 'No stock plan for this material';
    }
    const { count, unit, l, w } = section.stock;
    const size = w === undefined ? fmt(l) : `${fmt(l)} × ${fmt(w)}`;
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
    const cutList = useMemo(() => computeCutList(spec, { kerf }), [spec, kerf]);
    const sections = useMemo(() => groupCutList(cutList), [cutList]);
    const advice = useMemo(() => stockAdvice(cutList, spec), [cutList, spec]);
    const overall = useMemo(() => overallSize(spec), [spec]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
                <Stat label="Board feet" value={cutList.totals.boardFeet.toFixed(1)} />
                <Stat label="Sheets" value={String(cutList.totals.sheetCount)} />
                <Stat label="Est. cost" value={money(cutList.totals.estimatedCost)} />
                <Stat label="Waste" value={pct(cutList.totals.wastePercent)} />
                {overall !== null && (
                    <div
                        className="bg-surface-2 col-span-2 rounded-lg px-3 py-2.5"
                        data-testid="cutlist-overall"
                    >
                        <div className="text-muted text-[11.5px]">Overall (W × D × H)</div>
                        <div className="mt-0.5 text-lg font-semibold">
                            {fmt(overall.width)} × {fmt(overall.depth)} × {fmt(overall.height)}
                        </div>
                    </div>
                )}
            </div>

            {advice.length > 0 && (
                <div
                    className="border-info/30 bg-info/10 text-info-fg mb-4 rounded-lg border px-3 py-2 text-xs"
                    data-testid="stock-advice"
                >
                    {advice.map((a) => (
                        <p key={a.materialId}>{a.message}</p>
                    ))}
                </div>
            )}

            {cutList.hardware.length > 0 && (
                <div className="mb-4" data-testid="cutlist-hardware">
                    <SectionHeading>Hardware</SectionHeading>
                    <div className="bg-surface-2 rounded-lg px-3 py-1">
                        {cutList.hardware.map((row) => (
                            <div
                                key={row.description}
                                className="border-fg/5 flex items-center justify-between gap-2 border-b py-2 last:border-0"
                            >
                                <span className="text-fg/70">{row.description}</span>
                                <span className="shrink-0 font-semibold">×{row.qty}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                                            onClick={() => props.onDeleteMaterial?.(material.id)}
                                        >
                                            ✕
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="text-muted mb-2 text-[11px]">
                                <span data-testid={`material-use-${material.id}`}>
                                    {uses === 0 ? 'Unused' : `Used by ${uses}`}
                                </span>{' '}
                                · {material.type} · {fmt(material.thickness)}
                                {material.type === 'round' ? ' dia.' : ''}
                            </div>
                            {material.type === 'sheet' && material.sheetSize !== undefined && (
                                <div className="flex items-center gap-2">
                                    {readonly ? (
                                        <>
                                            <span className="text-muted text-xs">
                                                {fmt(material.sheetSize.l)} × {fmt(material.sheetSize.w)}
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
                                                onCommit={(v) => commitSheet(material, 'l', v)}
                                            />
                                            <span className="text-muted">×</span>
                                            <FractionCell
                                                value={material.sheetSize.w}
                                                testId="sheet-w"
                                                onCommit={(v) => commitSheet(material, 'w', v)}
                                            />
                                            <span className="text-muted ml-auto">$</span>
                                            <input
                                                key={String(material.costPerSheet)}
                                                defaultValue={material.costPerSheet ?? ''}
                                                type="number"
                                                min="0"
                                                placeholder="cost"
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
                        </div>
                    );
                })}
            </div>

            {sections.map((section, si) => (
                <div key={section.materialId} className="mb-4" data-testid="cutlist-section">
                    {(si === 0 || sections[si - 1].kind !== section.kind) && (
                        <SectionHeading>{kindLabel(section.kind)}</SectionHeading>
                    )}
                    <div className="bg-surface-2 mb-1.5 rounded-lg px-2.5 py-2">
                        <div className="truncate text-[12.5px] font-semibold">
                            {section.species && (
                                <span
                                    className="bg-accent/15 text-accent mr-1 rounded-full px-1.5 py-px text-[10px] font-semibold capitalize"
                                    data-testid="species-badge"
                                >
                                    {section.species}
                                </span>
                            )}
                            {section.materialName}
                        </div>
                        <div className="text-muted mt-0.5 text-[11px]">
                            <span data-testid="cutlist-stock">{stockLine(section)}</span>
                            {section.cost !== null && <span> · {money(section.cost)}</span>}
                            <span> · {section.boardFeet.toFixed(1)} bd ft</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-px">
                        {section.groups.map((group) => {
                            const open = expanded.has(group.key);
                            const sel = groupSelected(group);
                            return (
                                <div key={group.key} className="flex flex-col gap-px">
                                    <div className="flex items-stretch gap-px">
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
                                                className={`bg-surface-3 flex-none rounded-md px-1.5 py-0.5 text-[12.5px] font-semibold tabular-nums ${group.qty > 1 ? 'text-fg' : 'text-muted'}`}
                                                data-testid="cutlist-qty"
                                            >
                                                ×{group.qty}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-semibold">
                                                    {group.label}
                                                </span>
                                                <span className="text-muted block truncate text-[11px]">
                                                    {FLAG_BADGES.filter((b) => group[b.key]).map((b) => (
                                                        <span
                                                            key={b.key}
                                                            className="bg-fg/10 text-muted mr-1 rounded-full px-1.5 py-px text-[10px] font-medium"
                                                            title={b.title}
                                                        >
                                                            {b.label}
                                                        </span>
                                                    ))}
                                                    <span className="whitespace-nowrap">
                                                        {fmt(group.length)} × {fmt(group.width)} ×{' '}
                                                        {fmt(group.thickness)}
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
                                                        className={`min-w-0 truncate text-[12px] ${hidden ? 'text-faint line-through' : 'text-fg/70'}`}
                                                    >
                                                        {member.name}
                                                    </span>
                                                    <span className="flex flex-none items-center gap-1.5">
                                                        <span className="text-muted text-[11px]">
                                                            ×{member.qty}
                                                        </span>
                                                        {props.onToggleHidden && (
                                                            <span
                                                                role="button"
                                                                className={`hover:bg-fg/10 flex h-5 w-5 items-center justify-center rounded text-[11px] ${hidden ? 'text-muted' : 'text-faint'}`}
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
                                                                {hidden ? '🙈' : '👁'}
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

            {cutList.sheets.map((plan) => (
                <div key={plan.materialId} className="mb-4">
                    <SectionHeading>
                        {plan.materialName} — {plan.sheetCount} sheet(s), {pct(plan.waste)} waste
                    </SectionHeading>
                    <div className="space-y-3">
                        {Array.from({ length: plan.sheetCount }, (_, n) => (
                            <SheetDiagram key={n} plan={plan} sheet={n} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** One physical sheet with its placed parts (SVG origin is top-left, so y flips). */
export function SheetDiagram({ plan, sheet }: { plan: CutList['sheets'][number]; sheet: number }) {
    return (
        <svg
            viewBox={`-1 -1 ${plan.sheetSize.l + 2} ${plan.sheetSize.w + 2}`}
            className="bg-surface-2 border-fg/10 w-full rounded-lg border"
            preserveAspectRatio="xMidYMid meet"
            data-testid="cutlist-sheet"
        >
            <rect
                width={plan.sheetSize.l}
                height={plan.sheetSize.w}
                fill="#16171b"
                stroke="#3a3d44"
                strokeWidth="0.3"
            />
            {plan.placements
                .filter((p) => p.sheet === sheet)
                .map((p) => {
                    const y = plan.sheetSize.w - p.y - p.h;
                    return (
                        <g key={`${p.partId}-${p.x}-${p.y}`}>
                            <rect
                                x={p.x}
                                y={y}
                                width={p.w}
                                height={p.h}
                                fill="#b98a55"
                                fillOpacity="0.85"
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
        </svg>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface-2 rounded-lg px-3 py-2.5">
            <div className="text-muted text-[11.5px]">{label}</div>
            <div className="mt-0.5 text-lg font-semibold">{value}</div>
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-muted mb-2 text-[11.5px] font-semibold tracking-wider uppercase">{children}</h3>
    );
}

/** A fraction input that commits on blur/Enter and snaps back when the value is rejected. */
function FractionCell({
    value,
    testId,
    onCommit,
}: {
    value: number;
    testId: string;
    onCommit: (raw: string) => void;
}) {
    return (
        <input
            key={value}
            defaultValue={lenValue(value)}
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
