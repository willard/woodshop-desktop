/** A click-to-open panel anchored under its trigger; closes on outside click or Escape. */
import { useEffect, useState, type ReactNode } from 'react';

export function Popover({
    trigger,
    children,
    align = 'right',
    panelClassName = '',
    testId,
}: {
    trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
    children: (close: () => void) => ReactNode;
    align?: 'left' | 'right';
    panelClassName?: string;
    testId?: string;
}) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const close = () => setOpen(false);
    return (
        <div className="relative flex-none">
            {trigger({ open, toggle: () => setOpen((o) => !o) })}
            {open && (
                <>
                    <div className="fixed inset-0 z-30" onClick={close} />
                    <div
                        className={`bg-surface-3 border-fg/10 absolute top-9 z-40 rounded-xl border shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'} ${panelClassName}`}
                        data-testid={testId}
                    >
                        {children(close)}
                    </div>
                </>
            )}
        </div>
    );
}
