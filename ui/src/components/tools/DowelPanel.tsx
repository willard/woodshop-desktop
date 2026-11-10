import { useState } from 'react';
import { computeDowelLayout, DEFAULT_DOWEL_END_INSET, DEFAULT_DOWEL_SPACING } from '@/calc/joinery';
import { DOWEL_SIZES } from '@/lib/lumberSizes';
import { formatFraction } from '@/lib/fraction';
import { Notes } from './common';
import { MeasureField, ResultGrid } from './fields';
import { CalcPanel, Heading, SelectField } from './layout';

export default function DowelPanel() {
    const [jointLength, setJointLength] = useState<number | null>(24);
    const [stockThickness, setStockThickness] = useState<number | null>(0.75);
    const [diameter, setDiameter] = useState<number | null>(null);
    const [spacing, setSpacing] = useState<number | null>(DEFAULT_DOWEL_SPACING);
    const [endInset, setEndInset] = useState<number | null>(DEFAULT_DOWEL_END_INSET);
    const r =
        jointLength === null || stockThickness === null || spacing === null || endInset === null
            ? null
            : computeDowelLayout({ jointLength, stockThickness, diameter, spacing, endInset });
    const frac = (v: number) => `${formatFraction(v, 32)} in`;

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The joint</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <MeasureField
                            value={jointLength}
                            onChange={setJointLength}
                            label="Length of the run"
                            testid="dw-length"
                            min={1}
                        />
                        <MeasureField
                            value={stockThickness}
                            onChange={setStockThickness}
                            label="Stock thickness"
                            testid="dw-thickness"
                            min={0.125}
                        />
                        <div className="sm:col-span-2">
                            <SelectField
                                label="Dowel size"
                                id="dw-diameter"
                                value={diameter ?? ''}
                                onChange={(v) => setDiameter(v === '' ? null : Number(v))}
                            >
                                <option value="">Choose for me (about a third of the stock)</option>
                                {DOWEL_SIZES.map((d) => (
                                    <option key={d.label} value={d.diameter}>
                                        {d.label}
                                    </option>
                                ))}
                            </SelectField>
                        </div>
                        <MeasureField
                            value={spacing}
                            onChange={setSpacing}
                            label="Maximum spacing"
                            testid="dw-spacing"
                            min={0.5}
                            hint="the gap comes out at or under this"
                        />
                        <MeasureField
                            value={endInset}
                            onChange={setEndInset}
                            label="Inset from each end"
                            testid="dw-inset"
                            min={0}
                        />
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Lay it out</Heading>
                    <ResultGrid
                        testid="dw-results"
                        tiles={[
                            { label: 'Dowels', value: r ? String(r.count) : null, emphasis: true },
                            { label: 'Size', value: r ? r.label : null, emphasis: true },
                            { label: 'Actual spacing', value: r ? frac(r.actualSpacing) : null },
                            { label: 'Dowel length', value: r ? frac(r.dowelLength) : null },
                            { label: 'Hole depth, each side', value: r ? frac(r.holeDepthEach) : null },
                        ]}
                    />
                    {r && (
                        <div className="bg-surface-2 mt-3 rounded-lg p-3" data-testid="dw-positions">
                            <Heading>Centres from one end</Heading>
                            <p className="text-fg-strong text-[13px] leading-relaxed tabular-nums">
                                {r.positions.map((p) => formatFraction(p, 16)).join(' · ')}
                            </p>
                        </div>
                    )}
                    <Notes notes={r?.notes ?? []} />
                </>
            }
        />
    );
}
