/**
 * The design as a list: doors and drawers, then groups, then the parts that belong to neither.
 * A part hidden deep inside a cabinet can be selected, renamed or hidden from here without
 * hunting for it in the 3D view.
 */
import { useMemo, useState } from 'react';
import type { Spec } from '@/spec';

interface Props {
    spec: Spec;
    selectedIds: readonly string[];
    hiddenIds: ReadonlySet<string>;
    /** Select a part; `additive` with Shift/⌘, as in the 3D view. */
    onSelect(partId: string, additive: boolean): void;
    onToggleHidden(partId: string): void;
    onRename(partId: string, name: string): void;
}

interface Section {
    key: string;
    title: string;
    /** What the section's header selects: a door's panel, a group's first member. */
    anchor: string | null;
    partIds: string[];
}

export function PartsOutline(props: Props) {
    const { spec } = props;
    const sections = useMemo(() => outlineOf(spec), [spec]);
    const names = useMemo(() => new Map(spec.parts.map((p) => [p.id, p.name])), [spec]);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const toggle = (key: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    return (
        <nav
            aria-label="Parts"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2"
            data-testid="outline"
        >
            {sections.map((section) =>
                section.title === '' ? (
                    <ul key={section.key} className="flex flex-col">
                        {section.partIds.map((id) => (
                            <Row key={id} id={id} name={names.get(id) ?? id} depth={0} {...props} />
                        ))}
                    </ul>
                ) : (
                    <div key={section.key} className="mb-1" data-testid="outline-section">
                        <button
                            className="text-muted hover:text-fg-strong flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11.5px] font-semibold"
                            aria-expanded={!collapsed.has(section.key)}
                            onClick={() => toggle(section.key)}
                        >
                            <span aria-hidden="true" className="w-3 text-[9px]">
                                {collapsed.has(section.key) ? '▶' : '▼'}
                            </span>
                            <span className="truncate">{section.title}</span>
                            <span className="text-faint ml-auto font-normal">{section.partIds.length}</span>
                        </button>
                        {!collapsed.has(section.key) && (
                            <ul className="flex flex-col">
                                {section.partIds.map((id) => (
                                    <Row key={id} id={id} name={names.get(id) ?? id} depth={1} {...props} />
                                ))}
                            </ul>
                        )}
                    </div>
                ),
            )}
        </nav>
    );
}

function Row({
    id,
    name,
    depth,
    selectedIds,
    hiddenIds,
    onSelect,
    onToggleHidden,
    onRename,
}: Props & { id: string; name: string; depth: number }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const selected = selectedIds.includes(id);
    const hidden = hiddenIds.has(id);

    function commit(): void {
        setEditing(false);
        const next = draft.trim();
        if (next !== '' && next !== name) onRename(id, next);
        else setDraft(name);
    }

    return (
        <li
            className={`group flex items-center gap-1 pr-1.5 ${selected ? 'bg-accent/15' : 'hover:bg-fg/[0.05]'}`}
            style={{ paddingLeft: 12 + depth * 14 }}
            data-testid="outline-row"
            data-selected={selected || undefined}
            data-hidden={hidden || undefined}
        >
            {editing ? (
                <input
                    autoFocus
                    value={draft}
                    maxLength={80}
                    aria-label="Part name"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commit();
                        if (e.key === 'Escape') {
                            setDraft(name);
                            setEditing(false);
                        }
                    }}
                    className="border-accent bg-surface-0 my-0.5 min-w-0 flex-1 rounded border px-1.5 py-0.5 text-[12.5px] focus:outline-none"
                    data-testid="outline-rename"
                />
            ) : (
                <button
                    className={`min-w-0 flex-1 truncate py-1 text-left text-[12.5px] ${hidden ? 'text-faint line-through' : selected ? 'text-fg-strong font-medium' : 'text-fg/80'}`}
                    title={`${name} — double-click to rename`}
                    onClick={(e) => onSelect(id, e.shiftKey || e.metaKey || e.ctrlKey)}
                    onDoubleClick={() => {
                        setDraft(name);
                        setEditing(true);
                    }}
                >
                    {name}
                </button>
            )}
            <button
                className={`text-faint hover:text-fg-strong flex h-6 w-6 flex-none items-center justify-center rounded ${hidden ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
                title={hidden ? 'Show' : 'Hide (H)'}
                onClick={() => onToggleHidden(id)}
                data-testid="outline-eye"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                    />
                    {hidden ? (
                        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    ) : (
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                    )}
                </svg>
            </button>
        </li>
    );
}

/** Doors and drawers first, then groups, then everything else (titled '' so it reads as loose). */
export function outlineOf(spec: Spec): Section[] {
    const claimed = new Set<string>();
    const sections: Section[] = [];
    let doors = 0;
    let drawers = 0;
    for (const movable of spec.movables ?? []) {
        const door = movable.kind === 'door';
        const n = door ? (doors += 1) : (drawers += 1);
        const anchor = door
            ? (movable as { panelPartId: string }).panelPartId
            : (movable as { frontPartId: string }).frontPartId;
        sections.push({
            key: `movable:${movable.id}`,
            title: movable.name ?? `${door ? 'Door' : 'Drawer'} ${n}`,
            anchor,
            partIds: [...movable.partIds],
        });
        for (const id of movable.partIds) claimed.add(id);
    }
    for (const group of spec.groups ?? []) {
        const members = group.partIds.filter((id) => !claimed.has(id));
        if (members.length === 0) continue;
        sections.push({
            key: `group:${group.id}`,
            title: group.name ?? 'Group',
            anchor: members[0],
            partIds: members,
        });
        for (const id of members) claimed.add(id);
    }
    const loose = spec.parts.map((p) => p.id).filter((id) => !claimed.has(id));
    if (loose.length > 0) sections.push({ key: 'loose', title: '', anchor: null, partIds: loose });
    return sections;
}
