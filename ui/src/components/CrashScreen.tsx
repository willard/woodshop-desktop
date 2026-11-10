/**
 * What a screen is replaced with when it throws: the work is safe (every edit autosaves), so say
 * so, record the error, and offer the ways out.
 */
import { useEffect } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from '@/app/api';
import { reportError } from '@/app/diagnostics';

export function CrashScreen({ error, context = 'screen crashed' }: { error: unknown; context?: string }) {
    useEffect(() => reportError(error, context), [error, context]);
    const message = error instanceof Error ? error.message : String(error);

    async function showLog(): Promise<void> {
        const { logDir } = await api.libraryInfo();
        if (logDir !== null) await revealItemInDir(logDir);
    }

    const button = 'border-fg/12 hover:bg-surface-2 rounded-lg border px-3 py-2 text-sm';
    return (
        <div className="bg-surface-0 text-fg-strong flex h-full min-h-screen items-center justify-center p-6">
            <div
                className="bg-surface-1 border-fg/10 w-full max-w-md rounded-2xl border p-6"
                data-testid="crash-screen"
            >
                <h1 className="mb-2 text-lg font-semibold">Something went wrong on this screen</h1>
                <p className="text-muted mb-3 text-sm">
                    Your designs are safe: every change is saved as you make it. Reloading usually clears
                    this.
                </p>
                <pre className="bg-surface-0 border-fg/8 text-muted mb-4 max-h-24 overflow-auto rounded-lg border p-2.5 text-xs whitespace-pre-wrap">
                    {message}
                </pre>
                <div className="flex flex-wrap gap-2">
                    <button
                        className="bg-accent text-accent-ink rounded-lg px-3 py-2 text-sm font-semibold"
                        onClick={() => window.location.reload()}
                    >
                        Reload
                    </button>
                    <button
                        className={button}
                        onClick={() => {
                            window.location.hash = '#/';
                            window.location.reload();
                        }}
                    >
                        Back to projects
                    </button>
                    <button className={button} onClick={() => void showLog().catch(() => undefined)}>
                        Show log file
                    </button>
                </div>
            </div>
        </div>
    );
}
