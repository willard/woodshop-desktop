import { describe, it, expect } from 'vitest';
import { overlappingParts, notchForOverlap } from '@/engine/notch';
import { makePart } from '@/engine/commands';
import { parseSpec } from '@/spec';
import type { Part, Spec } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const C = 0.0625; // clearance used throughout

function part(id: string, l: number, w: number, pos: number[], rot: number[] = [0, 0, 0]): Part {
    return {
        ...makePart({ id, name: id, materialId: 'mat_x', size: { l, w } }),
        transform: { pos: [pos[0], pos[1], pos[2]], rot: [rot[0], rot[1], rot[2]] },
    };
}

describe('notchForOverlap', () => {
    it('notches a shelf corner around a leg (axis-aligned, with clearance)', () => {
        // Shelf 24×12×0.75 lying flat is not needed — work in the host's local frame:
        // host unrotated, insert a 1.5×1.5 leg column overlapping the host's low-x/low-y
        // corner by 1.5 in x and 1.0 in y.
        const host = part('p_shelf', 24, 12, [0, 0, 0]);
        // Leg: l=1.5, w=1.5 (thickness 1.5 too), centred so it overlaps x ∈ [−12, −10.5],
        // y ∈ [−6, −5]. Its centre: x = −12 + 1.5 − 0.75 = −11.25, y = −6 + 1 − 0.75 = −5.75.
        const leg = part('p_leg', 1.5, 1.5, [-11.25, -5.75, 0]);

        const op = notchForOverlap(host, 0.75, leg, 1.5, C);
        expect(op).not.toBeNull();
        // The rect touches w0 (x0 = 0) with penetration 1.5 and l0 (y0 = 0) with
        // penetration 1.0 — the SHALLOWER touched edge (l0) is the bite.
        expect(op!.edge).toBe('l0');
        expect(op!.from).toBe(0); // clearance can't go below the corner
        expect(op!.to).toBeCloseTo(1.5 + C, 6);
        expect(op!.depth).toBeCloseTo(1.0 + C, 6);
    });

    it('produces the same op when host and insert are 90°-rotated (record-stand pairing)', () => {
        // Host lying flat via rot [90,0,0]; insert a vertical column crossing its w1 edge.
        const host = part('p_shelf', 24, 12, [0, 10, 0], [90, 0, 0]);
        // World: host local x → world x, local y → world −z... use an insert overlapping
        // the host's +x end (local w1 edge): a 2×2 column at world x = 12 − 0.5.
        const post = part('p_post', 20, 2, [11.5 + 1 - 0, 10, 0], [0, 0, 90]);
        const op = notchForOverlap(host, 0.75, post, 2, C);
        expect(op).not.toBeNull();
        expect(op!.edge).toBe('w1');
        // Overlap in world x: host reaches 12, post spans [12.5 − 1, 12.5 + 1] → [11.5, 12]
        // → penetration 0.5 into w1.
        expect(op!.depth).toBeCloseTo(0.5 + C, 6);
    });

    it('handles a mid-edge overlap (leg against the middle of an edge)', () => {
        const host = part('p_shelf', 24, 12, [0, 0, 0]);
        // 1.5-wide column overlapping only the l1 edge (y max), centred at x = 2.
        const leg = part('p_leg', 1.5, 1.5, [2, 6 + 0.75 - 1, 0]); // overlaps y ∈ [5, 6]
        const op = notchForOverlap(host, 0.75, leg, 1.5, C);
        expect(op).not.toBeNull();
        expect(op!.edge).toBe('l1');
        expect(op!.from).toBeCloseTo(12 + 2 - 0.75 - C, 6);
        expect(op!.to).toBeCloseTo(12 + 2 + 0.75 + C, 6);
        expect(op!.depth).toBeCloseTo(1 + C, 6);
    });

    it('returns null for an interior overlap (a mortise, not a notch)', () => {
        const host = part('p_shelf', 24, 12, [0, 0, 0]);
        const peg = part('p_peg', 1, 1, [0, 0, 0]); // dead centre, touches no edge
        expect(notchForOverlap(host, 0.75, peg, 1, C)).toBeNull();
    });

    it('returns null when the insert passes clear through the host', () => {
        const host = part('p_rail', 24, 3.5, [0, 0, 0]);
        // A wide slab overlapping the rail's entire width (both l-edges).
        const slab = part('p_slab', 6, 10, [0, 0, 0]);
        expect(notchForOverlap(host, 1.5, slab, 0.75, C)).toBeNull();
    });

    it('nulls when clearance pushes depth to consume the span', () => {
        const host = part('p_rail', 24, 1.5, [0, 0, 0]);
        // Block bites 1.45" into the 1.5" width from l0 — legal alone, but +1/16 clearance
        // would sever the rail.
        const block = part('p_block', 2, 2, [0, -0.3, 0]);
        expect(notchForOverlap(host, 1.5, block, 1.5, C)).toBeNull();
    });

    it('rounds results to 1/64" for clean fraction display', () => {
        const host = part('p_shelf', 24, 12, [0, 0, 0]);
        const leg = part('p_leg', 1.5, 1.5, [-11.25 + 1e-7, -5.75 - 1e-7, 0]);
        const op = notchForOverlap(host, 0.75, leg, 1.5, C)!;
        for (const v of [op.from, op.to, op.depth]) {
            expect(Math.abs(v * 64 - Math.round(v * 64))).toBeLessThan(1e-9);
        }
    });
});

describe('overlappingParts', () => {
    it('finds the record-stand shelf interpenetrating both sides (and only those)', () => {
        const spec = parseSpec(recordStand) as Spec;
        const hits = overlappingParts(spec, 'p_shelf_1');
        expect(hits.map((h) => h.part.id).sort()).toEqual(['p_side_l', 'p_side_r']);
    });

    it('excludes parts that merely touch', () => {
        const spec = parseSpec(recordStand) as Spec;
        // The top sits ON the sides (face contact) — from the top's perspective nothing
        // interpenetrates beyond tolerance except the sides' dado seats.
        const hits = overlappingParts(spec, 'p_back');
        expect(hits.some((h) => h.part.id === 'p_shelf_1')).toBe(false);
    });

    it('computes the shelf-into-side notch for the fixture pairing', () => {
        const spec = parseSpec(recordStand) as Spec;
        const host = spec.parts.find((p) => p.id === 'p_shelf_1')!;
        const side = spec.parts.find((p) => p.id === 'p_side_l')!;
        const op = notchForOverlap(host, 0.709, side, 0.709, C)!;
        expect(op).not.toBeNull();
        // Side panel eats 0.25" of the shelf's low-x (w0) end across its full width.
        expect(op.edge).toBe('w0');
        expect(op.from).toBe(0);
        expect(op.to).toBeCloseTo(18, 3); // full edge — clearance clamps at the chord
        expect(op.depth).toBeCloseTo(0.25 + C, 3);
    });
});
