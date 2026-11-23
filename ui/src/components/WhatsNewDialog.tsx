/** The release notes for one version, as the changelog words them. */
import type { ReactNode } from 'react';
import type { Release } from '@/app/whatsNew';
import { Modal } from './Modal';

/** `code` and **bold** as the changelog writes them; everything else as plain text. */
function inline(text: string): ReactNode[] {
    return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((piece, i) => {
        if (piece.startsWith('`') && piece.endsWith('`')) {
            return (
                <code key={i} className="bg-fg/[0.07] rounded px-1 text-[12px]">
                    {piece.slice(1, -1)}
                </code>
            );
        }
        if (piece.startsWith('**') && piece.endsWith('**'))
            return <strong key={i}>{piece.slice(2, -2)}</strong>;
        return piece;
    });
}

export function WhatsNewDialog({ release, onClose }: { release: Release; onClose: () => void }) {
    return (
        <Modal onClose={onClose} testId="whats-new" className="max-w-xl">
            <h2 className="mb-0.5 text-[15px] font-semibold">What's new in Woodshop {release.version}</h2>
            {release.date && <p className="text-muted mb-3 text-xs">{release.date}</p>}
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {release.groups.map((group) => (
                    <section key={group.title}>
                        <h3 className="text-muted mb-1 text-xs font-semibold tracking-wider uppercase">
                            {group.title}
                        </h3>
                        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-snug">
                            {group.items.map((item, i) => (
                                <li key={i}>{inline(item)}</li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <div className="mt-4 flex justify-end">
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-1.5 text-sm font-semibold"
                    data-testid="whats-new-close"
                    onClick={onClose}
                >
                    Got it
                </button>
            </div>
        </Modal>
    );
}
