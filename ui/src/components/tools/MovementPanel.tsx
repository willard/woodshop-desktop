import { useState } from 'react';
import { computeMovement, type Grain } from '@/calc/movement';
import { DEFAULT_CALC_CONFIG } from '@/calc/types';
import { formatFraction } from '@/lib/fraction';
import type { SpeciesId } from '@/lib/species';
import { Notes } from './common';
import { MeasureField, NumberField, ResultGrid, SpeciesSelect } from './fields';
import { CalcPanel, Heading, Segmented } from './layout';

export default function MovementPanel() {
    const [species, setSpecies] = useState<SpeciesId>('oak');
    const [width, setWidth] = useState<number | null>(24);
    const [grain, setGrain] = useState<Grain>('flatsawn');
    const [rhLow, setRhLow] = useState<number | null>(DEFAULT_CALC_CONFIG.rhLow);
    const [rhHigh, setRhHigh] = useState<number | null>(DEFAULT_CALC_CONFIG.rhHigh);
    const r =
        width === null || rhLow === null || rhHigh === null
            ? null
            : computeMovement({
                  speciesId: species,
                  width,
                  grain,
                  moisture: { kind: 'rh', lowPercent: rhLow, highPercent: rhHigh },
              });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The panel</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <SpeciesSelect
                                value={species}
                                onChange={setSpecies}
                                label="Species"
                                testid="mv-species"
                                solidOnly
                                hint="panels are left out — they barely move across the face"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <MeasureField
                                value={width}
                                onChange={setWidth}
                                label="Width across the grain"
                                testid="mv-width"
                                min={0.25}
                                hint="only this dimension moves"
                            />
                        </div>
                        <NumberField
                            value={rhLow}
                            onChange={setRhLow}
                            label="Driest humidity"
                            testid="mv-rh-low"
                            min={5}
                            max={95}
                            step={5}
                            suffix="%"
                        />
                        <NumberField
                            value={rhHigh}
                            onChange={setRhHigh}
                            label="Dampest humidity"
                            testid="mv-rh-high"
                            min={5}
                            max={95}
                            step={5}
                            suffix="%"
                        />
                        <div className="sm:col-span-2">
                            <Segmented
                                label="How it was sawn"
                                value={grain}
                                onChange={setGrain}
                                options={[
                                    { value: 'flatsawn', label: 'Flatsawn', testid: 'mv-flatsawn' },
                                    { value: 'riftsawn', label: 'Rift', testid: 'mv-riftsawn' },
                                    { value: 'quartersawn', label: 'Quartersawn', testid: 'mv-quartersawn' },
                                ]}
                            />
                        </div>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>How much it moves</Heading>
                    <ResultGrid
                        testid="mv-results"
                        tiles={[
                            {
                                label: 'Leave this much at each edge',
                                value: r ? `${formatFraction(r.perSide, 32)} in` : null,
                                emphasis: true,
                                wide: true,
                            },
                            { label: 'Total seasonal swing', value: r ? `${r.change.toFixed(3)} in` : null },
                            { label: 'Moisture swing', value: r ? `${r.deltaEmc.toFixed(1)}% MC` : null },
                            { label: 'Narrowest', value: r ? `${r.widthAtLow.toFixed(3)} in` : null },
                            { label: 'Widest', value: r ? `${r.widthAtHigh.toFixed(3)} in` : null },
                        ]}
                    />
                    {r && (
                        <div className="bg-surface-2 mt-3 rounded-lg p-3" data-testid="mv-both">
                            <Heading>Both orientations</Heading>
                            <div className="flex justify-between text-[13px]">
                                <span className="text-muted">Flatsawn</span>
                                <span className="text-fg-strong font-semibold tabular-nums">
                                    {r.flatsawnChange.toFixed(3)} in
                                </span>
                            </div>
                            <div className="mt-1 flex justify-between text-[13px]">
                                <span className="text-muted">Quartersawn</span>
                                <span className="text-fg-strong font-semibold tabular-nums">
                                    {r.quartersawnChange.toFixed(3)} in
                                </span>
                            </div>
                            <p className="text-faint mt-2 text-[11px] leading-relaxed">
                                Shown whichever you picked, so a wrong guess about the sawing is visible.
                            </p>
                        </div>
                    )}
                    <Notes notes={r?.notes ?? []} />
                </>
            }
        />
    );
}
