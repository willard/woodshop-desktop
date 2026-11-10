import { useState } from 'react';
import { computeSplay } from '@/calc/taper';
import { formatFraction } from '@/lib/fraction';
import { Notes } from './common';
import { MeasureField, NumberField, ResultGrid } from './fields';
import { CalcPanel, Heading } from './layout';

export default function SplayPanel() {
    const [rake, setRake] = useState<number | null>(10);
    const [splay, setSplay] = useState<number | null>(10);
    const [legLength, setLegLength] = useState<number | null>(18);
    const r =
        rake === null || splay === null || legLength === null
            ? null
            : computeSplay({ rakeDeg: rake, splayDeg: splay, legLength });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The lean</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <NumberField
                            value={rake}
                            onChange={setRake}
                            label="Rake — lean seen from the front"
                            testid="sp-rake"
                            min={0}
                            max={45}
                            suffix="°"
                        />
                        <NumberField
                            value={splay}
                            onChange={setSplay}
                            label="Splay — lean seen from the side"
                            testid="sp-splay"
                            min={0}
                            max={45}
                            suffix="°"
                        />
                        <div className="sm:col-span-2">
                            <MeasureField
                                value={legLength}
                                onChange={setLegLength}
                                label="Leg length"
                                testid="sp-length"
                                min={1}
                            />
                        </div>
                    </div>
                    <div className="border-warn/40 bg-warn/10 mt-4 rounded-lg border p-3">
                        <p className="text-warn-fg text-[13px] leading-relaxed">
                            A leg leaning in two directions is not drilled at either angle. It gets one
                            resultant angle, along one sightline — both larger than what you typed.
                        </p>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Drill it</Heading>
                    <ResultGrid
                        testid="sp-results"
                        tiles={[
                            {
                                label: 'Drill at this angle',
                                value: r ? `${r.resultantDeg.toFixed(2)}°` : null,
                                emphasis: true,
                            },
                            {
                                label: 'Along this sightline',
                                value: r ? `${r.sightlineDeg.toFixed(2)}°` : null,
                                emphasis: true,
                            },
                            { label: 'Bevel the foot', value: r ? `${r.footBevelDeg.toFixed(2)}°` : null },
                            {
                                label: 'Foot spread, front to back',
                                value: r ? `${formatFraction(r.footSpread.x, 16)} in` : null,
                            },
                            {
                                label: 'Foot spread, side to side',
                                value: r ? `${formatFraction(r.footSpread.z, 16)} in` : null,
                            },
                        ]}
                    />
                    <Notes
                        notes={r?.notes ?? []}
                        extra={
                            <li>
                                Mark the sightline on the seat, rotate the work to it, then tilt the bit to
                                the resultant angle.
                            </li>
                        }
                    />
                </>
            }
        />
    );
}
