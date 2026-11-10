/** Layout shared by every calculator panel: inputs on the left, answers on the right. */
import type { ReactNode } from 'react';

export function CalcPanel({
    inputs,
    results,
    top,
}: {
    inputs: ReactNode;
    results: ReactNode;
    top?: ReactNode;
}) {
    return (
        <div className="border-fg/8 bg-surface-1/50 rounded-xl border p-5">
            {top}
            <div className="grid gap-6 lg:grid-cols-2">
                <div>{inputs}</div>
                <div>{results}</div>
            </div>
        </div>
    );
}

export function Heading({ children }: { children: ReactNode }) {
    return <p className="text-muted mb-3 text-[11.5px] font-semibold tracking-wider uppercase">{children}</p>;
}

export function Footnote({ children }: { children: ReactNode }) {
    return <p className="border-fg/8 text-muted mt-3.5 border-t pt-3 text-xs leading-relaxed">{children}</p>;
}

/** A row of mutually exclusive choices, 44px tall. */
export function Segmented<T extends string>({
    value,
    options,
    onChange,
    label,
}: {
    value: T;
    options: readonly { value: NoInfer<T>; label: string; testid?: string }[];
    onChange(v: NoInfer<T>): void;
    label?: string;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            {label && <span className="text-muted text-[12.5px] font-medium">{label}</span>}
            <div className="flex gap-1.5">
                {options.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        data-testid={o.testid}
                        className={`h-11 flex-1 rounded-md border px-3 text-[13px] ${
                            value === o.value
                                ? 'border-accent bg-accent/12 text-accent font-medium'
                                : 'border-fg/12 text-muted hover:bg-surface-2'
                        }`}
                        onClick={() => onChange(o.value)}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function SelectField({
    label,
    id,
    value,
    onChange,
    children,
}: {
    label: string;
    id: string;
    value: string | number;
    onChange(v: string): void;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-muted text-[12.5px] font-medium" htmlFor={id}>
                {label}
            </label>
            <select
                id={id}
                data-testid={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="bg-surface-2 text-fg-strong border-fg/10 h-11 w-full rounded-md border px-2 text-sm"
            >
                {children}
            </select>
        </div>
    );
}

export const TONE_BOX = {
    ok: 'border-ok/35 bg-ok/10 text-ok-fg',
    warn: 'border-warn/35 bg-warn/10 text-warn-fg',
    danger: 'border-danger/35 bg-danger/10 text-danger-fg',
    none: 'border-fg/10 bg-surface-2 text-muted',
} as const;
