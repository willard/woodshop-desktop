import { afterEach, describe, expect, it } from 'vitest';
import { computeCutList } from '@/cutlist';
import { parseSheetTrim, setSheetTrim } from '@/cutlist/trim';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

describe('sheet edge trim', () => {
    const spec = parseSpec(recordStand);
    afterEach(() => setSheetTrim(0));

    it('cuts every part inside the trimmed edges, with the setting as the default', () => {
        setSheetTrim(0.25);
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

    it('reads only a trim of zero or more from the setting', () => {
        expect(parseSheetTrim(0.375)).toBe(0.375);
        expect(parseSheetTrim(-1)).toBe(0);
        expect(parseSheetTrim('1/4')).toBe(0);
        expect(parseSheetTrim(undefined)).toBe(0);
    });
});
