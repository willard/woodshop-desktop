/**
 * The calculators, reached from inside the editor without leaving it. Knows nothing about the
 * project: no prop here derives from the document, so nothing here can change the design.
 */
import { Suspense, useState } from 'react';
import { CALCULATORS, CALC_GROUPS, calculatorById } from '@/calc/registry';
import { Modal } from '../Modal';
import { CALC_PANELS } from './panels';

export function ToolsOverlay({ onClose, startAt = null }: { onClose: () => void; startAt?: string | null }) {
    const [openId, setOpenId] = useState<string | null>(startAt);
    const meta = openId === null ? null : calculatorById(openId);
    const Panel = openId === null ? null : (CALC_PANELS[openId] ?? null);
    const iconBtn =
        'border-fg/12 text-muted hover:bg-fg/6 flex h-9 w-9 flex-none items-center justify-center rounded-lg border';

    return (
        <Modal onClose={onClose} testId="tools-overlay" className="max-w-3xl">
            <div className="mb-1 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    {openId && (
                        <button
                            type="button"
                            className={iconBtn}
                            data-testid="tools-overlay-back"
                            aria-label="Back to all calculators"
                            onClick={() => setOpenId(null)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                    d="m15 6-6 6 6 6"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </button>
                    )}
                    <h2 className="text-fg-strong truncate font-semibold">
                        {meta?.title ?? 'Shop calculators'}
                    </h2>
                </div>
                <button
                    type="button"
                    className={iconBtn}
                    data-testid="tools-overlay-close"
                    aria-label="Close"
                    onClick={onClose}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="m6 6 12 12M18 6 6 18"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
            </div>
            <p className="text-muted mb-4 text-[12.5px] leading-snug">
                {meta?.summary ??
                    'Your project stays exactly as you left it — nothing here reads or changes the design.'}
            </p>
            {Panel ? (
                <Suspense fallback={<p className="text-faint text-sm">Loading…</p>}>
                    <Panel />
                </Suspense>
            ) : (
                <CalculatorIndex onOpen={setOpenId} />
            )}
        </Modal>
    );
}

/** The catalogue grouped by what a woodworker is doing. */
export function CalculatorIndex({ onOpen, filter = '' }: { onOpen: (id: string) => void; filter?: string }) {
    const q = filter.trim().toLowerCase();
    const matches = (c: (typeof CALCULATORS)[number]) =>
        q === '' || [c.title, c.summary, ...c.keywords].some((s) => s.toLowerCase().includes(q));
    return (
        <>
            {CALC_GROUPS.map((group) => {
                const items = CALCULATORS.filter((c) => c.group === group.id && matches(c));
                if (items.length === 0) return null;
                return (
                    <div key={group.id} className="mb-4">
                        <p className="text-faint mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
                            {group.title}
                        </p>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                            {items.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className="border-fg/8 bg-surface-2 hover:border-accent-strong/50 text-fg-strong flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-[13px]"
                                    data-testid={`tools-overlay-${item.id}`}
                                    onClick={() => onOpen(item.id)}
                                >
                                    <svg
                                        className="text-accent flex-none"
                                        width="15"
                                        height="15"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d={item.icon}
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    {item.title}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </>
    );
}
