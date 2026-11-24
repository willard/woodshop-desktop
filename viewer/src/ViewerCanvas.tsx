/**
 * Canvas host for the exported plan: the editor's own EditorEngine in view mode, with only the
 * presentation controls wired. There is no command layer here, so nothing can change the spec.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorEngine } from '@/engine/EditorEngine';
import { scenePalette, type ThemeName } from '@/engine/theme';
import { sizeGroups, type PlacedSize } from '@/engine/sizeLabels';
import { SizeLabels } from '@/components/SizeLabels';
import type { Spec } from '@/spec';
import { embeddedModel } from './payload';
import InlineCsgWorker from '@/engine/workers/csg.worker?worker&inline';

export interface ViewerCanvasHandle {
    capture(): Promise<void>;
}

export const ViewerCanvas = forwardRef<
    ViewerCanvasHandle,
    {
        spec: Spec;
        theme: ThemeName;
        selectedIds: readonly string[];
        hiddenIds: ReadonlySet<string>;
        onPick(id: string | null): void;
        /** The AR model beside the page, where AR Quick Look can open it. */
        arHref?: string;
        /** The imported models the page carries (spec 1.22), base64 by hash. */
        models?: Record<string, string>;
    }
>(function ViewerCanvas({ spec, theme, selectedIds, hiddenIds, onPick, arHref, models }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const engine = useRef<EditorEngine | null>(null);
    const pick = useRef(onPick);
    pick.current = onPick;
    const [explode, setExplode] = useState(0);
    const [open, setOpen] = useState(0);
    const [printShot, setPrintShot] = useState<string | null>(null);
    const [sizesOn, setSizesOn] = useState(false);
    const [sizeLabels, setSizeLabels] = useState<PlacedSize[]>([]);
    const hasMovables = (spec.movables?.length ?? 0) > 0;

    /**
     * Print a synchronously rendered PNG, not the live canvas (rendering is on demand, so the
     * buffer may be stale), always on the light palette so it does not print as a black box.
     */
    async function capture(): Promise<void> {
        const e = engine.current;
        if (e === null) return;
        e.setScenePalette(scenePalette('light'));
        const blob = await e.snapshot(2000);
        e.setScenePalette(scenePalette(theme));
        if (!blob) return;
        setPrintShot((old) => {
            if (old) URL.revokeObjectURL(old);
            return URL.createObjectURL(blob);
        });
        await new Promise((r) => requestAnimationFrame(r));
    }

    useImperativeHandle(ref, () => ({ capture }));

    useEffect(() => {
        if (canvas.current === null) return;
        const e = new EditorEngine(canvas.current, {
            scenePalette: scenePalette(theme),
            // The single-file page has no chunk to fetch, so the worker is inlined.
            csgWorkerFactory: () => new InlineCsgWorker(),
        });
        engine.current = e;
        e.setMode('view');
        e.pickHandler = (id) => pick.current(id);
        e.modelSource = async (hash) => embeddedModel(models ?? {}, hash);
        e.loadSpec(spec, { frame: true });
        const onBeforePrint = () => void capture();
        window.addEventListener('beforeprint', onBeforePrint);
        return () => {
            window.removeEventListener('beforeprint', onBeforePrint);
            e.dispose();
            engine.current = null;
        };
    }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => engine.current?.setScenePalette(scenePalette(theme)), [theme]);
    useEffect(() => engine.current?.setSelected(selectedIds), [selectedIds]);
    useEffect(() => engine.current?.setHidden(hiddenIds), [hiddenIds]);
    useEffect(() => {
        const e = engine.current;
        if (e === null) return;
        e.sizeLabelHandler = setSizeLabels;
        e.setSizeLabels(sizesOn ? sizeGroups(spec) : null);
    }, [sizesOn, spec]);

    return (
        <div className="relative min-h-0 flex-1" data-print="keep">
            <canvas ref={canvas} className="block h-full w-full touch-none" data-testid="viewer-canvas" />
            {sizesOn && <SizeLabels labels={sizeLabels} />}
            {printShot && (
                <img id="print-shot" src={printShot} alt="3D view of the finished piece" className="hidden" />
            )}
            <div
                className="bg-surface-1/90 border-fg/10 absolute right-3 bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 text-xs backdrop-blur sm:left-auto sm:w-72 pointer-coarse:text-sm sm:pointer-coarse:w-96"
                data-print="hide"
                data-testid="viewer-controls"
            >
                <label className="flex flex-1 items-center gap-2">
                    <span className="text-muted w-14 flex-none">Explode</span>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={explode}
                        className="accent-accent min-w-0 flex-1 pointer-coarse:h-8"
                        data-testid="explode"
                        aria-label="Explode the assembly"
                        onChange={(ev) => {
                            const v = Number(ev.target.value);
                            setExplode(v);
                            engine.current?.setExplode(v);
                            setOpen(engine.current?.getOpen() ?? 0);
                        }}
                    />
                </label>
                {hasMovables && (
                    <label className="flex flex-1 items-center gap-2">
                        <span className="text-muted w-14 flex-none">Open</span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={open}
                            className="accent-accent min-w-0 flex-1 pointer-coarse:h-8"
                            data-testid="open"
                            aria-label="Open the doors and drawers"
                            onChange={(ev) => {
                                const v = Number(ev.target.value);
                                setOpen(v);
                                engine.current?.setOpen(v);
                                setExplode(engine.current?.getExplode() ?? 0);
                            }}
                        />
                    </label>
                )}
                <button
                    className={`border-fg/10 h-7 rounded-lg border px-2.5 pointer-coarse:h-10 pointer-coarse:px-4 ${sizesOn ? 'bg-fg/[0.09] text-fg-strong' : 'text-fg/75 hover:bg-fg/5'}`}
                    data-testid="viewer-sizes"
                    title="Label each part with the size it is cut to"
                    aria-pressed={sizesOn}
                    onClick={() => setSizesOn(!sizesOn)}
                >
                    Sizes
                </button>
                <button
                    className="border-fg/10 text-fg/75 hover:bg-fg/5 h-7 rounded-lg border px-2.5 pointer-coarse:h-10 pointer-coarse:px-4"
                    data-testid="viewer-fit"
                    title="Re-centre the camera on the piece"
                    onClick={() => engine.current?.frame()}
                >
                    Fit
                </button>
                {arHref !== undefined && (
                    // AR Quick Look opens a link whose only child is an image, so the words are drawn.
                    <a
                        rel="ar"
                        href={arHref}
                        className="border-fg/10 hover:bg-fg/5 flex h-7 items-center rounded-lg border px-2.5 pointer-coarse:h-10 pointer-coarse:px-4"
                        data-testid="viewer-ar"
                        title="Place the piece in your room at full size"
                    >
                        <img src={arLabel(theme)} width={112} height={16} alt="View in your room" />
                    </a>
                )}
            </div>
        </div>
    );
});

/** "View in your room" as a small image in the theme's text colour. */
function arLabel(theme: ThemeName): string {
    const fill = theme === 'light' ? '#44403c' : '#d6d3d1';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="16"><text x="56" y="12" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="13" fill="${fill}">View in your room</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
