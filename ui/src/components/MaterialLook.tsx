/**
 * How a material looks once finished (spec 1.20): bare wood, painted, stained, glass or metal,
 * with its colour and, for paint and stain, the name on the can for the shopping list.
 */
import type { Material } from '@/spec';
import type { Appearance, AppearanceKind } from '@/spec/types';
import { DEFAULT_LOOK_COLORS } from '@/engine/materials';

const KINDS: { value: AppearanceKind; label: string }[] = [
    { value: 'wood', label: 'Bare wood' },
    { value: 'paint', label: 'Paint' },
    { value: 'stain', label: 'Stain' },
    { value: 'glass', label: 'Glass' },
    { value: 'metal', label: 'Metal' },
];

/** A few common colours to start from; any colour can be picked. */
export const SWATCHES: Record<'paint' | 'stain', { name: string; color: string }[]> = {
    paint: [
        { name: 'Warm white', color: '#f1ede4' },
        { name: 'Black', color: '#262626' },
        { name: 'Sage green', color: '#8a9a5b' },
        { name: 'Navy', color: '#2b3a55' },
        { name: 'Barn red', color: '#7c2a25' },
        { name: 'Light grey', color: '#b9b8b3' },
    ],
    stain: [
        { name: 'Golden oak', color: '#b07a3b' },
        { name: 'Early American', color: '#6b4423' },
        { name: 'Dark walnut', color: '#3e2a1e' },
        { name: 'Ebony', color: '#1f1a17' },
        { name: 'Weathered grey', color: '#8c8680' },
    ],
};

/** "Paint, Sage green", "Stain, #6b4423", "Glass": a look in a few words. */
export function lookLabel(look: Appearance | undefined): string {
    if (look === undefined || look.kind === 'wood') return 'Bare wood';
    const kind = KINDS.find((k) => k.value === look.kind)!.label;
    const colour = look.name ?? look.color;
    return colour === undefined ? kind : `${kind}, ${colour}`;
}

export function MaterialLook({
    material,
    readonly,
    onChange,
}: {
    material: Material;
    readonly: boolean;
    /** The new look; `undefined` is bare wood. */
    onChange: (appearance: Appearance | undefined) => void;
}) {
    const look = material.appearance as Appearance | undefined;
    const kind: AppearanceKind = look?.kind ?? 'wood';
    if (readonly) {
        return kind === 'wood' ? null : (
            <div className="text-muted mb-2 text-xs" data-testid="material-look-label">
                {lookLabel(look)}
            </div>
        );
    }
    const color = look?.color ?? (kind === 'wood' ? undefined : DEFAULT_LOOK_COLORS[kind]);
    const swatches = kind === 'paint' || kind === 'stain' ? SWATCHES[kind] : [];
    const set = (next: Partial<Appearance>) => {
        const merged = { ...look, kind, ...next } as Appearance;
        const tidy: Appearance = { kind: merged.kind };
        if (merged.color !== undefined) tidy.color = merged.color;
        if (merged.name !== undefined && merged.name.trim() !== '')
            tidy.name = merged.name.trim().slice(0, 60);
        onChange(tidy.kind === 'wood' ? undefined : tidy);
    };
    return (
        <div className="mb-2" data-testid={`material-look-${material.id}`}>
            <div className="flex items-center gap-2">
                <span
                    className="text-muted text-xs"
                    title="How it looks once finished: painted parts are drawn flat, stain tints the grain, glass is see-through. Paint and stain go on the shopping list."
                >
                    Look
                </span>
                <select
                    value={kind}
                    aria-label={`Look of ${material.name}`}
                    data-testid="material-look"
                    className="bg-surface-1 focus:border-accent border-fg/10 h-7 rounded-lg border px-1 text-xs focus:outline-none"
                    onChange={(e) => {
                        const next = e.target.value as AppearanceKind;
                        // A new kind starts from its own colour, not the last one's.
                        onChange(
                            next === 'wood' ? undefined : { kind: next, color: DEFAULT_LOOK_COLORS[next] },
                        );
                    }}
                >
                    {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                            {k.label}
                        </option>
                    ))}
                </select>
                {kind !== 'wood' && (
                    <input
                        type="color"
                        value={color}
                        aria-label={`Colour of ${material.name}`}
                        data-testid="material-look-color"
                        className="border-fg/10 h-7 w-9 flex-none cursor-pointer rounded-lg border bg-transparent p-0.5"
                        onChange={(e) => set({ color: e.target.value, name: undefined })}
                    />
                )}
                {(kind === 'paint' || kind === 'stain') && (
                    <input
                        key={`${look?.name ?? ''}${look?.color ?? ''}`}
                        defaultValue={look?.name ?? ''}
                        placeholder="name on the can"
                        maxLength={60}
                        aria-label={`Colour name of ${material.name}`}
                        data-testid="material-look-name"
                        className="bg-surface-1 focus:border-accent border-fg/10 h-7 min-w-0 flex-1 rounded-lg border px-2 text-xs focus:outline-none"
                        onBlur={(e) => {
                            if (e.target.value.trim() !== (look?.name ?? '')) set({ name: e.target.value });
                        }}
                    />
                )}
            </div>
            {swatches.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`${kind} colours`}>
                    {swatches.map((s) => (
                        <button
                            key={s.color}
                            title={s.name}
                            aria-label={s.name}
                            aria-pressed={look?.color?.toLowerCase() === s.color}
                            data-testid="material-look-swatch"
                            className="border-fg/30 aria-pressed:ring-accent h-5 w-5 rounded-full border aria-pressed:ring-2"
                            style={{ background: s.color }}
                            onClick={() => set({ color: s.color, name: s.name })}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
