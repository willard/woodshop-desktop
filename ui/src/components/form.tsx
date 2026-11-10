/** Compact form primitives shared by the editor panels (Inspector, dialogs). */
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Field({
    label,
    children,
    className = '',
}: {
    label: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <label className={`block ${className}`}>
            <span className="text-muted mb-1 block text-[11px]">{label}</span>
            {children}
        </label>
    );
}

type Size = 'sm' | 'md';
const HEIGHT: Record<Size, string> = { sm: 'h-8 text-xs', md: 'h-9 text-[13px]' };

export function TextInput({
    h = 'sm',
    className = '',
    ...rest
}: InputHTMLAttributes<HTMLInputElement> & { h?: Size }) {
    return (
        <input
            {...rest}
            className={`bg-surface-2 focus:border-accent border-fg/10 w-full min-w-0 rounded-lg border px-2 focus:outline-none ${HEIGHT[h]} ${className}`}
        />
    );
}

export function Select({
    h = 'sm',
    className = '',
    children,
    ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { h?: Size }) {
    return (
        <select
            {...rest}
            className={`bg-surface-2 focus:border-accent border-fg/10 w-full rounded-lg border px-2 focus:outline-none ${HEIGHT[h]} ${className}`}
        >
            {children}
        </select>
    );
}

export function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <div className="text-muted mb-2 text-[11.5px] font-semibold tracking-wider uppercase">{children}</div>
    );
}

export function PrimaryButton({ className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            {...rest}
            className={`bg-accent hover:bg-accent-strong text-accent-ink h-8 rounded-lg text-xs font-semibold disabled:opacity-50 ${className}`}
        />
    );
}

export function SecondaryButton({ className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            {...rest}
            className={`border-fg/15 text-fg/75 enabled:hover:bg-fg/5 h-8 rounded-lg border text-xs disabled:opacity-40 ${className}`}
        />
    );
}

/** Commit on Enter as well as on change/blur, the way the Inspector's fields behave. */
export function onEnter(fn: () => void) {
    return (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') fn();
    };
}
