import { useState } from 'react';
import { computeConversion } from '@/calc/convert';
import { formatFraction } from '@/lib/fraction';
import type { LengthUnit } from '@/lib/units';
import { MeasureField, ResultGrid } from './fields';
import { CalcPanel, Footnote, Heading, SelectField } from './layout';

const UNITS: readonly LengthUnit[] = ['in', 'ft', 'mm', 'cm', 'm'];
const DENOMINATORS = [8, 16, 32, 64] as const;

function signed(v: number): string {
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    return `${sign}${Math.abs(v).toFixed(4)} in`;
}

export default function ConvertPanel() {
    const [value, setValue] = useState<number | null>(0.984252);
    const [unit, setUnit] = useState<LengthUnit>('in');
    const [denominator, setDenominator] = useState(16);
    const r = value === null ? null : computeConversion({ inches: value, denominator });
    // The error is the point of this calculator, so it gets its own tone.
    const errorTone = Math.abs(r?.fractionError ?? 0) < 1 / 128 ? 'ok' : 'warn';

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The measurement</Heading>
                    <div className="grid gap-3.5">
                        <MeasureField
                            value={value}
                            onChange={setValue}
                            unit={unit}
                            onUnit={setUnit}
                            label="Any length"
                            testid="cv-value"
                            units={UNITS}
                            placeholder="25"
                        />
                        <SelectField
                            label="Finest mark on your rule"
                            id="cv-denominator"
                            value={denominator}
                            onChange={(v) => setDenominator(Number(v))}
                        >
                            {DENOMINATORS.map((d) => (
                                <option key={d} value={d}>
                                    1/{d}
                                </option>
                            ))}
                        </SelectField>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Reads as</Heading>
                    <ResultGrid
                        testid="cv-results"
                        tiles={[
                            {
                                label: `As a fraction (1/${denominator})`,
                                value: r ? r.fraction : null,
                                emphasis: true,
                            },
                            {
                                label: 'How far that mark is out',
                                value: r ? signed(r.fractionError) : null,
                                tone: r ? errorTone : undefined,
                            },
                            {
                                label: 'Feet and inches',
                                value: r
                                    ? `${r.feetInches.feet} ft ${formatFraction(r.feetInches.inches)} in`
                                    : null,
                            },
                            { label: 'Millimetres', value: r ? r.mm.toFixed(2) : null },
                            { label: 'Centimetres', value: r ? r.cm.toFixed(3) : null },
                            {
                                label: 'Decimal inches',
                                value: r ? String(Math.round(r.inches * 100000) / 100000) : null,
                            },
                        ]}
                    />
                    <Footnote>
                        Every converter prints the fraction. This one also prints how far that fraction misses
                        by — which is what accumulates across a run of drawers.
                    </Footnote>
                </>
            }
        />
    );
}
