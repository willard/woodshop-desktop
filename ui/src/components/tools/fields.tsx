/**
 * The inputs and readouts every calculator shares. MeasureField owns the user's literal keystrokes
 * and never rewrites them while focused ("1 1/" is on the way to "1 1/2"); it parses live, stays
 * quiet while typing, complains only once you leave, and tidies the text only then.
 */
import { useEffect, useState } from 'react';
import { formatFraction, parseFraction } from '@/lib/fraction';
import { feetAndInches, fromInches, toInches, type LengthUnit } from '@/lib/units';
import { SOLID_SPECIES, SPECIES, type SpeciesId } from '@/lib/species';

function display(inches: number | null, unit: LengthUnit): string {
    if (inches === null) return '';
    if (unit === 'in') return formatFraction(inches);
    if (unit === 'ft') {
        const { feet, inches: rest } = feetAndInches(inches);
        return rest === 0 ? String(feet) : `${feet} ${formatFraction(rest)}`;
    }
    return String(Math.round(fromInches(inches, unit) * 100) / 100);
}

const inputClass =
    'border-fg/12 bg-surface-0 text-fg-strong placeholder-faint focus:border-accent h-11 w-full rounded-md border px-3 text-sm focus:outline-none';

export function MeasureField(props: {
    label: string;
    value: number | null;
    onChange(v: number | null): void;
    testid: string;
    unit?: LengthUnit;
    units?: readonly LengthUnit[];
    onUnit?(u: LengthUnit): void;
    min?: number;
    max?: number;
    hint?: string;
    placeholder?: string;
}) {
    const unit = props.unit ?? 'in';
    const [text, setText] = useState(display(props.value, unit));
    const [focused, setFocused] = useState(false);
    const [touched, setTouched] = useState(false);

    // A value pushed in from outside is shown — unless the user is mid-word in the field.
    useEffect(() => {
        if (!focused) setText(display(props.value, unit));
    }, [props.value]); // eslint-disable-line react-hooks/exhaustive-deps

    const parse = (raw: string): number | null => {
        const t = raw.trim();
        if (t === '') return null;
        const n = parseFraction(t);
        return n === null ? null : toInches(n, unit);
    };
    const parsed = parse(text);
    const outOfRange =
        parsed !== null &&
        ((props.min !== undefined && parsed < props.min) || (props.max !== undefined && parsed > props.max));
    const error =
        focused || !touched || text.trim() === ''
            ? ''
            : parsed === null
              ? 'Enter inches — 3/4, 1 1/2, or 12.5.'
              : outOfRange
                ? `Enter a value between ${formatFraction(props.min ?? 0)} and ${formatFraction(props.max ?? 0)}.`
                : '';

    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-muted text-[12.5px] font-medium" htmlFor={props.testid}>
                {props.label}
            </label>
            <div className="flex gap-1.5">
                <input
                    id={props.testid}
                    value={text}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`${props.label}, in ${unit === 'in' ? 'inches' : unit}`}
                    placeholder={props.placeholder}
                    data-testid={props.testid}
                    className={inputClass}
                    onChange={(e) => {
                        const next = e.target.value;
                        setText(next);
                        const v = parse(next);
                        const bad =
                            v !== null &&
                            ((props.min !== undefined && v < props.min) ||
                                (props.max !== undefined && v > props.max));
                        props.onChange(bad ? null : v);
                    }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                        setFocused(false);
                        setTouched(true);
                        if (parsed !== null && !outOfRange) setText(display(parsed, unit));
                    }}
                />
                {props.units && (
                    <select
                        value={unit}
                        data-testid={`${props.testid}-unit`}
                        aria-label={`Unit for ${props.label}`}
                        className="bg-surface-2 text-fg-strong border-fg/10 h-11 flex-none rounded-md border px-2 text-xs"
                        onChange={(e) => {
                            // Convert the stored inches, not the text: 0.75 in becomes 19.05 mm.
                            const next = e.target.value as LengthUnit;
                            props.onUnit?.(next);
                            setText(display(parsed, next));
                        }}
                    >
                        {props.units.map((u) => (
                            <option key={u} value={u}>
                                {u}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            {error ? (
                <p className="text-danger-fg text-xs" data-testid={`${props.testid}-error`}>
                    {error}
                </p>
            ) : (
                props.hint && <p className="text-faint text-[11px]">{props.hint}</p>
            )}
        </div>
    );
}

/** Counts and percentages: steppers matter more than fraction entry here. */
export function NumberField(props: {
    label: string;
    value: number | null;
    onChange(v: number | null): void;
    testid: string;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    hint?: string;
    steppers?: boolean;
}) {
    const { step = 1, steppers = true } = props;
    const clamp = (v: number) => {
        let out = v;
        if (props.min !== undefined) out = Math.max(props.min, out);
        if (props.max !== undefined) out = Math.min(props.max, out);
        return out;
    };
    const stepBtn =
        'border-fg/12 text-fg-strong hover:bg-fg/6 h-11 w-11 flex-none rounded-md border text-lg leading-none';
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-muted text-[12.5px] font-medium" htmlFor={props.testid}>
                {props.label}
            </label>
            <div className="flex items-center gap-1.5">
                {steppers && (
                    <button
                        type="button"
                        className={stepBtn}
                        data-testid={`${props.testid}-down`}
                        aria-label={`Decrease ${props.label}`}
                        onClick={() => props.onChange(clamp((props.value ?? 0) - step))}
                    >
                        −
                    </button>
                )}
                <input
                    id={props.testid}
                    value={props.value === null ? '' : String(props.value)}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    data-testid={props.testid}
                    className={`${inputClass} tabular-nums ${steppers ? 'text-center' : ''}`}
                    onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') return props.onChange(null);
                        const n = Number(raw);
                        props.onChange(Number.isFinite(n) ? n : null);
                    }}
                    onBlur={() => props.value !== null && props.onChange(clamp(props.value))}
                />
                {steppers && (
                    <button
                        type="button"
                        className={stepBtn}
                        data-testid={`${props.testid}-up`}
                        aria-label={`Increase ${props.label}`}
                        onClick={() => props.onChange(clamp((props.value ?? 0) + step))}
                    >
                        +
                    </button>
                )}
                {props.suffix && <span className="text-faint flex-none text-[13px]">{props.suffix}</span>}
            </div>
            {props.hint && <p className="text-faint text-[11px]">{props.hint}</p>}
        </div>
    );
}

