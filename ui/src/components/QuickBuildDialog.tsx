/**
 * Quick build (Phase 7.4): a sound starting design from a few sizes — a shelf unit, a box, a
 * table or an open frame — previewed from the front as you type, then made a project to change
 * like any other. The generators live in the core (`woodshop-core::quickbuild`).
 */
import { useMemo, useState } from 'react';
import { wasm } from '@/domain';
import type { Spec } from '@/spec';
import { lenValue, parseLen, unitSuffix, useUnits } from '@/lib/display';
import { Modal } from './Modal';
import { Field, Select, TextInput } from './form';

type Kind = 'shelfUnit' | 'box' | 'table' | 'frame';

const KINDS: { id: Kind; label: string; name: string; sizes: [number, number, number] }[] = [
    { id: 'shelfUnit', label: 'Shelf unit (plywood)', name: 'Shelf unit', sizes: [30, 48, 12] },
    { id: 'box', label: 'Box, open top (plywood)', name: 'Box', sizes: [24, 12, 16] },
    { id: 'table', label: 'Table (plywood top, 2x2 legs)', name: 'Table', sizes: [36, 30, 20] },
    { id: 'frame', label: 'Frame, open stand (2x4)', name: 'Frame', sizes: [48, 30, 24] },
];

export function QuickBuildDialog({
    onCreate,
    onClose,
}: {
    onCreate: (name: string, spec: Spec) => void;
    onClose: () => void;
}) {
    const units = useUnits();
    const [kind, setKind] = useState<Kind>('shelfUnit');
    const preset = KINDS.find((k) => k.id === kind)!;
    const [name, setName] = useState('');
    const [sizes, setSizes] = useState(() => preset.sizes.map((v) => lenValue(v)));
    const [shelves, setShelves] = useState('2');
    const [back, setBack] = useState(true);
    const [apron, setApron] = useState(true);

    function choose(next: Kind): void {
        setKind(next);
        setSizes(KINDS.find((k) => k.id === next)!.sizes.map((v) => lenValue(v)));
    }

    const title = name.trim() || preset.name;
    const result = useMemo((): { spec: Spec; svg: string } | { error: string } => {
        const [width, height, depth] = sizes.map((s) => parseLen(s.trim()));
        if (width === null || height === null || depth === null) {
            return { error: `Give the width, height and depth (e.g. ${lenValue(30)}).` };
        }
        try {
            const spec = wasm.quickBuild(
                {
                    kind,
                    width,
                    height,
                    depth,
                    ...(kind === 'shelfUnit'
                        ? { shelves: Math.max(0, Math.round(Number(shelves) || 0)), back }
                        : {}),
                    ...(kind === 'table' ? { apron } : {}),
                },
                title,
            ) as Spec;
            return { spec, svg: wasm.elevationSvg(spec, 'front', units) };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }, [kind, sizes, shelves, back, apron, title, units]);

    const labels = ['Width', 'Height', 'Depth'];
    return (
        <Modal onClose={onClose} testId="quick-build" className="max-w-2xl">
            <h2 className="mb-1 text-[15px] font-semibold">Quick build</h2>
            <p className="text-muted mb-3 text-[13px]">
                A sound starting design from a few sizes, every part placed and fastened. Change anything once
                it is made.
            </p>
            <div className="grid gap-4 sm:grid-cols-[1fr_1.1fr]">
                <div className="grid content-start gap-2">
                    <Field label="What to build">
                        <Select
                            value={kind}
                            data-testid="quick-build-kind"
                            onChange={(e) => choose(e.target.value as Kind)}
                        >
                            {KINDS.map((k) => (
                                <option key={k.id} value={k.id}>
                                    {k.label}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <div className="grid grid-cols-3 gap-2">
                        {labels.map((label, i) => (
                            <Field key={label} label={`${label} (${unitSuffix()})`}>
                                <TextInput
                                    value={sizes[i]}
                                    inputMode="decimal"
                                    data-testid={`quick-build-${label.toLowerCase()}`}
                                    onChange={(e) =>
                                        setSizes(sizes.map((s, j) => (j === i ? e.target.value : s)))
                                    }
                                />
                            </Field>
                        ))}
                    </div>
                    {kind === 'shelfUnit' && (
                        <div className="grid grid-cols-2 items-end gap-2">
                            <Field label="Shelves">
                                <TextInput
                                    value={shelves}
                                    inputMode="numeric"
                                    data-testid="quick-build-shelves"
                                    onChange={(e) => setShelves(e.target.value)}
                                />
                            </Field>
                            <label className="flex h-8 items-center gap-2 text-[13px]">
                                <input
                                    type="checkbox"
                                    checked={back}
                                    onChange={(e) => setBack(e.target.checked)}
                                />
                                A back
                            </label>
                        </div>
                    )}
                    {kind === 'table' && (
                        <label className="flex h-8 items-center gap-2 text-[13px]">
                            <input
                                type="checkbox"
                                checked={apron}
                                onChange={(e) => setApron(e.target.checked)}
                            />
                            An apron under the top
                        </label>
                    )}
                    <Field label="Name">
                        <TextInput
                            value={name}
                            placeholder={preset.name}
                            maxLength={120}
                            data-testid="quick-build-name"
                            onChange={(e) => setName(e.target.value)}
                        />
                    </Field>
                </div>
                <div className="flex min-h-56 flex-col">
                    {'error' in result ? (
                        <p
                            className="bg-surface-2 text-muted flex flex-1 items-center justify-center rounded-xl p-4 text-center text-[13px]"
                            data-testid="quick-build-problem"
                        >
                            {result.error}
                        </p>
                    ) : (
                        <>
                            <div
                                className="flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-white p-3 [&>svg]:h-full [&>svg]:max-h-64 [&>svg]:w-full"
                                data-testid="quick-build-preview"
                                // The core's drawing; part names in it are escaped there.
                                dangerouslySetInnerHTML={{ __html: result.svg }}
                            />
                            <p
                                className="text-muted mt-1.5 text-center text-xs"
                                data-testid="quick-build-summary"
                            >
                                {result.spec.parts.length} parts, from the front
                            </p>
                        </>
                    )}
                </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
                <button className="hover:bg-fg/[0.07] rounded-lg px-3 py-1.5 text-sm" onClick={onClose}>
                    Cancel
                </button>
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                    data-testid="quick-build-create"
                    disabled={'error' in result}
                    onClick={() => 'spec' in result && onCreate(title, result.spec)}
                >
                    Create
                </button>
            </div>
        </Modal>
    );
}
