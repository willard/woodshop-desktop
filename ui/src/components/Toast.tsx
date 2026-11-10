/** Transient status messages ("Saved", "Couldn't export…"), bottom-right, auto-dismissing. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast {
    id: number;
    tone: Tone;
    message: string;
}

interface ToastApi {
    success(message: string): void;
    error(message: string): void;
    info(message: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const push = useCallback((tone: Tone, message: string) => {
        const id = nextId++;
        setToasts((list) => [...list, { id, tone, message }]);
        window.setTimeout(
            () => setToasts((list) => list.filter((t) => t.id !== id)),
            tone === 'error' ? 8000 : 3500,
        );
    }, []);

    const api = useMemo<ToastApi>(
        () => ({
            success: (m) => push('success', m),
            error: (m) => push('error', m),
            info: (m) => push('info', m),
        }),
        [push],
    );

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div
                className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-80 flex-col gap-2"
                role="status"
                aria-live="polite"
            >
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className={`bg-surface-3 border-fg/10 pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-xl ${
                            t.tone === 'error'
                                ? 'text-danger-fg'
                                : t.tone === 'success'
                                  ? 'text-ok-fg'
                                  : 'text-fg-strong'
                        }`}
                    >
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (ctx === null) throw new Error('useToast outside ToastProvider');
    return ctx;
}
