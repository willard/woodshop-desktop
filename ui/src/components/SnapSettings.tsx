/** Snapping settings (grid, face snap, gap) behind one toolbar button that shows their state. */
import { Popover } from './Popover';
import { len } from '@/lib/display';

export function SnapSettings(props: {
    gridSize: number;
    faceSnap: boolean;
    snapGap: number;
    gridSizes: readonly number[];
    snapGaps: readonly number[];
    onGridSize(v: number): void;
    onFaceSnap(v: boolean): void;
    onSnapGap(v: number): void;
}) {
    const grid = `${len(props.gridSize)}`;
    // Face snap off still rounds to the grid, so say "grid only", not "free".
    const summary = !props.faceSnap
        ? `${grid} · grid only`
        : `${grid}${props.snapGap === 0 ? '' : ` · gap ${len(props.snapGap)}`}`;
    const title = props.faceSnap
        ? `Snapping: grid ${grid}, snapping to faces and edges`
        : `Snapping: grid ${grid}; faces and edges off, so positions only round to the grid`;

    return (
        <Popover
            testId="snap-settings-panel"
            panelClassName="flex w-56 flex-col gap-3 p-3"
            trigger={({ open, toggle }) => (
                <button
                    className={`border-fg/10 text-fg/75 hover:bg-fg/5 flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] ${open ? 'bg-fg/5' : ''}`}
                    data-testid="snap-settings-toggle"
                    title={title}
                    aria-expanded={open}
                    onClick={toggle}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="M4 9h16M4 15h16M9 4v16M15 4v16"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                        />
                    </svg>
                    {summary}
                </button>
            )}
        >
            {() => (
                <>
                    <label className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="text-fg/75">Grid</span>
                        <select
                            value={props.gridSize}
                            data-testid="grid-size"
                            className="bg-surface-2 text-fg-strong border-fg/10 h-8 rounded-lg border px-2 text-xs"
                            onChange={(e) => props.onGridSize(Number(e.target.value))}
                        >
                            {props.gridSizes.map((g) => (
                                <option key={g} value={g}>
                                    {len(g)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px]">
                        <span className="text-fg/75">Snap to faces &amp; edges</span>
                        <input
                            checked={props.faceSnap}
                            type="checkbox"
                            data-testid="snap-toggle"
                            className="accent-accent"
                            onChange={(e) => props.onFaceSnap(e.target.checked)}
                        />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="text-fg/75">Gap</span>
                        <select
                            value={props.snapGap}
                            data-testid="snap-gap"
                            className="bg-surface-2 text-fg-strong border-fg/10 h-8 rounded-lg border px-2 text-xs"
                            onChange={(e) => props.onSnapGap(Number(e.target.value))}
                        >
                            {props.snapGaps.map((g) => (
                                <option key={g} value={g}>
                                    {g === 0 ? 'none' : `${len(g)}`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <p className="text-muted text-[11px] leading-snug">
                        Gap spaces parts instead of seating them flush — slats, for instance.
                    </p>
                </>
            )}
        </Popover>
    );
}
