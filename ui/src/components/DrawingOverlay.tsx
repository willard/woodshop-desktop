/**
 * The Drawing view: the whole piece from the front, side or top with its sizes, laid over the 3D
 * view like a sheet of paper. It is the same drawing the PDF plan prints (`elevationSvg` in the
 * core), so what the screen shows and what the plan says never differ.
 */
import { useMemo } from 'react';
import { wasm } from '@/domain';
import type { Spec } from '@/spec';
import { useUnits } from '@/lib/display';

export type DrawingView = 'front' | 'side' | 'top';

const VIEWS: [DrawingView, string][] = [
    ['front', 'Front'],
    ['side', 'Side'],
    ['top', 'Top'],
];

export function DrawingOverlay({
    spec,
    view,
    onView,
    onClose,
}: {
    spec: Spec;
    view: DrawingView;
    onView: (view: DrawingView) => void;
    onClose: () => void;
}) {
    const units = useUnits();
    // The SVG is built by the core from the design; part names in it are escaped there.
    const svg = useMemo(() => wasm.elevationSvg(spec, view, units), [spec, view, units]);
    return (
        <div
            className="bg-surface-1/95 absolute inset-0 z-20 flex flex-col backdrop-blur"
            data-testid="drawing-overlay"
            role="region"
            aria-label={`Drawing, ${view} view`}
        >
            <div className="flex items-center justify-between gap-2 p-3">
                <div className="border-fg/[0.08] flex gap-0.5 rounded-lg border p-0.5" role="tablist">
                    {VIEWS.map(([id, label]) => (
                        <button
                            key={id}
                            role="tab"
                            aria-selected={id === view}
                            data-testid={`drawing-${id}`}
                            className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${
                                id === view ? 'bg-fg/[0.09] text-fg-strong' : 'text-fg/75 hover:bg-fg/[0.07]'
                            }`}
                            onClick={() => onView(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <button
                    className="text-fg/75 hover:bg-fg/[0.07] h-7 rounded-md px-2.5 text-[12px] font-medium"
                    data-testid="drawing-close"
                    onClick={onClose}
                >
                    Back to 3D
                </button>
            </div>
            <div className="min-h-0 flex-1 p-4 pt-0">
                <div
                    className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-white p-4 shadow-sm [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full"
                    data-testid="drawing-svg"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            </div>
        </div>
    );
}
