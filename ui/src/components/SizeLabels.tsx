/** The size labels the engine placed (see `engine/sizeLabels.ts`), drawn over the 3D view. */
import type { PlacedSize } from '@/engine/sizeLabels';

export function SizeLabels({ labels }: { labels: readonly PlacedSize[] }) {
    return (
        <>
            {labels.map((label, i) => (
                <div
                    key={i}
                    className="bg-surface-1/90 border-fg/15 text-fg-strong pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-sm backdrop-blur"
                    style={{ left: `${label.x}px`, top: `${label.y}px` }}
                    data-testid="size-label"
                >
                    {label.text}
                </div>
            ))}
        </>
    );
}
