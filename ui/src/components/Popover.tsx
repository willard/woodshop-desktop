/**
 * A click-to-open panel anchored under its trigger; closes on outside click or Escape.
 *
 * The panel is drawn over the page (in a portal, fixed to the viewport), not inside its trigger's
 * box: a project card clips what overflows it, and a menu there would be cut off at the card's
 * edge. It opens above the trigger when there is no room below.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Between the trigger and the panel, and the least between the panel and the window's edge. */
const GAP = 4;
const MARGIN = 8;

/**
 * Where the panel goes, in viewport pixels: under the anchor, or over it when it fits only there.
 * When it fits neither way it goes on the roomier side and scrolls, `maxHeight` tall.
 */
export function placePanel(
    anchor: { top: number; bottom: number; left: number; right: number },
    panel: { width: number; height: number },
    view: { width: number; height: number },
    align: 'left' | 'right',
): { top: number; left: number; maxHeight: number } {
    const roomBelow = view.height - MARGIN - (anchor.bottom + GAP);
    const roomAbove = anchor.top - GAP - MARGIN;
    const up = panel.height > roomBelow && (panel.height <= roomAbove || roomAbove > roomBelow);
    const maxHeight = Math.max(0, up ? roomAbove : roomBelow);
    const top = up ? anchor.top - GAP - Math.min(panel.height, maxHeight) : anchor.bottom + GAP;
    const wanted = align === 'right' ? anchor.right - panel.width : anchor.left;
    const left = Math.max(MARGIN, Math.min(wanted, view.width - MARGIN - panel.width));
    return { top, left, maxHeight };
}

/** Where a menu opened at a point goes: at the point, or up and in from the window's edges. */
export function placeAtPoint(
    point: { x: number; y: number },
    panel: { width: number; height: number },
    view: { width: number; height: number },
): { top: number; left: number } {
    const top =
        point.y + panel.height <= view.height - MARGIN
            ? point.y
            : Math.max(MARGIN, Math.min(point.y - panel.height, view.height - MARGIN - panel.height));
    const left = Math.max(MARGIN, Math.min(point.x, view.width - MARGIN - panel.width));
    return { top, left };
}

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
    const anchor = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    // Hidden until measured, so it never shows for a frame in the wrong place.
    const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    useLayoutEffect(() => {
        if (!open) {
            setPosition({ visibility: 'hidden' });
            return;
        }
        const place = () => {
            const a = anchor.current?.getBoundingClientRect();
            const p = panel.current;
            if (!a || !p) return;
            setPosition(
                placePanel(
                    a,
                    // Its whole height, not the height a scrolling panel is held to.
                    { width: p.offsetWidth, height: p.scrollHeight },
                    { width: window.innerWidth, height: window.innerHeight },
                    align,
                ),
            );
        };
        place();
        // Follow the trigger when the page scrolls or resizes, and the panel when its contents do.
        const resize = new ResizeObserver(place);
        if (panel.current) resize.observe(panel.current);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            resize.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open, align]);

    const close = () => setOpen(false);
    return (
        <div ref={anchor} className="relative flex-none">
            {trigger({ open, toggle: () => setOpen((o) => !o) })}
            {open &&
                createPortal(
                    <>
                        <div className="fixed inset-0 z-30" onClick={close} />
                        <div
                            ref={panel}
                            style={position}
                            className={`bg-surface-3 border-fg/10 fixed z-40 overflow-y-auto overscroll-contain rounded-xl border shadow-2xl ${panelClassName}`}
                            data-testid={testId}
                        >
                            {children(close)}
                        </div>
                    </>,
                    document.body,
                )}
        </div>
    );
}
