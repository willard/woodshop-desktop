import { useState } from 'react';
import { computeArc, type ArcKnown } from '@/calc/arc';
import { formatFraction } from '@/lib/fraction';
import { Notes } from './common';
import { MeasureField, ResultGrid } from './fields';
import { CalcPanel, Heading, Segmented } from './layout';

type Mode = 'chordRise' | 'chordRadius' | 'riseRadius';
const frac16 = (v: number) => `${formatFraction(v, 16)} in`;

export default function ArcPanel() {
    const [mode, setMode] = useState<Mode>('chordRise');
    const [chord, setChord] = useState<number | null>(48);
    const [rise, setRise] = useState<number | null>(6);
    const [radius, setRadius] = useState<number | null>(51);

    const known: ArcKnown | null =
        mode === 'chordRise'
            ? chord !== null && rise !== null
                ? { kind: 'chordRise', chord, rise }
                : null
            : mode === 'chordRadius'
              ? chord !== null && radius !== null
                  ? { kind: 'chordRadius', chord, radius }
                  : null
              : rise !== null && radius !== null
                ? { kind: 'riseRadius', rise, radius }
                : null;
    const r = known === null ? null : computeArc(known);
    const scale = r ? 300 / r.chord : 0;
    const curvePath = r
        ? `M10 ${10 + r.rise * scale} Q${10 + (r.chord * scale) / 2} ${10 - r.rise * scale} ${10 + r.chord * scale} ${10 + r.rise * scale}`
        : '';

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>What you know</Heading>
                    <div className="mb-3.5">
                        <Segmented
                            value={mode}
                            onChange={setMode}
                            options={[
                                { value: 'chordRise', label: 'Chord + rise', testid: 'ar-chordRise' },
                                { value: 'chordRadius', label: 'Chord + radius', testid: 'ar-chordRadius' },
                                { value: 'riseRadius', label: 'Rise + radius', testid: 'ar-riseRadius' },
                            ]}
                        />
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        {mode !== 'riseRadius' && (
                            <MeasureField
                                value={chord}
                                onChange={setChord}
                                label="Chord — straight across"
                                testid="ar-chord"
                                min={0.25}
                            />
                        )}
                        {mode !== 'chordRadius' && (
                            <MeasureField
                                value={rise}
                                onChange={setRise}
                                label="Rise — how far it stands proud"
                                testid="ar-rise"
                                min={0.0625}
                            />
                        )}
                        {mode !== 'chordRise' && (
                            <MeasureField
                                value={radius}
                                onChange={setRadius}
                                label="Radius"
                                testid="ar-radius"
                                min={0.25}
                            />
                        )}
                    </div>
                    <div className="bg-surface-2 mt-4 rounded-lg p-3">
                        <svg viewBox="0 0 320 90" width="100%" height="80" fill="none" aria-hidden="true">
                            {curvePath && (
                                <>
                                    <path
                                        d={curvePath}
                                        className="stroke-accent"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                    />
                                    <path
                                        d="M10 80h300"
                                        className="stroke-faint"
                                        strokeWidth="1"
                                        strokeDasharray="4 4"
                                    />
                                </>
                            )}
                        </svg>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>The curve</Heading>
                    <ResultGrid
                        testid="ar-results"
                        tiles={[
                            { label: 'Radius', value: r ? frac16(r.radius) : null, emphasis: true },
                            {
                                label: 'Pin the trammel this far from the chord',
                                value: r ? frac16(r.centreOffset) : null,
                                emphasis: true,
                                wide: true,
                            },
                            { label: 'Chord', value: r ? frac16(r.chord) : null },
                            { label: 'Rise', value: r ? frac16(r.rise) : null },
                            { label: 'Included angle', value: r ? `${r.includedDeg.toFixed(2)}°` : null },
                            { label: 'Length along the curve', value: r ? frac16(r.arcLength) : null },
                        ]}
                    />
                    {r ? (
                        <>
                            <div className="bg-surface-2 mt-3 rounded-lg p-3" data-testid="ar-ordinates">
                                <Heading>Offsets from the chord</Heading>
                                <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[12.5px] tabular-nums">
                                    {r.ordinates.map((o) => (
                                        <div key={o.along} className="flex justify-between gap-2">
                                            <span className="text-faint">{formatFraction(o.along, 8)}</span>
                                            <span className="text-fg-strong">
                                                {formatFraction(o.offset, 32)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-faint mt-2 text-[11px]">
                                    Step along the chord, measure up, bend a batten through the marks.
                                </p>
                            </div>
                            <Notes notes={r.notes} />
                        </>
                    ) : (
                        <p className="text-muted mt-3.5 text-xs">
                            That geometry cannot exist — a chord cannot be longer than the diameter, and a
                            rise cannot exceed the radius.
                        </p>
                    )}
                </>
            }
        />
    );
}
