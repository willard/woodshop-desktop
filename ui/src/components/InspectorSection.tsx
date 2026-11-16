/**
 * A titled inspector section that folds away, and stays folded: which sections are closed is
 * remembered per device, so someone who never uses Orientation closes it once.
 */
import { useState, type ReactNode } from 'react';

const KEY = 'woodshop.inspector.closed';

function readClosed(): Set<string> {
    try {
        return new Set(JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as string[]);
    } catch {
        return new Set();
    }
}

export function Section({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
    const [open, setOpen] = useState(() => !readClosed().has(id));
    function toggle(): void {
        const closed = readClosed();
        if (open) closed.add(id);
        else closed.delete(id);
        try {
            window.localStorage.setItem(KEY, JSON.stringify([...closed]));
        } catch {
            // Not remembered; it still folds for now.
        }
        setOpen(!open);
    }
    return (
        <section className="mb-1" data-testid={`section-${id}`} data-open={open || undefined}>
            <button
                className="text-muted hover:text-fg-strong mb-2 flex w-full items-center gap-1.5 text-left text-[11.5px] font-semibold tracking-wider uppercase"
                aria-expanded={open}
                onClick={toggle}
                data-testid={`section-toggle-${id}`}
            >
                <span aria-hidden="true" className="w-2.5 text-[8px]">
                    {open ? '▼' : '▶'}
                </span>
                {title}
            </button>
            {open && children}
        </section>
    );
}
