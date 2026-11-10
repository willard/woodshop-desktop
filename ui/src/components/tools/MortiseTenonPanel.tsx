import { useState } from 'react';
import { computeMortiseTenon } from '@/calc/joinery';
import { formatFraction } from '@/lib/fraction';
import { Check, Notes, Tile } from './common';
import { MeasureField, ResultGrid } from './fields';
import { CalcPanel, Heading, Segmented } from './layout';

const frac = (v: number | undefined) => (v === undefined ? null : `${formatFraction(v, 32)} in`);

export default function MortiseTenonPanel() {
    const [railThickness, setRailThickness] = useState<number | null>(0.75);
    const [railWidth, setRailWidth] = useState<number | null>(3);
    const [stileThickness, setStileThickness] = useState<number | null>(1.5);
    const [through, setThrough] = useState<'blind' | 'through'>('blind');
    const [haunched, setHaunched] = useState(false);
    const r =
        railThickness === null || railWidth === null || stileThickness === null
            ? null
            : computeMortiseTenon({
                  railThickness,
                  railWidth,
                  stileThickness,
                  through: through === 'through',
                  haunched,
              });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The joint</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <MeasureField
                            value={railThickness}
                            onChange={setRailThickness}
                            label="Rail thickness"
                            testid="mt-rail-t"
                            min={0.125}
                        />
                        <MeasureField
                            value={railWidth}
                            onChange={setRailWidth}
                            label="Rail width"
                            testid="mt-rail-w"
                            min={0.25}
                        />
                        <div className="sm:col-span-2">
                            <MeasureField
                                value={stileThickness}
                                onChange={setStileThickness}
                                label="Stile thickness"
                                testid="mt-stile-t"
                                min={0.25}
                                hint="the piece being mortised"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Segmented
                                label="Mortise"
                                value={through}
                                onChange={setThrough}
                                options={[
                                    { value: 'blind', label: 'Blind', testid: 'mt-blind' },
                                    { value: 'through', label: 'Through', testid: 'mt-through' },
                                ]}
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Check checked={haunched} onChange={setHaunched} testid="mt-haunch">
                                Haunched — for a grooved frame
                            </Check>
                        </div>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Cut it to</Heading>
                    <ResultGrid
                        testid="mt-results"
                        tiles={[
                            { label: 'Tenon thickness', value: frac(r?.tenonThickness), emphasis: true },
                            { label: 'Tenon length', value: frac(r?.tenonLength), emphasis: true },
                            { label: 'Tenon width', value: frac(r?.tenonWidth) },
                            { label: 'Cheek shoulder, each face', value: frac(r?.shoulderFace) },
                            { label: 'Edge shoulder', value: frac(r?.shoulderEdge) },
                            { label: 'Mortise depth', value: frac(r?.mortiseDepth) },
                        ]}
                    />
                    {r?.haunchDepth ? (
                        <Tile label="Haunch depth" value={`${formatFraction(r.haunchDepth, 32)} in`} />
                    ) : null}
                    <Notes
                        notes={r?.notes ?? []}
                        extra={
                            <li>
                                The mortise width is the tenon thickness — cut the mortise first and pare the
                                tenon to it.
                            </li>
                        }
                    />
                </>
            }
        />
    );
}
