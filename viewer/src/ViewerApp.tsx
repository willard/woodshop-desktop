/** The exported plan: a project as one self-contained, view-only page. */
import { useMemo, useRef, useState } from 'react';
import { CutListPanel } from '@/components/CutListPanel';
import type { ThemeName } from '@/engine/theme';
import { ViewerCanvas, type ViewerCanvasHandle } from './ViewerCanvas';
import { PartDetail } from './PartDetail';
import { orderNotes, type ExportPayload } from './payload';

export function ViewerApp({ payload }: { payload: ExportPayload }) {
    const [theme, setTheme] = useState<ThemeName>(payload.theme);
    const [tab, setTab] = useState<'cutlist' | 'part'>('cutlist');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
    const viewer = useRef<ViewerCanvasHandle>(null);
    const selectedIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId]);
    const selectedPart =
        selectedId === null ? null : (payload.spec.parts.find((p) => p.id === selectedId) ?? null);
    const notes = orderNotes(payload.notes);
    const exported = new Date(payload.exportedAt);
    const exportedOn = Number.isNaN(exported.valueOf())
        ? ''
        : exported.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

    /** Canvas and cut-list clicks both land here, so the two never disagree. */
    function select(partId: string | null): void {
        setSelectedId(partId);
        if (partId !== null) setTab('part');
    }

    function toggleHidden(partId: string): void {
        setHiddenIds((prev) => {
            const next = new Set(prev);
            if (!next.delete(partId)) next.add(partId);
            return next;
        });
    }

    const btn = 'border-fg/10 text-fg/75 hover:bg-fg/5 h-8 rounded-lg border px-2.5 text-xs';
    return (
        <div className="bg-surface-0 text-fg-strong flex h-full flex-col" data-print="flow">
            <header
                className="border-fg/10 flex flex-none items-center gap-3 border-b px-4 py-2.5"
                data-testid="viewer-header"
            >
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-[15px] font-semibold">{payload.projectName}</h1>
                    <p className="text-faint text-[11.5px]">
                        {exportedOn && <span>Exported {exportedOn} · </span>}Woodshop · view-only plan
                    </p>
                </div>
                <button
                    className={btn}
                    data-print="hide"
                    data-testid="viewer-theme"
                    title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
                    onClick={() => {
                        const next = theme === 'dark' ? 'light' : 'dark';
                        setTheme(next);
                        document.documentElement.dataset.theme = next;
                    }}
                >
                    {theme === 'dark' ? '☀' : '☾'}
                </button>
                <button
                    className={btn}
                    data-print="hide"
                    data-testid="viewer-print"
                    onClick={async () => {
                        await viewer.current?.capture();
                        window.print();
                    }}
                >
                    Print
                </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row" data-print="flow">
                <div className="flex h-[50vh] min-h-0 md:h-auto md:flex-1">
                    <ViewerCanvas
                        ref={viewer}
                        spec={payload.spec}
                        theme={theme}
                        selectedIds={selectedIds}
                        hiddenIds={hiddenIds}
                        onPick={select}
                    />
                </div>
                <div
                    className="border-fg/10 flex min-h-0 flex-none flex-col border-t md:w-[26rem] md:border-t-0 md:border-l"
                    data-print="flow"
                >
                    <div className="border-fg/10 flex flex-none gap-1 border-b px-3 pt-2" data-print="hide">
                        {(['cutlist', 'part'] as const).map((option) => (
                            <button
                                key={option}
                                className={`-mb-px rounded-t-lg border border-b-0 px-3 py-1.5 text-xs ${
                                    tab === option
                                        ? 'border-fg/10 bg-surface-1 text-fg-strong'
                                        : 'text-muted hover:text-fg-strong border-transparent'
                                }`}
                                data-testid={`viewer-tab-${option}`}
                                onClick={() => setTab(option)}
                            >
                                {option === 'cutlist' ? 'Cut list' : 'Part'}
                            </button>
                        ))}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-print="flow">
                        <div
                            className={`min-h-0 flex-1 flex-col ${tab === 'cutlist' ? 'flex' : 'hidden'}`}
                            data-print="always"
                        >
                            <CutListPanel
                                readonly
                                spec={payload.spec}
                                kerf={payload.kerf}
                                selectedIds={selectedIds}
                                hiddenIds={hiddenIds}
                                onSelect={select}
                                onToggleHidden={toggleHidden}
                            />
                        </div>
                        <div className={tab === 'part' ? 'block' : 'hidden'} data-print="always">
                            {selectedPart ? (
                                <PartDetail spec={payload.spec} part={selectedPart} />
                            ) : (
                                <p className="text-muted px-4 pt-3.5 text-sm" data-testid="part-empty">
                                    Pick a part — in the 3D view or the cut list — to see its dimensions,
                                    machining and joinery.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {notes.length > 0 && (
                <section
                    className="border-fg/10 flex-none border-t px-4 py-3"
                    data-testid="viewer-notes"
                    data-print="keep"
                >
                    <h2 className="text-muted mb-2 text-[11.5px] font-semibold tracking-wider uppercase">
                        Shop notes
                    </h2>
                    <ul className="space-y-1.5">
                        {notes.map((note, i) => (
                            <li
                                key={i}
                                className="bg-surface-2 rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-line"
                                data-testid="viewer-note"
                            >
                                {note.pinned && (
                                    <span className="text-accent mr-1" title="Pinned">
                                        ★
                                    </span>
                                )}
                                {note.body}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
