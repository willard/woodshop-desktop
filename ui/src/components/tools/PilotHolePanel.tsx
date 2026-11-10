import { useState } from 'react';
import { computePilotHole, SCREW_SPECS, type PilotGauge } from '@/calc/pilotHoles';
import { formatFraction } from '@/lib/fraction';
import type { SpeciesId } from '@/lib/species';
import { Check, Notes, Tile } from './common';
import { MeasureField, ResultGrid, SpeciesSelect } from './fields';
import { CalcPanel, Heading, Segmented, SelectField } from './layout';

const bit = (v: number | undefined) => (v === undefined ? null : `${formatFraction(v, 64)} in`);

export default function PilotHolePanel() {
    const [joint, setJoint] = useState<'faceScrew' | 'pocketScrew'>('faceScrew');
    const [topThickness, setTopThickness] = useState<number | null>(0.75);
    const [bottomThickness, setBottomThickness] = useState<number | null>(0.75);
    const [species, setSpecies] = useState<SpeciesId>('oak');
    const [gauge, setGauge] = useState<PilotGauge | null>(null);
    const [endGrain, setEndGrain] = useState(false);
    const [counterbore, setCounterbore] = useState(false);
    const r =
        topThickness === null || bottomThickness === null
            ? null
            : computePilotHole({
                  joint,
                  topThickness,
                  bottomThickness,
                  speciesId: species,
                  gauge,
                  endGrain,
                  counterbore,
              });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The screw joint</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <Segmented
                                label="Joint"
                                value={joint}
                                onChange={setJoint}
                                options={[
                                    { value: 'faceScrew', label: 'Straight through', testid: 'ph-face' },
                                    { value: 'pocketScrew', label: 'Pocket screw', testid: 'ph-pocket' },
                                ]}
                            />
                        </div>
                        <MeasureField
                            value={topThickness}
                            onChange={setTopThickness}
                            label="Board it goes through"
                            testid="ph-top"
                            min={0.125}
                        />
                        <MeasureField
                            value={bottomThickness}
                            onChange={setBottomThickness}
                            label="Board it lands in"
                            testid="ph-bottom"
                            min={0.125}
                        />
                        <div className="sm:col-span-2">
                            <SpeciesSelect
                                value={species}
                                onChange={setSpecies}
                                label="Material it lands in"
                                testid="ph-species"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <SelectField
                                label="Screw gauge"
                                id="ph-gauge"
                                value={gauge ?? ''}
                                onChange={(v) => setGauge(v === '' ? null : (v as PilotGauge))}
                            >
                                <option value="">Choose for me</option>
                                {SCREW_SPECS.map((s) => (
                                    <option key={s.gauge} value={s.gauge}>
                                        {s.gauge}
                                    </option>
                                ))}
                            </SelectField>
                        </div>
                        <Check checked={endGrain} onChange={setEndGrain} testid="ph-endgrain">
                            Landing in end grain
                        </Check>
                        <Check checked={counterbore} onChange={setCounterbore} testid="ph-counterbore">
                            Counterbore for a plug
                        </Check>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Drill</Heading>
                    <ResultGrid
                        testid="ph-results"
                        tiles={[
                            { label: 'Pilot hole', value: bit(r?.pilot), emphasis: true },
                            { label: 'Clearance hole, top board', value: bit(r?.clearance), emphasis: true },
                            {
                                label: 'Screw',
                                value: r ? `${r.gauge} × ${formatFraction(r.length, 16)} in` : null,
                            },
                            { label: 'Thread', value: r ? r.thread : null },
                            { label: 'Countersink depth', value: bit(r?.countersinkDepth) },
                            { label: 'Keep from the edge', value: bit(r?.minEdgeDistance) },
                        ]}
                    />
                    {r?.counterbore && (
                        <Tile
                            testid="ph-counterbore-out"
                            label="Counterbore"
                            value={`${formatFraction(r.counterbore.diameter, 32)} in × ${formatFraction(r.counterbore.depth, 32)} in deep`}
                        />
                    )}
                    <Notes
                        notes={r?.notes ?? []}
                        extra={
                            <li>
                                Screw length and thread come from the same rules the editor uses to draw them.
                            </li>
                        }
                    />
                </>
            }
        />
    );
}
