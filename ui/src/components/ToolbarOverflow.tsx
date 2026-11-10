/** The toolbar's fixed overflow menu: situational controls (recenter, calculators, theme). */
import { Popover } from './Popover';
import { ThemeToggle } from './ThemeToggle';

export function ToolbarOverflow({
    canRecenter,
    isFocusMode,
    onRecenter,
    onTools,
    extra,
}: {
    canRecenter: boolean;
    isFocusMode: boolean;
    onRecenter(): void;
    onTools(): void;
    /** Project-level actions contributed by the editor page (exports, versions …). */
    extra?: (close: () => void) => React.ReactNode;
}) {
    const item =
        'enabled:hover:bg-fg/[0.07] disabled:text-faint rounded-md px-2.5 py-2 text-left text-[12.5px]';
    return (
        <Popover
            testId="toolbar-overflow-panel"
            panelClassName="flex w-56 flex-col gap-px p-1.5"
            trigger={({ open, toggle }) => (
                <button
                    className={`text-muted hover:bg-fg/5 hover:text-fg-strong flex h-[30px] w-[30px] items-center justify-center rounded-lg ${open ? 'bg-fg/5' : ''}`}
                    data-testid="toolbar-overflow-toggle"
                    title="More tools"
                    aria-label="More tools"
                    aria-expanded={open}
                    onClick={toggle}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.6" fill="currentColor" />
                        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                        <circle cx="19" cy="12" r="1.6" fill="currentColor" />
                    </svg>
                </button>
            )}
        >
            {(close) => (
                <>
                    <button
                        className={item}
                        data-testid="recenter"
                        disabled={!isFocusMode && !canRecenter}
                        title={
                            isFocusMode
                                ? 'Center the camera on the group'
                                : canRecenter
                                  ? 'Move the whole project to the centre of the grid'
                                  : 'Project is already centred'
                        }
                        onClick={() => {
                            onRecenter();
                            close();
                        }}
                    >
                        {isFocusMode ? 'Center View' : 'Recenter'}
                    </button>
                    <button
                        className={item}
                        data-testid="open-tools"
                        title="Board feet, sag, miters — without leaving the project"
                        onClick={() => {
                            onTools();
                            close();
                        }}
                    >
                        Calculators…
                    </button>
                    {extra?.(close)}
                    <div className="bg-fg/[0.08] my-1 h-px" />
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12.5px]">
                        <span className="text-fg/75">Theme</span>
                        <ThemeToggle />
                    </div>
                </>
            )}
        </Popover>
    );
}
