import { describe, it, expect } from 'vitest';
import { shoppingList } from '@/cutlist';
import { shoppingCsv } from '@/cutlist/shoppingCsv';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

describe('shoppingCsv', () => {
    const spec = parseSpec(recordStand);
    const list = shoppingList([spec, spec], { kerf: 0.125, hardwarePrices: {} });
    const lines = shoppingCsv(list, ['Record stand', 'Record stand, again']).split('\r\n');

    it('names the designs, then lists sheets, boards and hardware', () => {
        expect(lines[0]).toBe('﻿Shopping list for,"Record stand; Record stand, again"');
        expect(lines[2]).toBe('Item,Qty,Size,Cost');
        const items = lines.slice(3).filter((l) => l !== '');
        expect(items).toHaveLength(list.sheets.length + list.lumber.length + list.hardware.length + 2);
        // Inch marks are quoted the CSV way.
        expect(items[0]).toBe('Baltic Birch 18mm,5,"60"" × 60""",475.00');
    });

    it('adds the hardware up across the designs', () => {
        const once = shoppingList([spec], { kerf: 0.125, hardwarePrices: {} });
        for (const [i, h] of list.hardware.entries()) {
            expect(h.qty).toBe(2 * once.hardware[i].qty);
        }
    });

    it('says how much finish a coat of both designs takes', () => {
        expect(list.totals.finishArea).toBeCloseTo(2 * 67.856, 2);
        expect(lines.at(-3)).toBe('Finish,,"136 sq ft, about 1.4 qt a coat",');
    });

    it('ends with the total when anything is priced', () => {
        expect(lines.at(-2)).toBe(`Total,,,${list.totals.estimatedCost!.toFixed(2)}`);
    });
});