export interface ResultTile {
    readonly label: string;
    /** Null renders as a dash — the form is not finished yet. */
    readonly value: string | null;
    readonly emphasis?: boolean;
    readonly wide?: boolean;
    readonly tone?: 'ok' | 'warn' | 'danger';
}

const TONE_CLASS: Record<string, string> = {
    ok: 'text-ok-fg',
    warn: 'text-warn-fg',
    danger: 'text-danger-fg',
};

export function ResultGrid({
    tiles,
    testid = 'result-grid',
}: {
    tiles: readonly ResultTile[];
    testid?: string;
}) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid={testid}>
            {tiles.map((tile) => (
                <div
                    key={tile.label}
                    className={`bg-surface-2 rounded-lg px-3 py-2.5 ${tile.wide ? 'col-span-2' : ''}`}
                >
                    <div className="text-muted text-[11.5px]">{tile.label}</div>
                    <div
                        className={`mt-0.5 font-semibold tabular-nums ${tile.emphasis ? 'text-xl' : 'text-lg'} ${tile.tone ? TONE_CLASS[tile.tone] : 'text-fg-strong'}`}
                    >
                        {tile.value ?? '—'}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function SpeciesSelect(props: {
    label: string;
    value: SpeciesId;
    onChange(v: SpeciesId): void;
    testid: string;
    solidOnly?: boolean;
    hint?: string;
}) {
    const options = props.solidOnly ? SOLID_SPECIES : SPECIES;
    const groups = [
        { label: 'Hardwood', items: options.filter((s) => s.kind === 'hardwood') },
        { label: 'Softwood', items: options.filter((s) => s.kind === 'softwood') },
        { label: 'Panels', items: options.filter((s) => s.kind === 'panel') },
    ];
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-muted text-[12.5px] font-medium" htmlFor={props.testid}>
                {props.label}
            </label>
            <select
                id={props.testid}
                value={props.value}
                data-testid={props.testid}
                className="bg-surface-2 text-fg-strong border-fg/10 h-11 w-full rounded-md border px-2 text-sm"
                onChange={(e) => props.onChange(e.target.value as SpeciesId)}
            >
                {groups
                    .filter((g) => g.items.length > 0)
                    .map((g) => (
                        <optgroup key={g.label} label={g.label}>
                            {g.items.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.label}
                                </option>
                            ))}
                        </optgroup>
                    ))}
            </select>
            {props.hint && <p className="text-faint text-[11px]">{props.hint}</p>}
        </div>
    );
}
