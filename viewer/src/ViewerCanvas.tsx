/**
 * Canvas host for the exported plan: the editor's own EditorEngine in view mode, with only the
 * presentation controls wired. There is no command layer here, so nothing can change the spec.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorEngine } from '@/engine/EditorEngine';
import { scenePalette, type ThemeName } from '@/engine/theme';
import type { Spec } from '@/spec';
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
    }
>(function ViewerCanvas({ spec, theme, selectedIds, hiddenIds, onPick }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const engine = useRef<EditorEngine | null>(null);
    const pick = useRef(onPick);
    pick.current = onPick;
    const [explode, setExplode] = useState(0);
    const [open, setOpen] = useState(0);
    const [printShot, setPrintShot] = useState<string | null>(null);
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

    return (
        <div className="relative min-h-0 flex-1" data-print="keep">
            <canvas ref={canvas} className="block h-full w-full touch-none" data-testid="viewer-canvas" />
            {printShot && (
                <img id="print-shot" src={printShot} alt="3D view of the finished piece" className="hidden" />
            )}
            <div
                className="bg-surface-1/90 border-fg/10 absolute right-3 bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 text-xs backdrop-blur sm:left-auto sm:w-72"
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
                        className="accent-accent min-w-0 flex-1"
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
                            className="accent-accent min-w-0 flex-1"
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
                    className="border-fg/10 text-fg/75 hover:bg-fg/5 h-7 rounded-lg border px-2.5"
                    data-testid="viewer-fit"
                    title="Re-centre the camera on the piece"
                    onClick={() => engine.current?.frame()}
                >
                    Fit
                </button>
            </div>
        </div>
    );
});
