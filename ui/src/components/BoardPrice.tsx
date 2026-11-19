/**
 * The price of a lumber or round material, per board foot or per board. A home centre prices a
 * 2x4 by the board and a hardwood dealer by the board foot; either is typed here and kept as the
 * material's price per board foot, worked out from the shortest board it is sold in.
 */
import { useState } from 'react';
import type { Material } from '@/spec';
import { DEFAULT_STOCK_LENGTH, oneBoard, perBoardFoot } from '@/cutlist/boardfeet';
import { len } from '@/lib/display';

type Per = 'boardFoot' | 'board';

const cents = (n: number): string => String(Math.round(n * 100) / 100);

/** "96" or 120" boards, 3 1/2" wide", "36" dowels": what the material is sold as. */
export function stockLabel(material: Material): string {
    const lengths = [
        ...(material.stockLengths?.length ? material.stockLengths : [DEFAULT_STOCK_LENGTH]),
    ].sort((a, b) => a - b);
    const kind = material.type === 'round' ? 'dowels' : 'boards';
    const sold = `${lengths.map((l) => len(l)).join(' or ')} ${kind}`;
    return material.type === 'lumber' && material.stockWidth !== undefined
        ? `${sold}, ${len(material.stockWidth)} wide`
        : sold;
}

export function BoardPrice({
    material,
    readonly,
    onCommit,
}: {
    material: Material;
    readonly: boolean;
    /** The new price per board foot. */
    onCommit: (costPerBoardFoot: number) => void;
}) {
    const board = oneBoard(material);
    // A dowel is bought by the stick; lumber is priced either way, by the board foot first.
    const [per, setPer] = useState<Per>(board !== null && material.type === 'round' ? 'board' : 'boardFoot');
    const unit = board !== null && per === 'board' ? board : null;
    const price = material.costPerBoardFoot;
    const shown = price === undefined ? '' : cents(unit === null ? price : price * unit.boardFeet);
    const word = material.type === 'round' ? 'dowel' : 'board';
    return (
        <div className="flex items-center gap-2">
            <span className="text-muted text-xs">Price</span>
            {readonly ? (
                price !== undefined && (
                    <span className="text-muted ml-auto flex-none text-xs" data-testid="material-price-text">
                        ${cents(price)}/bd ft
                    </span>
                )
            ) : (
                <>
                    <span className="text-muted ml-auto">$</span>
                    <input
                        key={`${per}:${shown}`}
                        defaultValue={shown}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="cost"
                        aria-label={
                            unit === null
                                ? `Price per board foot of ${material.name}`
                                : `Price per ${len(unit.length)} ${word} of ${material.name}`
                        }
                        data-testid="material-price"
                        className="bg-surface-1 focus:border-accent border-fg/10 h-7 w-16 flex-none rounded-lg border px-1 text-center text-xs focus:outline-none"
                        onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (e.target.value === '' || !Number.isFinite(v) || v < 0) return;
                            const next = unit === null ? v : perBoardFoot(v, unit);
                            if (next !== price) onCommit(next);
                        }}
                    />
                    {board === null ? (
                        <span className="text-muted flex-none text-xs">/bd ft</span>
                    ) : (
                        <select
                            value={per}
                            aria-label={`Price ${material.name} by`}
                            data-testid="material-price-per"
                            className="bg-surface-2 border-fg/10 h-7 flex-none rounded-lg border px-1 text-xs"
                            onChange={(e) => setPer(e.target.value as Per)}
                        >
                            <option value="boardFoot">/bd ft</option>
                            <option value="board">
                                /{len(board.length)} {word}
                            </option>
                        </select>
                    )}
                </>
            )}
        </div>
    );
}
