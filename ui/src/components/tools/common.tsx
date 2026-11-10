/** Small pieces several calculator panels repeat. */
import type { ReactNode } from 'react';

export function Notes({ notes, extra }: { notes: readonly string[]; extra?: ReactNode }) {
    return (
        <ul className="border-fg/8 text-muted mt-3.5 space-y-1.5 border-t pt-3 text-xs leading-relaxed">
            {notes.map((n) => (
                <li key={n}>{n}</li>
            ))}
            {extra}
        </ul>
    );
}

export function Check({
    checked,
    onChange,
    testid,
    children,
}: {
    checked: boolean;
    onChange(v: boolean): void;
    testid?: string;
    children: ReactNode;
}) {
    return (
        <label className="text-muted flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                data-testid={testid}
                className="accent-accent h-5 w-5"
            />
            <span>{children}</span>
        </label>
    );
}

export function Tile({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
    return (
        <div className="bg-surface-2 mt-3 rounded-lg px-3 py-2.5" data-testid={testid}>
            <div className="text-muted text-[11.5px]">{label}</div>
            <div className="text-fg-strong mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
        </div>
    );
}
