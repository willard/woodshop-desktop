/**
 * Prints something on its own: drawn into the page while printing and hidden everywhere else,
 * with the rest of the page hidden from the printer (`app.css`, `html[data-printing]`). Mounted
 * to print; `onDone` once the printer is done with it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function PrintPortal({
    testId,
    onDone,
    children,
}: {
    testId: string;
    onDone: () => void;
    children: ReactNode;
}) {
    const [root] = useState(() => {
        const el = document.createElement('div');
        el.className = 'print-portal';
        el.dataset.testid = testId;
        return el;
    });
    useEffect(() => {
        const html = document.documentElement;
        document.body.append(root);
        html.dataset.printing = 'true';
        let printed = false;
        const done = () => {
            if (printed) return;
            printed = true;
            onDone();
        };
        window.addEventListener('afterprint', done);
        // After the portal has drawn.
        const timer = window.setTimeout(() => window.print(), 50);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('afterprint', done);
            delete html.dataset.printing;
            root.remove();
        };
    }, [root, onDone]);
    return createPortal(<div className="p-2 text-sm text-black">{children}</div>, root);
}
