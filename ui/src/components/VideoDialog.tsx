/**
 * Export an assembly video: choose the shape and length, then the film is rendered frame by frame
 * (with a progress bar and a Cancel) and saved as an MP4 where the user picks. The renderer is
 * loaded only when this opens, so the editor does not carry the encoder.
 */
import { useEffect, useRef, useState } from 'react';
import { FILM_LENGTHS, FILM_PRESETS, FILM_SHAPES, type FilmPreset } from '@/video/timeline';
import type { ThemeName } from '@/engine/theme';
import { activeTheme } from '@/lib/theme';
import { Modal } from './Modal';
import { Field, Select } from './form';

export interface VideoChoice {
    width: number;
    height: number;
    seconds: number;
    theme: ThemeName;
    preset: FilmPreset['id'];
}

export function VideoDialog({
    onMake,
    onClose,
}: {
    /** Renders and saves; `onProgress` takes the share done. Resolves when saved or cancelled. */
    onMake: (choice: VideoChoice, onProgress: (done: number) => void, signal: AbortSignal) => Promise<void>;
    onClose: () => void;
}) {
    const [preset, setPreset] = useState<FilmPreset['id']>('build');
    const [shape, setShape] = useState<string>('tall');
    const [length, setLength] = useState<string>('standard');
    const [theme, setTheme] = useState<ThemeName>(activeTheme());
    const [supported, setSupported] = useState<boolean | null>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const abort = useRef<AbortController | null>(null);

    const chosen = FILM_SHAPES.find((s) => s.id === shape)!;
    useEffect(() => {
        let live = true;
        void import('@/video/assemblyFilm')
            .then(({ videoConfig }) => videoConfig(chosen.width, chosen.height))
            .then((config) => live && setSupported(config !== null))
            .catch(() => live && setSupported(false));
        return () => {
            live = false;
        };
    }, [chosen.width, chosen.height]);

    // Closing mid-render cancels it.
    useEffect(() => () => abort.current?.abort(), []);

    async function make(): Promise<void> {
        const controller = new AbortController();
        abort.current = controller;
        setProgress(0);
        try {
            await onMake(
                {
                    width: chosen.width,
                    height: chosen.height,
                    seconds: FILM_LENGTHS.find((l) => l.id === length)!.seconds,
                    theme,
                    preset,
                },
                setProgress,
                controller.signal,
            );
        } finally {
            abort.current = null;
            setProgress(null);
        }
    }

    const busy = progress !== null;
    return (
        <Modal onClose={() => (busy ? abort.current?.abort() : onClose())} testId="video-dialog">
            <h2 className="mb-1 text-[15px] font-semibold">Video</h2>
            <p className="text-muted mb-3 text-[13px]" data-testid="video-about">
                {FILM_PRESETS.find((p) => p.id === preset)!.about} An MP4 ready to post.
            </p>
            <div className="mb-4 grid gap-2">
                <Field label="Preset">
                    <Select
                        value={preset}
                        disabled={busy}
                        data-testid="video-preset"
                        onChange={(e) => setPreset(e.target.value as FilmPreset['id'])}
                    >
                        {FILM_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="Shape">
                    <Select
                        value={shape}
                        disabled={busy}
                        data-testid="video-shape"
                        onChange={(e) => setShape(e.target.value)}
                    >
                        {FILM_SHAPES.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Length">
                        <Select
                            value={length}
                            disabled={busy}
                            data-testid="video-length"
                            onChange={(e) => setLength(e.target.value)}
                        >
                            {FILM_LENGTHS.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.label}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Background">
                        <Select
                            value={theme}
                            disabled={busy}
                            data-testid="video-theme"
                            onChange={(e) => setTheme(e.target.value as ThemeName)}
                        >
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </Select>
                    </Field>
                </div>
            </div>
            {supported === false && (
                <p className="mb-3 text-[13px] text-red-500" data-testid="video-unsupported">
                    This computer can&apos;t encode MP4 video in Woodshop. Try the 3D plan export instead, or
                    a newer system.
                </p>
            )}
            {busy && (
                <div className="mb-3" data-testid="video-progress">
                    <div className="bg-fg/10 h-1.5 overflow-hidden rounded-full">
                        <div
                            className="bg-accent h-full"
                            style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                    </div>
                    <p className="text-muted mt-1 text-xs">Rendering… {Math.round(progress * 100)}%</p>
                </div>
            )}
            <div className="flex justify-end gap-2">
                <button
                    className="hover:bg-fg/[0.07] rounded-lg px-3 py-1.5 text-sm"
                    data-testid="video-cancel"
                    onClick={() => (busy ? abort.current?.abort() : onClose())}
                >
                    Cancel
                </button>
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                    data-testid="video-make"
                    disabled={busy || supported !== true}
                    onClick={() => void make()}
                >
                    Save video…
                </button>
            </div>
        </Modal>
    );
}
