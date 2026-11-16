/** "Mirrored copy": one click per direction, for a part, a group or a selection. Presentational. */
import type { MirrorAxis } from '@/engine';

const DIRECTIONS: { axis: MirrorAxis; label: string; hint: string }[] = [
    { axis: 0, label: 'Left ↔ right', hint: 'The left side from the right, or the right from the left' },
    { axis: 2, label: 'Front ↔ back', hint: 'The back legs from the front ones' },
    { axis: 1, label: 'Top ↔ bottom', hint: 'The bottom from the top' },
];

export function MirrorButtons({
    onMirror,
    className = '',
}: {
    onMirror(axis: MirrorAxis): void;
    className?: string;
}) {
    return (
        <div className={className} data-testid="mirror">
            <div className="text-muted mb-1.5 text-xs">
                Mirrored copy, on the far side of the design&rsquo;s middle
            </div>
            <div className="grid grid-cols-3 gap-1.5">
                {DIRECTIONS.map((d) => (
                    <button
                        key={d.axis}
                        className="border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs"
                        data-testid={`mirror-${d.axis}`}
                        title={d.hint}
                        onClick={() => onMirror(d.axis)}
                    >
                        {d.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
