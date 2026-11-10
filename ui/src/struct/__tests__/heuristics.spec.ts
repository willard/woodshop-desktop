import { describe, it, expect } from 'vitest';
import { assessSturdiness } from '@/struct';
import { makeSpec, sidePanel, type PartDef } from './helpers';

const codes = (spec: ReturnType<typeof makeSpec>) => assessSturdiness(spec).issues.map((i) => i.code);

describe('assessSturdiness — tipping', () => {
    it('warns on a tall assembly with a narrow footprint', () => {
        const spec = makeSpec([
            { id: 'p_a', size: { l: 24, w: 72 }, pos: [0, 36, 0] },
            { id: 'p_b', size: { l: 24, w: 72 }, pos: [0, 36, 0.75] },
        ]);
        expect(codes(spec)).toEqual(['struct.tipping']);
        expect(assessSturdiness(spec).issues[0].message).toContain('anchoring');
    });

    it('stays quiet on a low, wide assembly', () => {
        const spec = makeSpec([
            { id: 'p_a', size: { l: 24, w: 24 }, pos: [0, 0.375, 0], rot: [90, 0, 0] },
            { id: 'p_b', size: { l: 24, w: 24 }, pos: [0, 1.125, 0], rot: [90, 0, 0] },
        ]);
        expect(codes(spec)).toEqual([]);
    });

    it('never fires for a single part', () => {
        const spec = makeSpec([{ id: 'p_a', size: { l: 24, w: 72 }, pos: [0, 36, 0] }]);
        expect(codes(spec)).toEqual([]);
    });
});

describe('assessSturdiness — slenderness', () => {
    it('warns on a long thin vertical stick', () => {
        const spec = makeSpec([{ id: 'p_leg', size: { l: 30, w: 0.75 }, pos: [0, 15, 0], rot: [0, 0, 90] }]);
        expect(codes(spec)).toEqual(['struct.slender']);
        expect(assessSturdiness(spec).issues[0].partId).toBe('p_leg');
    });

    it('does not treat a wide vertical panel as a stick', () => {
        const spec = makeSpec([sidePanel('p_side', 0, { depth: 11.25, height: 72 })]);
        expect(codes(spec)).toEqual([]);
    });

    it('ignores horizontal rails — they are not columns', () => {
        const spec = makeSpec([{ id: 'p_rail', size: { l: 30, w: 0.75 }, pos: [0, 15, 0] }]);
        expect(codes(spec)).toEqual([]);
    });
});

describe('assessSturdiness — racking', () => {
    // 1.5"-square stock so the legs stay under the slenderness gate (30/1.5 = 20 < 25).
    const stock = [{ id: 'mat_stock', type: 'lumber' as const, thickness: 1.5 }];
    // Four 1.5" square legs, 30" tall, at the corners of a 20×10 footprint.
    const legs = (length = 30): PartDef[] =>
        [
            [-10, -5],
            [10, -5],
            [-10, 5],
            [10, 5],
        ].map(([x, z], i) => ({
            id: `p_leg_${i}`,
            size: { l: length, w: 1.5 },
            pos: [x, length / 2, z] as [number, number, number],
            rot: [0, 0, 90] as [number, number, number],
        }));

    // Apron spanning world X (20 of the 21.5" face) at height `y`, in the plane z = `z`.
    const rail = (id: string, y: number, z: number, depth = 3.5): PartDef => ({
        id,
        size: { l: 20, w: depth },
        pos: [0, y, z],
    });

    it('warns on an open butt-joint frame', () => {
        expect(codes(makeSpec(legs(), { materials: stock }))).toEqual(['struct.racking']);
    });

    it('is suppressed by an upper and lower stretcher bracing the same plane', () => {
        const parts = [...legs(), rail('p_rail_top', 28, -5), rail('p_rail_bot', 4, -5)];
        expect(codes(makeSpec(parts, { materials: stock }))).toEqual([]);
    });

    it('still warns when both stretchers sit at the same height', () => {
        const parts = [...legs(), rail('p_rail_front', 28, 5), rail('p_rail_back', 28, -5)];
        expect(codes(makeSpec(parts, { materials: stock }))).toEqual(['struct.racking']);
    });

    it('still warns when the stretchers brace different planes', () => {
        const parts = [...legs(), rail('p_rail_top', 28, 5), rail('p_rail_bot', 4, -5)];
        expect(codes(makeSpec(parts, { materials: stock }))).toEqual(['struct.racking']);
    });

    it('gives no stretcher credit to shallow rails — a shelf edge is not a brace', () => {
        const parts = [...legs(), rail('p_rail_top', 28, -5, 0.75), rail('p_rail_bot', 4, -5, 0.75)];
        expect(codes(makeSpec(parts, { materials: stock }))).toEqual(['struct.racking']);
    });

    it('gives no stretcher credit to a short rail that spans little of the face', () => {
        const short = (id: string, y: number): PartDef => ({ id, size: { l: 8, w: 3.5 }, pos: [0, y, -5] });
        const parts = [...legs(), short('p_rail_top', 28), short('p_rail_bot', 4)];
        expect(codes(makeSpec(parts, { materials: stock }))).toEqual(['struct.racking']);
    });

    it('is suppressed by a back panel covering the largest vertical face', () => {
        const back: PartDef = { id: 'p_back', size: { l: 21, w: 30 }, pos: [0, 15, -6.125] };
        expect(codes(makeSpec([...legs(), back], { materials: stock }))).toEqual([]);
    });

    it('is suppressed by interlocking joinery', () => {
        const spec = makeSpec(legs(), {
            materials: stock,
            joints: [{ type: 'dado', hostPartId: 'p_leg_0', insertPartId: 'p_leg_1' }],
        });
        expect(codes(spec)).toEqual([]);
    });

    it('ignores assemblies shorter than the racking height gate', () => {
        expect(codes(makeSpec(legs(20), { materials: stock }))).toEqual([]);
    });
});
