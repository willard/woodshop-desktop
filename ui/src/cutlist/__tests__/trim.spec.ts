import { afterEach, describe, expect, it } from 'vitest';
import { computeCutList } from '@/cutlist';
import { parseTrim, setTrim } from '@/cutlist/trim';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import kitchenCart from '../../../../resources/templates/kitchen-cart.json';

describe('trimming stock', () => {
    const spec = parseSpec(recordStand);
    afterEach(() => {
        setTrim('sheetTrim', 0);
        setTrim('boardTrim', 0);
    });

    it('cuts every part inside the trimmed edges, with the setting as the default', () => {
        setTrim('sheetTrim', 0.25);
        const plan = computeCutList(spec, { kerf: 0.125, offcuts: [] }).sheets[0];
        expect(plan.trim).toBe(0.25);
        for (const p of plan.placements) {
            expect(p.x).toBeGreaterThanOrEqual(0.25);
            expect(p.y).toBeGreaterThanOrEqual(0.25);
            expect(p.x + p.w).toBeLessThanOrEqual(plan.sheetSize.l - 0.25);
            expect(p.y + p.h).toBeLessThanOrEqual(plan.sheetSize.w - 0.25);
        }
        // Asked for none, there is none.
        expect(
            computeCutList(spec, { kerf: 0.125, offcuts: [], sheetTrim: 0 }).sheets[0].trim,
        ).toBeUndefined();
    });

    it('cuts boards between their trimmed ends', () => {
        setTrim('boardTrim', 1);
        const lumber = computeCutList(parseSpec(kitchenCart), { kerf: 0.125, offcuts: [] }).lumber;
        const board = lumber.find((p) => p.trim === 1)!;
        for (const c of board.cuts.filter((c) => c.stick < board.stickCount)) {
            expect(c.x).toBeGreaterThanOrEqual(1);
        }
        expect(board.sawCuts![0].x).toBeGreaterThan(1);
    });

    it('reads only a trim of zero or more from the setting', () => {
        expect(parseTrim(0.375)).toBe(0.375);
        expect(parseTrim(-1)).toBe(0);
        expect(parseTrim('1/4')).toBe(0);
        expect(parseTrim(undefined)).toBe(0);
    });
});
