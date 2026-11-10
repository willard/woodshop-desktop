import { useState } from 'react';
import { computeTaper } from '@/calc/taper';
import { formatFraction } from '@/lib/fraction';
import { Notes } from './common';
import { MeasureField, ResultGrid } from './fields';
import { CalcPanel, Heading, Segmented } from './layout';

export default function TaperPanel() {
    const [length, setLength] = useState<number | null>(29);
    const [startWidth, setStartWidth] = useState<number | null>(1.75);
    const [endWidth, setEndWidth] = useState<number | null>(1);
    const [startAt, setStartAt] = useState<number | null>(5);
    const [faces, setFaces] = useState<'1' | '2' | '4'>('2');
    const r =
        length === null || startWidth === null || endWidth === null || startAt === null
            ? null
            : computeTaper({ length, startWidth, endWidth, startAt, faces: Number(faces) as 1 | 2 | 4 });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The leg</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <MeasureField
                            value={length}
                            onChange={setLength}
                            label="Leg length"
                            testid="tp-length"
                            min={1}
                        />
                        <MeasureField
                            value={startAt}
                            onChange={setStartAt}
                            label="Taper starts at"
                            testid="tp-start-at"
                            min={0}
                            hint="from the top; 0 tapers all of it"
                        />
                        <MeasureField
                            value={startWidth}
                            onChange={setStartWidth}
                            label="Width at the top"
                            testid="tp-start-w"
                            min={0.25}
                        />
                        <MeasureField
                            value={endWidth}
                            onChange={setEndWidth}
                            label="Width at the foot"
                            testid="tp-end-w"
                            min={0}
                        />
                        <div className="sm:col-span-2">
                            <Segmented
                                label="Faces tapered"
                                value={faces}
                                onChange={setFaces}
                                options={[
                                    { value: '1', label: 'One face', testid: 'tp-faces-1' },
                                    { value: '2', label: 'Two faces', testid: 'tp-faces-2' },
                                    { value: '4', label: 'All four', testid: 'tp-faces-4' },
                                ]}
                            />
                        </div>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Set the jig</Heading>
                    <ResultGrid
                        testid="tp-results"
                        tiles={[
                            {
                                label: 'Taper angle',
                                value: r ? `${r.angleDeg.toFixed(2)}°` : null,
                                emphasis: true,
                            },
                            {
                                label: 'Remove from each face',
                                value: r ? `${formatFraction(r.removalPerFace, 32)} in` : null,
                                emphasis: true,
                            },
                            {
                                label: 'Jig offset over the blank',
                                value: r ? `${formatFraction(r.jigOffset, 32)} in` : null,
                            },
                            {
                                label: 'Tapered length',
                                value: r ? `${formatFraction(r.taperLength, 16)} in` : null,
                            },
                            {
                                label: 'Blank',
                                value: r ? `${formatFraction(r.blankWidth, 16)} in square` : null,
                            },
                        ]}
                    />
                    <Notes
                        notes={r?.notes ?? []}
                        extra={
                            <li>
                                Cut the joinery before the taper, while the leg still has square faces to
                                register against.
                            </li>
                        }
                    />
                </>
            }
        />
    );
}
