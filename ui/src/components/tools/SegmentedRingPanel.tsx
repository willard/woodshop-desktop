import { useState } from 'react';
import { computeSegmentedRing } from '@/calc/arc';
import { DEFAULT_CUTLIST_CONFIG } from '@/cutlist/types';
import { DEFAULT_STOCK_LENGTH } from '@/lib/lumberSizes';
import { formatFraction } from '@/lib/fraction';
import { Notes } from './common';
import { MeasureField, NumberField, ResultGrid } from './fields';
import { CalcPanel, Heading } from './layout';

export default function SegmentedRingPanel() {
    const [outerDiameter, setOuterDiameter] = useState<number | null>(12);
    const [ringWidth, setRingWidth] = useState<number | null>(1.5);
    const [segments, setSegments] = useState<number | null>(12);
    const [kerf, setKerf] = useState<number | null>(DEFAULT_CUTLIST_CONFIG.kerf);
    const [boardLength, setBoardLength] = useState<number | null>(DEFAULT_STOCK_LENGTH);
    const r =
        outerDiameter === null ||
        ringWidth === null ||
        segments === null ||
        kerf === null ||
        boardLength === null
            ? null
            : computeSegmentedRing({ outerDiameter, ringWidth, segments, kerf, boardLength });

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The ring</Heading>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <MeasureField
                            value={outerDiameter}
                            onChange={setOuterDiameter}
                            label="Outside diameter"
                            testid="sr-od"
                            min={1}
                        />
                        <MeasureField
                            value={ringWidth}
                            onChange={setRingWidth}
                            label="Wall width"
                            testid="sr-width"
                            min={0.125}
                            hint="measured radially"
                        />
                        <NumberField
                            value={segments}
                            onChange={setSegments}
                            label="Segments"
                            testid="sr-segments"
                            min={3}
                            max={64}
                        />
                        <MeasureField value={kerf} onChange={setKerf} label="Kerf" testid="sr-kerf" min={0} />
                        <div className="sm:col-span-2">
                            <MeasureField
                                value={boardLength}
                                onChange={setBoardLength}
                                label="Board length you have"
                                testid="sr-board"
                                min={1}
                            />
                        </div>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Cut list</Heading>
                    <ResultGrid
                        testid="sr-results"
                        tiles={[
                            {
                                label: 'Miter — each end',
                                value: r ? `${r.miterDeg.toFixed(2)}°` : null,
                                emphasis: true,
                            },
                            { label: 'Segment angle', value: r ? `${r.segmentAngleDeg.toFixed(2)}°` : null },
                            {
                                label: 'Outer edge, each segment',
                                value: r ? `${formatFraction(r.outerLength, 32)} in` : null,
                                emphasis: true,
                            },
                            {
                                label: 'Inner edge',
                                value: r ? `${formatFraction(r.innerLength, 32)} in` : null,
                            },
                            {
                                label: 'Blank width',
                                value: r ? `${formatFraction(r.blankWidth, 16)} in` : null,
                            },
                            { label: 'Boards per ring', value: r ? String(r.boardsPerRing) : null },
                        ]}
                    />
                    {r ? (
                        <Notes
                            notes={r.notes}
                            extra={
                                <li>Total run including kerfs: {formatFraction(r.stockPerRing, 16)} in.</li>
                            }
                        />
                    ) : (
                        <p className="text-muted mt-3.5 text-xs">
                            The wall cannot be half the diameter or more — that is a disc, not a ring.
                        </p>
                    )}
                </>
            }
        />
    );
}
