import { describe, expect, it } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { SpliceOps } from '@/engine/commands';
import {
    defaultShelfPins,
    planShelfPins,
    readShelfPins,
    shelfPinFacingIn,
    shelfPinProblem,
    shelfPinRuns,
    type ShelfPinOptions,
} from '@/engine/shelfPins';
import { parseSpec, type Op, type Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const spec = () => parseSpec(recordStand) as Spec;
const part = (s: Spec, id: string) => s.parts.find((p) => p.id === id)!;
type Hole = Extract<Op, { type: 'hole' }>;

const opts = (o: Partial<ShelfPinOptions> = {}): ShelfPinOptions => ({
    face: 'front',
    axis: 'w',
    inset: 1.5,
    from: 6,
    to: 12,
    spacing: 2,
    diameter: 0.25,
    depth: 0.375,
    ...o,
});

describe('shelf-pin holes', () => {
    it('make two columns, each the inset from an edge, from the first hole to the last that fits', () => {
        const side = part(spec(), 'p_side_l'); // l 19 deep, w 34 tall
        const holes = planShelfPins(side, opts({ to: 11.9 }));
        expect(holes).toHaveLength(6); // 6, 8, 10 in each column
        expect(holes.every((h) => h.purpose === 'shelfPin' && h.face === 'front')).toBe(true);
        expect([...new Set(holes.map((h) => h.x))]).toEqual([1.5, 17.5]);
        expect([...new Set(holes.map((h) => h.y))]).toEqual([6, 8, 10]);
    });

    it('run along the length when asked', () => {
        const side = part(spec(), 'p_side_l');
        const holes = planShelfPins(side, opts({ axis: 'l', from: 2, to: 4, spacing: 1 }));
        expect([...new Set(holes.map((h) => h.y))]).toEqual([1.5, 32.5]);
        expect([...new Set(holes.map((h) => h.x))]).toEqual([2, 3, 4]);
    });

    it('fall back to one centred column on a part too narrow for two', () => {
        const side = { ...part(spec(), 'p_side_l'), size: { l: 2, w: 34 } };
        expect(new Set(planShelfPins(side, opts()).map((h) => h.x))).toEqual(new Set([1]));
    });

    it('explain what is wrong with a run that does not fit', () => {
        const side = part(spec(), 'p_side_l');
        expect(shelfPinProblem(side, 0.709, opts())).toBeNull();
        expect(shelfPinProblem(side, 0.709, opts({ to: 40 }))).toMatch(/off the end/);
        expect(shelfPinProblem(side, 0.709, opts({ inset: 25 }))).toMatch(/off the edge/);
        expect(shelfPinProblem(side, 0.709, opts({ depth: 0.75 }))).toMatch(/right through/);
        expect(shelfPinProblem(side, 0.709, opts({ from: 12, to: 6 }))).toMatch(/before/);
        const dense = opts({ from: 0.2, to: 33.8, spacing: 0.5 }); // 68 a column
        expect(shelfPinProblem(side, 0.709, dense)).toMatch(/at most 100/);
        // 50 a column is 100 holes; with the side's dado that is one over, unless it replaces a cut.
        const full = opts({ from: 0.2, to: 33.8, spacing: 0.68 });
        expect(planShelfPins(side, full)).toHaveLength(100);
        expect(shelfPinProblem(side, 0.709, full)).toMatch(/at most 100/);
        expect(shelfPinProblem(side, 0.709, full, 1)).toBeNull();
    });

    it('default to the 32 mm system, centred up the part with a tidy first hole', () => {
        const side = part(spec(), 'p_side_l');
        const o = defaultShelfPins(side, 0.709, { axis: 'w' });
        expect(o.spacing).toBeCloseTo(32 / 25.4);
        expect(o.inset).toBeCloseTo(37 / 25.4);
        expect((o.from * 16) % 1).toBeCloseTo(0);
        expect(o.to).toBeCloseTo(34 - o.from);
        expect(o.depth).toBeLessThan(0.709);
        expect(shelfPinProblem(side, 0.709, o)).toBeNull();
    });

    it('drill a case side on the face looking in, up its height', () => {
        const s = spec();
        expect(shelfPinFacingIn(s, part(s, 'p_side_l'))).toEqual({ face: 'front', axis: 'w' });
        expect(shelfPinFacingIn(s, part(s, 'p_side_r'))).toEqual({ face: 'front', axis: 'w' });
        const flipped = { ...part(s, 'p_side_l'), transform: { pos: [-18.6455, 17, 0], rot: [0, -90, 0] } };
        expect(shelfPinFacingIn(s, flipped).face).toBe('back');
    });

    it('are found as runs among the other cuts, and read back into the options that made them', () => {
        const side = part(spec(), 'p_side_l');
        const o = opts();
        const holes = planShelfPins(side, o);
        const other: Op = { type: 'hole', face: 'front', x: 1, y: 1, diameter: 0.375, purpose: 'dowel' };
        const ops = [other, ...holes, other];
        expect(shelfPinRuns(ops)).toEqual([{ start: 1, count: holes.length }]);
        // Two stray pins are just holes.
        expect(shelfPinRuns([holes[0], holes[1]])).toEqual([]);
        expect(readShelfPins(side, holes as Hole[])).toEqual(o);
    });
});

describe('SpliceOps', () => {
    it('adds, changes and removes a run in one undo step each, keeping joints on their cuts', () => {
        const d = new EditorDocument(spec());
        const side = part(d.spec, 'p_side_l');
        const before = side.ops.length;
        const holes = planShelfPins(side, opts());
        d.execute(new SpliceOps('p_side_l', 0, 0, holes, 'Add shelf-pin holes'));
        expect(part(d.spec, 'p_side_l').ops).toHaveLength(before + holes.length);
        // The dado joint followed its op to the end of the list.
        const j0 = d.spec.joints.find((j) => j.id === 'j0')!;
        expect(j0.opRef).toBe(holes.length);
        expect(part(d.spec, 'p_side_l').ops[j0.opRef!].type).toBe('dado');

        const fewer = planShelfPins(side, opts({ to: 8 }));
        d.execute(new SpliceOps('p_side_l', 0, holes.length, fewer, 'Change shelf-pin holes'));
        expect(d.spec.joints.find((j) => j.id === 'j0')!.opRef).toBe(fewer.length);

        d.undo();
        d.undo();
        expect(part(d.spec, 'p_side_l').ops).toEqual(side.ops);
        expect(d.spec.joints.find((j) => j.id === 'j0')!.opRef).toBe(0);
    });

    it('drops a joint whose cut it removes', () => {
        const d = new EditorDocument(spec());
        d.execute(new SpliceOps('p_side_l', 0, 1, [], 'Remove'));
        expect(d.spec.joints.some((j) => j.id === 'j0')).toBe(false);
        d.undo();
        expect(d.spec.joints.some((j) => j.id === 'j0')).toBe(true);
    });
});
