/**
 * The stock estimator. Parts longer than the stock (or bigger than a sheet) are listed, never
 * silently dropped — `calc/stock.ts` filters them out of the packing.
 */
import { useState } from 'react';
import { computeLumberStock, computeSheetStock, type StockPiece } from '@/calc/stock';
import { DEFAULT_CUTLIST_CONFIG } from '@/cutlist/types';
import { DEFAULT_STOCK_LENGTH } from '@/lib/lumberSizes';
import { MeasureField, NumberField, ResultGrid, type ResultTile } from './fields';
import { CalcPanel, Footnote, Heading, Segmented } from './layout';

interface Row {
    id: string;
    label: string;
    length: number | null;
    width: number | null;
    qty: number | null;
    grainLocked: boolean;
}

let nextId = 0;
function blankRow(label: string, length: number, width: number, qty: number): Row {
    nextId += 1;
    return { id: `r${nextId}`, label, length, width, qty, grainLocked: false };
}

export default function StockPanel() {
    const [mode, setMode] = useState<'lumber' | 'sheet'>('lumber');
    const [rows, setRows] = useState<Row[]>(() => [blankRow('Rail', 30, 3, 4), blankRow('Stile', 42, 3, 2)]);
    const [stockLength, setStockLength] = useState<number | null>(DEFAULT_STOCK_LENGTH);
    const [sheetLength, setSheetLength] = useState<number | null>(96);
    const [sheetWidth, setSheetWidth] = useState<number | null>(48);
    const [kerf, setKerf] = useState<number | null>(DEFAULT_CUTLIST_CONFIG.kerf);
    const [price, setPrice] = useState<number | null>(null);

    const update = (id: string, patch: Partial<Row>) =>
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const pieces: StockPiece[] = rows
        .filter((r) => r.length !== null && r.qty !== null)
        .map((r) => ({
            id: r.id,
            label: r.label.trim() === '' ? 'Part' : r.label,
            length: r.length!,
            width: r.width ?? 0,
            qty: r.qty!,
            grainLocked: r.grainLocked,
        }));

    const lumber =
        mode !== 'lumber' || stockLength === null
            ? null
            : computeLumberStock({ pieces, stockLength, kerf: kerf ?? 0, pricePerStick: price });
    const sheet =
        mode !== 'sheet' || sheetLength === null || sheetWidth === null
            ? null
            : computeSheetStock({
                  pieces: pieces.filter((p) => p.width > 0),
                  sheet: { l: sheetLength, w: sheetWidth },
                  kerf: kerf ?? 0,
                  pricePerSheet: price,
              });
    const excluded = lumber?.tooLong ?? sheet?.unplaced ?? [];

    const tiles: ResultTile[] =
        mode === 'lumber'
            ? [
                  {
                      label: 'Sticks needed',
                      value: lumber ? String(lumber.stickCount) : null,
                      emphasis: true,
                  },
                  { label: 'Cuts', value: lumber ? String(lumber.cuts.length) : null },
                  { label: 'Waste', value: lumber ? `${lumber.wastePercent.toFixed(0)}%` : null },
                  { label: 'Cost', value: lumber?.cost != null ? `$${lumber.cost.toFixed(2)}` : null },
              ]
            : [
                  { label: 'Sheets needed', value: sheet ? String(sheet.sheetCount) : null, emphasis: true },
                  { label: 'Parts placed', value: sheet ? String(sheet.placements.length) : null },
                  { label: 'Waste', value: sheet ? `${sheet.wastePercent.toFixed(0)}%` : null },
                  { label: 'Cost', value: sheet?.cost != null ? `$${sheet.cost.toFixed(2)}` : null },
              ];

    return (
        <CalcPanel
            top={
                <div className="mb-4">
                    <Segmented
                        value={mode}
                        onChange={setMode}
                        options={[
                            { value: 'lumber', label: 'Boards', testid: 'st-mode-lumber' },
                            { value: 'sheet', label: 'Sheets', testid: 'st-mode-sheet' },
                        ]}
                    />
                </div>
            }
            inputs={
                <>
                    <Heading>Your parts</Heading>
                    <div className="mb-3 flex flex-col gap-3">
                        {rows.map((row) => (
                            <div
                                key={row.id}
                                className="bg-surface-2 rounded-lg p-3"
                                data-testid={`st-row-${row.id}`}
                            >
                                <div className="mb-2 flex items-center gap-2">
                                    <input
                                        value={row.label}
                                        onChange={(e) => update(row.id, { label: e.target.value })}
                                        type="text"
                                        aria-label="Part name"
                                        className="border-fg/12 bg-surface-0 text-fg-strong focus:border-accent h-11 w-full rounded-md border px-3 text-sm focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        className="border-fg/12 text-muted hover:border-danger/60 hover:text-danger-fg h-11 w-11 flex-none rounded-md border"
                                        aria-label={`Remove ${row.label}`}
                                        onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="grid gap-2.5 sm:grid-cols-3">
                                    <MeasureField
                                        value={row.length}
                                        onChange={(v) => update(row.id, { length: v })}
                                        label="Length"
                                        testid={`st-len-${row.id}`}
                                    />
                                    {mode === 'sheet' && (
                                        <MeasureField
                                            value={row.width}
                                            onChange={(v) => update(row.id, { width: v })}
                                            label="Width"
                                            testid={`st-wid-${row.id}`}
                                        />
                                    )}
                                    <NumberField
                                        value={row.qty}
                                        onChange={(v) => update(row.id, { qty: v })}
                                        label="Qty"
                                        testid={`st-qty-${row.id}`}
                                        min={0}
                                    />
                                </div>
                                {mode === 'sheet' && (
                                    <label className="text-muted mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
                                        <input
                                            type="checkbox"
                                            checked={row.grainLocked}
                                            onChange={(e) =>
                                                update(row.id, { grainLocked: e.target.checked })
                                            }
                                            className="accent-accent h-5 w-5"
                                        />
                                        <span>Grain runs along the length — do not rotate</span>
                                    </label>
                                )}
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        data-testid="st-add"
                        className="border-fg/12 text-accent hover:bg-surface-2 mb-4 h-11 w-full rounded-md border text-sm"
                        onClick={() => setRows((rs) => [...rs, blankRow('Part', 24, 3, 1)])}
                    >
                        Add a part
                    </button>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        {mode === 'lumber' ? (
                            <MeasureField
                                value={stockLength}
                                onChange={setStockLength}
                                label="Stock length"
                                testid="st-stock"
                                min={1}
                            />
                        ) : (
                            <>
                                <MeasureField
                                    value={sheetLength}
                                    onChange={setSheetLength}
                                    label="Sheet length"
                                    testid="st-sheet-l"
                                />
                                <MeasureField
                                    value={sheetWidth}
                                    onChange={setSheetWidth}
                                    label="Sheet width"
                                    testid="st-sheet-w"
                                />
                            </>
                        )}
                        <MeasureField
                            value={kerf}
                            onChange={setKerf}
                            label="Kerf"
                            testid="st-kerf"
                            min={0}
                            hint="saw blade width"
                        />
                        <NumberField
                            value={price}
                            onChange={setPrice}
                            label={mode === 'lumber' ? 'Price per stick' : 'Price per sheet'}
                            testid="st-price"
                            min={0}
                            steppers={false}
                            hint="optional"
                        />
                    </div>
                </>
            }
            results={
                <>
                    <Heading>What you need</Heading>
                    <ResultGrid tiles={tiles} testid="st-results" />
                    {excluded.length > 0 && (
                        <div
                            className="border-warn/40 bg-warn/10 mt-3.5 rounded-lg border p-3"
                            data-testid="st-excluded"
                        >
                            <p className="text-warn-fg mb-1 text-[13px] font-semibold">
                                {excluded.length === 1
                                    ? 'One part will not fit'
                                    : `${excluded.length} parts will not fit`}
                            </p>
                            <p className="text-muted text-xs leading-relaxed">
                                {excluded.join(', ')} —{' '}
                                {mode === 'lumber'
                                    ? 'longer than the stock, so not counted above. Buy longer stock or split the part.'
                                    : 'bigger than a sheet in any allowed orientation, so not counted above.'}
                            </p>
                        </div>
                    )}
                    <Footnote>
                        The kerf is counted between every cut, which is why two 48in pieces do not come out of
                        one 96in board.
                    </Footnote>
                </>
            }
        />
    );
}
