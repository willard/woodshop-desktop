/** A centred dialog over a dimmed backdrop; closes on backdrop click or Escape. */
import { useEffect, type ReactNode } from 'react';

export function Modal({
    onClose,
    children,
    testId,
    className = 'max-w-sm',
}: {
    onClose: () => void;
    children: ReactNode;
    testId?: string;
    className?: string;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            data-testid={testId}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div
                className={`bg-surface-1 border-fg/10 max-h-full w-full overflow-y-auto rounded-2xl border p-4 shadow-2xl ${className}`}
            >
                {children}
            </div>
        </div>
    );
}
