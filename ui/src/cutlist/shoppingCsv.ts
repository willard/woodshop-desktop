/**
 * A shopping list as a spreadsheet: what to buy, how many, its size and cost, with the designs it
 * covers on top, the finish for a coat, and a total underneath.
 */
import { finishArea, len } from '@/lib/display';
import { boardSizes } from './boards';
import { row } from './csv';
import { clearFinishLabel, coatingLabel, type ShoppingList } from './types';
import type { Tool } from './index';

const cash = (n: number | null | undefined): string => (n == null ? '' : n.toFixed(2));

/** What is still to get: `list` is made without what the designs have, and `tools` the ones to get. */
export function shoppingCsv(list: ShoppingList, designs: string[], tools: readonly Tool[] = []): string {
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
    for (const c of list.totals.coatings ?? []) {
        lines.push(row([coatingLabel(c), '', finishArea(c.area), '']));
    }
    if (list.totals.finishArea > 0) {
        lines.push(row([clearFinishLabel(list.totals), '', finishArea(list.totals.finishArea), '']));
    }
    for (const t of tools) {
        lines.push(row([t.required ? t.name : `${t.name} (nice to have)`, '', t.detail ?? '', '']));
    }
    if (list.totals.estimatedCost != null) {
        lines.push(row(['Total', '', '', cash(list.totals.estimatedCost)]));
    }
    // A byte-order mark, so Excel reads the inch and × signs as UTF-8.
    return `\ufeff${lines.join('\r\n')}\r\n`;
}
