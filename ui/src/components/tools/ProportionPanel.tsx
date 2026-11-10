import { useState } from 'react';
import { computeGraduatedDivision, computeProportion, RATIOS } from '@/calc/proportion';
import { formatFraction } from '@/lib/fraction';
import { Notes } from './common';
import { MeasureField, NumberField, ResultGrid } from './fields';
import { Heading, Segmented, SelectField } from './layout';

const frac16 = (v: number) => `${formatFraction(v, 16)} in`;

export default function ProportionPanel() {
    const [known, setKnown] = useState<number | null>(36);
    const [ratioId, setRatioId] = useState('golden');
    const [direction, setDirection] = useState<'larger' | 'smaller'>('larger');
    const [drawerTotal, setDrawerTotal] = useState<number | null>(40);
    const [drawerCount, setDrawerCount] = useState<number | null>(4);
    const [drawerRatio, setDrawerRatio] = useState<number | null>(1.2);
    const [drawerGap, setDrawerGap] = useState<number | null>(0.25);

    const ratioValue = RATIOS.find((x) => x.id === ratioId)?.value ?? 1.618033988749895;
    const r = known === null ? null : computeProportion({ known, ratioValue, direction });
    const drawers =
        drawerTotal === null || drawerCount === null || drawerRatio === null || drawerGap === null
            ? []
            : computeGraduatedDivision(drawerTotal, drawerCount, drawerRatio, drawerGap);
    const box = 'border-fg/8 bg-surface-1/50 rounded-xl border p-5';

    return (
        <div className="flex flex-col gap-4">
            <div className={box}>
                <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                        <Heading>Size a case</Heading>
                        <div className="grid gap-3.5">
                            <MeasureField
                                value={known}
                                onChange={setKnown}
                                label="The dimension you have"
                                testid="pr-known"
                                min={0.25}
                            />
                            <SelectField label="Ratio" id="pr-ratio" value={ratioId} onChange={setRatioId}>
                                {RATIOS.map((x) => (
                                    <option key={x.id} value={x.id}>
                                        {x.label}
                                    </option>
                                ))}
                            </SelectField>
                            <Segmented
                                label="What you have is the"
                                value={direction}
                                onChange={setDirection}
                                options={[
                                    { value: 'larger', label: 'Larger side', testid: 'pr-larger' },
                                    { value: 'smaller', label: 'Smaller side', testid: 'pr-smaller' },
                                ]}
                            />
                        </div>
                    </div>
                    <div>
                        <Heading>Comes out at</Heading>
                        <ResultGrid
                            testid="pr-results"
                            tiles={[
                                { label: 'Larger side', value: r ? frac16(r.larger) : null, emphasis: true },
                                {
                                    label: 'Smaller side',
                                    value: r ? frac16(r.smaller) : null,
                                    emphasis: true,
                                },
                                { label: 'Divides at', value: r ? frac16(r.sectionMajor) : null },
                                { label: 'Leaving', value: r ? frac16(r.sectionMinor) : null },
                                {
                                    label: 'In whole numbers',
                                    value: r ? `${r.nearestSimple.a} : ${r.nearestSimple.b}` : null,
                                },
                            ]}
                        />
                        <Notes notes={r?.notes ?? []} />
                    </div>
                </div>
            </div>
            <div className={box}>
                <Heading>Graduated drawer fronts</Heading>
                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <MeasureField
                            value={drawerTotal}
                            onChange={setDrawerTotal}
                            label="Opening height"
                            testid="pr-total"
                            min={1}
                        />
                        <NumberField
                            value={drawerCount}
                            onChange={setDrawerCount}
                            label="Drawers"
                            testid="pr-count"
                            min={1}
                            max={12}
                        />
                        <NumberField
                            value={drawerRatio}
                            onChange={setDrawerRatio}
                            label="Growth per drawer"
                            testid="pr-growth"
                            min={1}
                            max={2}
                            step={0.05}
                            steppers={false}
                            hint="1.0 is even; 1.2 reads well"
                        />
                        <MeasureField
                            value={drawerGap}
                            onChange={setDrawerGap}
                            label="Gap between"
                            testid="pr-gap"
                            min={0}
                        />
                    </div>
                    <div>
                        {drawers.length > 0 ? (
                            <div className="flex flex-col gap-1.5" data-testid="pr-drawers">
                                {drawers.map((h, i) => (
                                    <div
                                        key={i}
                                        className="bg-surface-2 text-fg-strong flex items-center justify-between rounded-lg px-3 text-[13px] font-semibold tabular-nums"
                                        style={{ height: `${Math.max(28, h * 4)}px` }}
                                    >
                                        <span className="text-muted text-[11.5px] font-normal">
                                            Drawer {i + 1}
                                        </span>
                                        <span>{frac16(h)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted text-xs">
                                The gaps use up the whole opening — reduce the gap or the drawer count.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
