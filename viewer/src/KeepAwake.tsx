/**
 * Keep the screen on while the plan is open: a tablet propped up in the shop otherwise dims and
 * locks between cuts. Uses the Screen Wake Lock API, so it shows only where that exists; the
 * browser drops the lock when the page is hidden, and it is taken again on return.
 */
import { useEffect, useRef, useState } from 'react';

export function KeepAwake({ className }: { className: string }) {
    const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    const [on, setOn] = useState(false);
    const lock = useRef<WakeLockSentinel | null>(null);

    useEffect(() => {
        if (!on) return;
        let cancelled = false;
        const take = async () => {
            if (document.visibilityState !== 'visible' || lock.current !== null) return;
            try {
                const sentinel = await navigator.wakeLock.request('screen');
                if (cancelled) {
                    void sentinel.release();
                    return;
                }
                lock.current = sentinel;
                sentinel.addEventListener('release', () => {
                    if (lock.current === sentinel) lock.current = null;
                });
            } catch {
                // Refused (low battery, a policy): leave the screen to sleep as it would.
                setOn(false);
            }
        };
        void take();
        document.addEventListener('visibilitychange', take);
        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', take);
            void lock.current?.release();
            lock.current = null;
        };
    }, [on]);

    if (!supported) return null;
    return (
        <button
            className={`${className} ${on ? 'bg-accent/15 text-accent border-accent/40' : ''}`}
            data-print="hide"
            data-testid="viewer-awake"
            aria-pressed={on}
            aria-label="Keep the screen on"
            title={
                on
                    ? 'The screen stays on while this plan is open. Click to let it sleep.'
                    : 'Keep the screen on while this plan is open'
            }
            onClick={() => setOn((v) => !v)}
        >
            {/* Short on a phone, where the header has little room. */}
            <span className="sm:hidden">{on ? 'Awake' : 'Stay awake'}</span>
            <span className="hidden sm:inline">{on ? 'Screen stays on' : 'Keep screen on'}</span>
        </button>
    );
}
