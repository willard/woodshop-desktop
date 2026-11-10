import { useState } from 'react';
import { computeBoardFeet, QUARTER_THICKNESSES } from '@/calc/boardFeet';
import { DEFAULT_CALC_CONFIG } from '@/calc/types';
import type { LengthUnit } from '@/lib/units';
import { MeasureField, NumberField, ResultGrid } from './fields';
import { CalcPanel, Footnote, Heading, Segmented } from './layout';

const UNITS: readonly LengthUnit[] = ['in', 'ft', 'mm', 'cm'];

export default function BoardFeetPanel() {
    const [thickness, setThickness] = useState<number | null>(2);
    const [width, setWidth] = useState<number | null>(6.25);
    const [length, setLength] = useState<number | null>(96);
    const [lengthUnit, setLengthUnit] = useState<LengthUnit>('in');
    const [qty, setQty] = useState<number | null>(6);
    const [wastePercent, setWastePercent] = useState<number | null>(DEFAULT_CALC_CONFIG.wasteFactor * 100);
    const [price, setPrice] = useState<number | null>(null);
    const [shape, setShape] = useState<'flat' | 'round'>('flat');
    const round = shape === 'round';

    const result =
        thickness === null || length === null || qty === null || (!round && width === null)
            ? null
            : computeBoardFeet({
                  thickness,
                  width: width ?? 0,
                  length,
                  qty,
                  wasteFactor: (wastePercent ?? 0) / 100,
                  pricePerBoardFoot: price,
                  round,
              });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The stack</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-muted text-[12.5px] font-medium" htmlFor="bf-quarter">
                                Rough thickness
                            </label>
                            <select
                                id="bf-quarter"
                                data-testid="bf-quarter"
                                defaultValue=""
                                className="bg-surface-2 text-fg-strong border-fg/10 h-11 w-full rounded-md border px-2 text-sm"
                                onChange={(e) =>
                                    e.target.value !== '' && setThickness(Number(e.target.value))
                                }
                            >
                                <option value="">Custom</option>
                                {QUARTER_THICKNESSES.map((q) => (
                                    <option key={q.label} value={q.thickness}>
                                        {q.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <MeasureField
                            value={thickness}
                            onChange={setThickness}
                            label="Thickness"
                            testid="bf-thickness"
                            min={0.0625}
                            hint="before planing — what you pay for"
                        />
                        {!round && (
                            <MeasureField
                                value={width}
                                onChange={setWidth}
                                label="Width"
                                testid="bf-width"
                                min={0.0625}
                            />
                        )}
                        <MeasureField
                            value={length}
                            onChange={setLength}
                            unit={lengthUnit}
                            onUnit={setLengthUnit}
                            label="Length"
                            testid="bf-length"
                            units={UNITS}
                            min={0.0625}
                        />
                        <NumberField value={qty} onChange={setQty} label="Pieces" testid="bf-qty" min={0} />
                        <NumberField
                            value={wastePercent}
                            onChange={setWastePercent}
                            label="Waste allowance"
                            testid="bf-waste"
                            min={0}
                            max={100}
                            step={5}
                            suffix="%"
                            hint="defects, snipe, trim"
                        />
                        <NumberField
                            value={price}
                            onChange={setPrice}
                            label="Price per board foot"
                            testid="bf-price"
                            min={0}
                            steppers={false}
                            hint="optional"
                        />
                    </div>
                    <div className="mt-4">
                        <Segmented
                            value={shape}
                            onChange={setShape}
                            options={[
                                { value: 'flat', label: 'Flat stock', testid: 'bf-flat' },
                                { value: 'round', label: 'Round — dowel or blank', testid: 'bf-round' },
                            ]}
                        />
                    </div>
                </>
            }
            results={
                <>
                    <Heading>What to buy</Heading>
                    <ResultGrid
                        testid="bf-results"
                        tiles={[
                            { label: 'Per piece', value: result ? result.perPiece.toFixed(2) : null },
                            { label: 'Total', value: result ? result.total.toFixed(1) : null },
                            {
                                label: `Buy this much — ${(wastePercent ?? 0).toFixed(0)}% added`,
                                value: result ? `${result.withWaste.toFixed(1)} bdft` : null,
                                emphasis: true,
                            },
                            {
                                label: 'Estimated cost',
                                value: result?.cost != null ? `$${result.cost.toFixed(2)}` : null,
                            },
                        ]}
                    />
                    <Footnote>
                        {round
                            ? 'Round stock is a cylinder inside a square blank — about 79% of the boxed volume. Width is ignored; the thickness is the diameter.'
                            : 'One board foot is 144 cubic inches. A 4/4 board planed to 3/4 is still sold and priced as 4/4.'}
                    </Footnote>
                </>
            }
        />
    );
}
