/**
 * Print part labels: a picture of the label sheet where the user clicks the first free label, so
 * a partly used sheet isn't wasted. Letter sheets hold 30 (Avery 5160); A4 sheets, used in
 * millimetres, hold 21 (Avery L7160).
 */
import { useState } from 'react';
import { getUnits } from '@/lib/display';
import { Modal } from './Modal';

export function LabelsDialog({
    pieces,
    onPrint,
    onClose,
}: {
    /** How many labels the design needs. */
    pieces: number;
    /** `skip`: how many labels on the first sheet are already used. */
    onPrint: (skip: number) => void;
    onClose: () => void;
}) {
    const metric = getUnits() === 'metric';
    const rows = metric ? 7 : 10;
    const perSheet = rows * 3;
    const [start, setStart] = useState(0);
    const sheets = Math.ceil((start + pieces) / perSheet);

    return (
        <Modal onClose={onClose} testId="labels-dialog">
            <h2 className="mb-1 text-[15px] font-semibold">Print part labels</h2>
            <p className="text-muted mb-3 text-[13px]">
                One label per piece, in cutting order, on {metric ? 'A4' : 'US Letter'} label sheets with{' '}
                {perSheet} labels ({metric ? 'Avery L7160' : 'Avery 5160'} or the same layout). Using a sheet
                you&apos;ve started? Click the first free label.
            </p>
            <div
                className="border-fg/10 bg-surface-2 mx-auto mb-3 grid w-40 grid-cols-3 gap-1 rounded-md border p-2"
                role="radiogroup"
                aria-label="First label to print on"
            >
                {Array.from({ length: perSheet }, (_, i) => (
                    <button
                        key={i}
                        role="radio"
                        aria-checked={i === start}
                        aria-label={`Label ${i + 1}`}
                        data-testid="labels-start"
                        className={`rounded-[3px] ${metric ? 'h-5' : 'h-3.5'} ${
                            i < start
                                ? 'bg-fg/[0.06]'
                                : i === start
                                  ? 'bg-accent'
                                  : i < start + pieces
                                    ? 'bg-accent/30'
                                    : 'bg-surface-1 border-fg/10 border'
                        }`}
                        onClick={() => setStart(i)}
                    />
                ))}
            </div>
            <p className="text-muted mb-4 text-center text-xs" data-testid="labels-summary">
                {pieces} {pieces === 1 ? 'label' : 'labels'}, starting at label {start + 1}: {sheets}{' '}
                {sheets === 1 ? 'sheet' : 'sheets'}
            </p>
            <div className="flex justify-end gap-2">
                <button className="hover:bg-fg/[0.07] rounded-lg px-3 py-1.5 text-sm" onClick={onClose}>
                    Cancel
                </button>
                <button
                    className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-1.5 text-sm font-semibold"
                    data-testid="labels-print"
                    onClick={() => onPrint(start)}
                >
                    Save PDF…
                </button>
            </div>
        </Modal>
    );
}
