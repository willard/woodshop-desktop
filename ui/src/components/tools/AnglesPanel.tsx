import { useState } from 'react';
import { computePolygonAngles } from '@/calc/angles';
import { NumberField, ResultGrid } from './fields';
import { CalcPanel, Footnote, Heading } from './layout';

const PRESETS = [
    { label: 'Square box', sides: 4, tilt: 0 },
    { label: 'Hexagon', sides: 6, tilt: 0 },
    { label: 'Octagon', sides: 8, tilt: 0 },
    { label: '12-sided', sides: 12, tilt: 0 },
    { label: 'Canted planter', sides: 4, tilt: 30 },
] as const;

export default function AnglesPanel() {
    const [sides, setSides] = useState<number | null>(6);
    const [tilt, setTilt] = useState(0);
    const r = sides === null ? null : computePolygonAngles({ sides, tiltDeg: tilt });
    const n = sides ?? 0;
    const points =
        n < 3 || n > 24
            ? ''
            : Array.from({ length: n }, (_, i) => {
                  const a = (i * 2 * Math.PI) / n - Math.PI / 2;
                  return `${(120 + 78 * Math.cos(a)).toFixed(1)},${(100 + 78 * Math.sin(a)).toFixed(1)}`;
              }).join(' ');

    return (
        <CalcPanel
            inputs={
                <>
                    <Heading>The shape</Heading>
                    <div className="grid gap-3.5">
                        <NumberField
                            value={sides}
                            onChange={setSides}
                            label="Sides"
                            testid="an-sides"
                            min={3}
                            max={24}
                            hint="3 to 24"
                        />
                        <div className="flex flex-col gap-1.5">
                            <label className="text-muted text-[12.5px] font-medium" htmlFor="an-tilt">
                                How far each side leans out from vertical
                            </label>
                            <input
                                id="an-tilt"
                                value={tilt}
                                onChange={(e) => setTilt(Number(e.target.value))}
                                type="range"
                                min="0"
                                max="60"
                                step="1"
                                data-testid="an-tilt"
                                className="accent-accent h-11 w-full"
                            />
                            <p className="text-faint text-[11px]">
                                {tilt === 0 ? '0° — sides stand straight up' : `${tilt}° out from vertical`}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.label}
                                    type="button"
                                    className="border-fg/12 text-muted hover:border-accent-strong/50 hover:text-accent rounded-full border px-3 py-2 text-xs"
                                    onClick={() => {
                                        setSides(p.sides);
                                        setTilt(p.tilt);
                                    }}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="bg-surface-2 mt-4 flex justify-center rounded-lg p-3">
                        <svg viewBox="0 0 240 200" width="200" height="167" fill="none" aria-hidden="true">
                            {points && (
                                <polygon
                                    points={points}
                                    className="stroke-accent"
                                    strokeWidth="2.5"
                                    fill="none"
                                    strokeLinejoin="round"
                                />
                            )}
                        </svg>
                    </div>
                </>
            }
            results={
                <>
                    <Heading>Set the saw</Heading>
                    <ResultGrid
                        testid="an-results"
                        tiles={[
                            {
                                label: 'Miter — swing the gauge',
                                value: r ? `${r.miterDeg.toFixed(2)}°` : null,
                                emphasis: true,
                            },
                            {
                                label: 'Bevel — tilt the blade',
                                value: r ? `${r.bevelDeg.toFixed(2)}°` : null,
                                emphasis: true,
                            },
                            { label: 'Interior angle', value: r ? `${r.interiorDeg.toFixed(2)}°` : null },
                            { label: 'Turn per side', value: r ? `${r.exteriorDeg.toFixed(2)}°` : null },
                        ]}
                    />
                    <Footnote>
                        {tilt === 0
                            ? 'A flat frame or upright box: the blade stays at 0 and both mating pieces get the same miter. Cut a test corner in scrap — a whole ring multiplies any error by the number of sides.'
                            : 'A compound cut. Both settings apply to every piece, and both mating faces get the same pair. Check one test joint against a square before committing the stock.'}
                    </Footnote>
                </>
            }
        />
    );
}
