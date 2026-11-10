import { useState } from 'react';
import { computeShelfSag, DEFAULT_SAG_LIMIT_PER_FOOT, DEFAULT_SHELF_LOAD_PER_FOOT } from '@/calc/shelf';
import { speciesById, type SpeciesId } from '@/lib/species';
import type { EndCondition } from '@/struct/beam';
import { MeasureField, NumberField, ResultGrid, SpeciesSelect } from './fields';
import { CalcPanel, Heading, Segmented, TONE_BOX } from './layout';

const VERDICT = {
    ok: { title: 'Holds comfortably', tone: 'ok' as const },
    marginal: { title: 'Close to the limit', tone: 'warn' as const },
    sag: { title: 'This will sag visibly', tone: 'danger' as const },
};

export default function ShelfSagPanel() {
    const [species, setSpecies] = useState<SpeciesId>('oak');
    const [span, setSpan] = useState<number | null>(36);
    const [depth, setDepth] = useState<number | null>(12);
    const [thickness, setThickness] = useState<number | null>(0.75);
    const [load, setLoad] = useState<number | null>(DEFAULT_SHELF_LOAD_PER_FOOT);
    const [mode, setMode] = useState<'uniform' | 'center'>('uniform');
    const [ends, setEnds] = useState<EndCondition>('simple');

    const r =
        span === null || depth === null || thickness === null || load === null
            ? null
            : computeShelfSag({
                  span,
                  depth,
                  thickness,
                  speciesId: species,
                  load:
                      mode === 'uniform'
                          ? { kind: 'uniform', perFoot: load }
                          : { kind: 'center', pounds: load },
                  ends,
                  allowedPerFoot: DEFAULT_SAG_LIMIT_PER_FOOT,
              });

    const pct = r ? (r.ratio * 100).toFixed(0) : '';
    const verdictText = !r
        ? 'Fill in the shelf to see how it behaves.'
        : r.verdict === 'sag'
          ? `Over the limit at ${pct}% of the allowance. Shorten the span to ${r.maxSpan.toFixed(1)} in, go thicker, or add a support in the middle.`
          : r.verdict === 'marginal'
            ? `It passes, at ${pct}% of the allowance — but there is little headroom if the load grows.`
            : `At ${pct}% of the allowance. This section could span ${r.maxSpan.toFixed(1)} in before it reads as sagging.`;
    const modulus = speciesById(species)?.modulus ?? 0;

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The shelf</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <SpeciesSelect
                                value={species}
                                onChange={setSpecies}
                                label="Material"
                                testid="sg-species"
                                hint={`Modulus of elasticity ${(modulus / 1_000_000).toFixed(2)} million psi`}
                            />
                        </div>
                        <MeasureField
                            value={span}
                            onChange={setSpan}
                            label="Clear span"
                            testid="sg-span"
                            min={1}
                            hint="between supports"
                        />
                        <MeasureField
                            value={depth}
                            onChange={setDepth}
                            label="Depth"
                            testid="sg-depth"
                            min={1}
                            hint="front to back"
                        />
                        <MeasureField
                            value={thickness}
                            onChange={setThickness}
                            label="Thickness"
                            testid="sg-thickness"
                            min={0.125}
                        />
                        <NumberField
                            value={load}
                            onChange={setLoad}
                            label="Load"
                            testid="sg-load"
                            min={0}
                            step={5}
                            suffix={mode === 'uniform' ? 'lb/ft' : 'lb'}
                            hint={
                                mode === 'uniform'
                                    ? 'books ≈ 20–25 per foot'
                                    : 'the whole weight, at mid-span'
                            }
                        />
                        <div className="sm:col-span-2">
                            <Segmented
                                label="How it is loaded"
                                value={mode}
                                onChange={setMode}
                                options={[
                                    { value: 'uniform', label: 'Spread evenly', testid: 'sg-uniform' },
                                    { value: 'center', label: 'One load, centred', testid: 'sg-center' },
                                ]}
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Segmented
                                label="Ends"
                                value={ends}
                                onChange={setEnds}
                                options={[
                                    { value: 'simple', label: 'Resting on supports', testid: 'sg-simple' },
                                    { value: 'fixed', label: 'Housed in dados', testid: 'sg-fixed' },
                                ]}
                            />
                        </div>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>How it behaves</Heading>
                    <div
                        className={`mb-3.5 rounded-xl border p-4 ${r ? TONE_BOX[VERDICT[r.verdict].tone] : TONE_BOX.none}`}
                        data-testid="sg-verdict"
                    >
                        <p className="mb-1 text-[15px] font-semibold">
                            {r ? VERDICT[r.verdict].title : 'Fill in the shelf'}
                        </p>
                        <p className="text-[12.5px] leading-snug opacity-90">{verdictText}</p>
                    </div>
                    <ResultGrid
                        testid="sg-results"
                        tiles={[
                            {
                                label: 'Deflection at mid-span',
                                value: r ? `${r.deflection.toFixed(3)} in` : null,
                                emphasis: true,
                            },
                            { label: 'Allowed', value: r ? `${r.allowed.toFixed(3)} in` : null },
                            {
                                label: 'Longest span that passes',
                                value: r ? `${r.maxSpan.toFixed(1)} in` : null,
                            },
                        ]}
                    />
                    <ul className="border-fg/8 text-muted mt-3.5 space-y-1.5 border-t pt-3 text-xs leading-relaxed">
                        {(r?.notes ?? []).map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                </>
            }
        />
    );
}
