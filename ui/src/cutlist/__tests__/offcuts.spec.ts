import { describe, it, expect } from 'vitest';
import { computeCutList } from '@/cutlist';
import { isOffcutOf, leftoversOf, parseOffcuts } from '@/cutlist/offcuts';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

describe('pieces on hand', () => {
    const spec = parseSpec(recordStand);
    const cutList = computeCutList(spec, { kerf: 0.125, offcuts: [] });

    it('turns what a design leaves over into pieces of its material, with fresh ids', () => {
        const kept = leftoversOf(spec, cutList);
        const expected = cutList.sheets.reduce((n, p) => n + (p.leftovers ?? []).length, 0);
        expect(kept).toHaveLength(expected);
        expect(new Set(kept.map((o) => o.id)).size).toBe(kept.length);
        for (const piece of kept) {
            expect(isOffcutOf(piece, spec.materials[0])).toBe(true);
            expect(Math.max(piece.l, piece.w!)).toBeGreaterThanOrEqual(12);
            expect(Math.min(piece.l, piece.w!)).toBeGreaterThanOrEqual(6);
        }
        // Kept, they come back from the setting unchanged.
        expect(parseOffcuts(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    });

    it('drops malformed pieces from the setting', () => {
        expect(
            parseOffcuts([
                { id: 'a', material: 'Ply', thickness: 0.75, l: 20, w: 10 },
                { id: 'b', material: 'Ply', thickness: 0.75, l: -1 },
                { id: 'c', material: 'Ply', l: 20 },
                'nonsense',
            ]),
        ).toEqual([{ id: 'a', material: 'Ply', thickness: 0.75, l: 20, w: 10 }]);
        expect(parseOffcuts({})).toEqual([]);
    });
});
