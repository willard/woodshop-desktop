/** The exported plan: a project as one self-contained, view-only page. */
import { useMemo, useRef, useState } from 'react';
import { KeepAwake } from './KeepAwake';
import { CutListPanel } from '@/components/CutListPanel';
import { BuildStepBar, hiddenAtStep } from '@/components/BuildStepBar';
import { assemblyOrder } from '@/cutlist';
import { useBuildProgress } from '@/cutlist/progress';
import type { ThemeName } from '@/engine/theme';
import { ViewerCanvas, type ViewerCanvasHandle } from './ViewerCanvas';
import { PartDetail } from './PartDetail';
import { orderNotes, type ExportPayload } from './payload';

/** `arHref`: the AR model beside the page, where the browser has AR Quick Look. */
export function ViewerApp({ payload, arHref }: { payload: ExportPayload; arHref?: string }) {
    const [theme, setTheme] = useState<ThemeName>(payload.theme);
    const [tab, setTab] = useState<'cutlist' | 'part'>('cutlist');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
    const viewer = useRef<ViewerCanvasHandle>(null);
    /** Stepping through the build on a tablet: the step shown, or null for the whole piece. */
    const [buildStep, setBuildStep] = useState<number | null>(null);
    const steps = useMemo(() => assemblyOrder(payload.spec, payload.units), [payload.spec, payload.units]);
    const buildProgress = useBuildProgress(`viewer:${payload.spec.name}`);
    // While building, the parts not yet built hide and the step's new parts are outlined.
    const shownHidden = useMemo(
        () =>
            buildStep === null
                ? hiddenIds
                : hiddenAtStep(
                      payload.spec.parts.map((p) => p.id),
                      steps,
                      buildStep,
                  ),
        [buildStep, hiddenIds, payload.spec, steps],
    );
    const selectedIds = useMemo(
        () => (buildStep !== null ? steps[buildStep].partIds : selectedId === null ? [] : [selectedId]),
        [buildStep, steps, selectedId],
    );
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

    // Bigger on a touch screen: the plan is read on a tablet in the shop.
    const btn =
        'border-fg/10 text-fg/75 hover:bg-fg/5 h-8 rounded-lg border px-2.5 text-xs pointer-coarse:h-11 pointer-coarse:px-3.5 pointer-coarse:text-sm';
    return (
        <div className="bg-surface-0 text-fg-strong flex h-full flex-col" data-print="flow">
            <header
                className="border-fg/10 flex flex-none items-center gap-3 border-b px-4 py-2.5"
                data-testid="viewer-header"
            >
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-[15px] font-semibold">{payload.projectName}</h1>
                    <p className="text-faint text-xs">
                        {exportedOn && <span>Exported {exportedOn} · </span>}Woodshop · view-only plan
                    </p>
                </div>
                {steps.length > 0 && (
                    <button
                        className={btn}
                        data-print="hide"
                        data-testid="viewer-build"
                        title="Step through the build, one step at a time"
                        onClick={() => setBuildStep(buildStep === null ? 0 : null)}
                    >
                        {buildStep === null ? 'Build' : 'Show all'}
                    </button>
                )}
                <KeepAwake className={btn} />
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
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-print="flow">
                <div className="relative flex h-[50vh] min-h-0 flex-none lg:h-auto lg:flex-1">
                    <ViewerCanvas
                        ref={viewer}
                        spec={payload.spec}
                        theme={theme}
                        selectedIds={selectedIds}
                        hiddenIds={shownHidden}
                        onPick={select}
                        arHref={arHref}
                        models={payload.models}
                    />
                    {buildStep !== null && (
                        <BuildStepBar
                            steps={steps}
                            index={buildStep}
                            onStep={setBuildStep}
                            progress={buildProgress}
                        />
                    )}
                </div>
                <div
                    className="border-fg/10 flex min-h-0 flex-1 flex-col border-t lg:w-[26rem] lg:flex-none lg:border-t-0 lg:border-l"
                    data-print="flow"
                >
                    <div className="border-fg/10 flex flex-none gap-1 border-b px-3 pt-2" data-print="hide">
                        {(['cutlist', 'part'] as const).map((option) => (
                            <button
                                key={option}
                                className={`-mb-px rounded-t-lg border border-b-0 px-3 py-1.5 text-xs pointer-coarse:px-4 pointer-coarse:py-2.5 pointer-coarse:text-sm ${
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
                                // Ticks are kept in this browser, by the design's name.
                                progressKey={`viewer:${payload.spec.name}`}
                                spec={payload.spec}
                                kerf={payload.kerf}
                                selectedIds={selectedIds}
                                hiddenIds={hiddenIds}
                                onSelect={select}
                                onToggleHidden={toggleHidden}
                                onBuildStep={setBuildStep}
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
                    <h2 className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
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
            {(payload.spec.models ?? []).length > 0 && (
                <p
                    className="border-fg/10 text-muted flex-none border-t px-4 py-2 text-xs"
                    data-testid="viewer-model-credits"
                    data-print="keep"
                >
                    3D models shown with it, not part of the build:{' '}
                    {(payload.spec.models ?? [])
                        .map(
                            (m) =>
                                m.name +
                                (m.source !== undefined ? `, from ${m.source}` : '') +
                                (m.license !== undefined ? ` (${m.license})` : ''),
                        )
                        .join('; ')}
                    .
                </p>
            )}
        </div>
    );
}
