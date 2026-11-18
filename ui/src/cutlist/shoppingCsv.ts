/**
 * A shopping list as a spreadsheet: what to buy, how many, its size and cost, with the designs it
 * covers on top, the finish for a coat, and a total underneath.
 */
import { finishArea, len } from '@/lib/display';
import { boardSizes } from './boards';
import { row } from './csv';
import type { ShoppingList } from './types';

const cash = (n: number | null | undefined): string => (n == null ? '' : n.toFixed(2));

export function shoppingCsv(list: ShoppingList, designs: string[]): string {
    const lines = [row(['Shopping list for', designs.join('; ')]), '', row(['Item', 'Qty', 'Size', 'Cost'])];
    for (const p of list.sheets) {
        lines.push(
            row([
                p.materialName,
                p.sheetCount,
                `${len(p.sheetSize.l)} × ${len(p.sheetSize.w)}`,
                cash(p.cost),
            ]),
        );
    }
    for (const p of list.lumber) {
        lines.push(row([p.materialName, p.stickCount, boardSizes(p, len), cash(p.cost)]));
    }
    for (const h of list.hardware) {
        lines.push(row([h.description, h.qty, '', cash(h.cost)]));
    }
    if (list.totals.finishArea > 0) {
        lines.push(row(['Finish', '', finishArea(list.totals.finishArea), '']));
    }
    if (list.totals.estimatedCost != null) {
        lines.push(row(['Total', '', '', cash(list.totals.estimatedCost)]));
    }
    // A byte-order mark, so Excel reads the inch and × signs as UTF-8.
    return `\ufeff${lines.join('\r\n')}\r\n`;
}
