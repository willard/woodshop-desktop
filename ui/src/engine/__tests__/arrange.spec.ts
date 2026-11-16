import { describe, expect, it } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { CopyPart, SetPositions, copyNames, copyStep, evenPositions, extentAlong } from '@/engine/commands';
import { parseSpec, type Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const spec = () => parseSpec(recordStand) as Spec;
const part = (s: Spec, id: string) => s.parts.find((p) => p.id === id)!;

describe('copies', () => {
    it('name a run on from the original', () => {
        expect(copyNames('Slat', 3)).toEqual(['Slat 2', 'Slat 3', 'Slat 4']);
        expect(copyNames('Slat 4', 2)).toEqual(['Slat 5', 'Slat 6']);
    });

    it("step by the part's own extent plus the gap", () => {
        const s = spec();
        const shelf = part(s, 'p_shelf_1');
        const { min, max } = extentAlong(s, shelf, 1);
        expect(copyStep(s, shelf, 1, 2)).toEqual([0, max - min + 2, 0]);
    });

    it('are made in one undo step, each a step on from the last', () => {
        const d = new EditorDocument(spec());
        const shelf = part(d.spec, 'p_shelf_1');
        const step = copyStep(d.spec, shelf, 1, 3);
        d.execute(new CopyPart('p_shelf_1', ['c1', 'c2'], step));
        expect(part(d.spec, 'c1').transform.pos[1]).toBeCloseTo(shelf.transform.pos[1] + step[1]);
        expect(part(d.spec, 'c2').transform.pos[1]).toBeCloseTo(shelf.transform.pos[1] + 2 * step[1]);
        expect(part(d.spec, 'c2').name).toBe('Middle Shelf 3');
        d.undo();
        expect(d.spec.parts.some((p) => p.id === 'c1' || p.id === 'c2')).toBe(false);
    });
});

describe('spacing evenly', () => {
    it('keeps the outer parts and leaves equal gaps between all of them', () => {
        const d = new EditorDocument(spec());
        const shelf = part(d.spec, 'p_shelf_1');
        // Three shelves bunched near the bottom shelf, plus the top and bottom as the ends.
        d.execute(new CopyPart('p_shelf_1', ['s2', 's3'], copyStep(d.spec, shelf, 1, 0.5)));
        const ids = ['p_bottom', 'p_shelf_1', 's2', 's3', 'p_top'];
        const moves = evenPositions(
            d.spec,
            ids.map((id) => part(d.spec, id)),
            1,
        );
        expect([...moves.keys()].sort()).toEqual(['p_shelf_1', 's2', 's3']);
        d.execute(new SetPositions(moves));

        const spans = ids.map((id) => extentAlong(d.spec, part(d.spec, id), 1)).sort((a, b) => a.min - b.min);
        const gaps = spans.slice(1).map((s, i) => s.min - spans[i].max);
        for (const g of gaps) expect(g).toBeCloseTo(gaps[0]);
        expect(gaps[0]).toBeGreaterThan(0);

        d.undo();
        expect(part(d.spec, 's2').transform.pos).toEqual(
            part(spec(), 'p_shelf_1').transform.pos.map((v, a) => v + copyStep(spec(), shelf, 1, 0.5)[a]),
        );
    });

    it('has nothing to do for fewer than three parts', () => {
        const s = spec();
        expect(evenPositions(s, [part(s, 'p_top'), part(s, 'p_bottom')], 1).size).toBe(0);
    });
});
