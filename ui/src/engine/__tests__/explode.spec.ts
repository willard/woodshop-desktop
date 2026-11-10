import { describe, it, expect } from 'vitest';
import { explodedPositions, EXPLODE_SPREAD } from '@/engine/explode';
import type { Vec3 } from '@/engine';

const at = (x: number, y: number, z: number): Vec3 => [x, y, z];

describe('explodedPositions', () => {
    it('returns authored positions at factor 0', () => {
        const out = explodedPositions(
            [
                { id: 'a', pos: at(0, 0, 0) },
                { id: 'b', pos: at(10, 4, -6) },
            ],
            0,
        );
        expect(out.get('a')).toEqual([0, 0, 0]);
        expect(out.get('b')).toEqual([10, 4, -6]);
    });

    it('pushes parts radially away from the assembly centre', () => {
        // Centres at x = 0 and x = 10 → assembly centre x = 5.
        const out = explodedPositions(
            [
                { id: 'left', pos: at(0, 2, 0) },
                { id: 'right', pos: at(10, 2, 0) },
            ],
            1,
        );
        const spread = 5 * (1 + EXPLODE_SPREAD);
        expect(out.get('left')).toEqual([5 - spread, 2, 0]);
        expect(out.get('right')).toEqual([5 + spread, 2, 0]);
    });

    it('scales separation linearly with the factor', () => {
        const parts = [
            { id: 'a', pos: at(-4, 0, 0) },
            { id: 'b', pos: at(4, 0, 0) },
        ];
        const half = explodedPositions(parts, 0.5);
        const full = explodedPositions(parts, 1);
        const gapAt = (m: Map<string, Vec3>) => m.get('b')![0] - m.get('a')![0];
        expect(gapAt(half)).toBeCloseTo(8 * (1 + 0.5 * EXPLODE_SPREAD));
        expect(gapAt(full)).toBeCloseTo(8 * (1 + EXPLODE_SPREAD));
    });

    it('leaves a part at the assembly centre in place', () => {
        const out = explodedPositions(
            [
                { id: 'mid', pos: at(0, 5, 0) },
                { id: 'lo', pos: at(0, 0, 0) },
                { id: 'hi', pos: at(0, 10, 0) },
            ],
            1,
        );
        expect(out.get('mid')).toEqual([0, 5, 0]);
    });

    it('never pulls parts inward for negative factors and handles empty input', () => {
        const parts = [
            { id: 'a', pos: at(-2, 0, 0) },
            { id: 'b', pos: at(2, 0, 0) },
        ];
        const out = explodedPositions(parts, -3);
        expect(out.get('a')).toEqual([-2, 0, 0]);
        expect(out.get('b')).toEqual([2, 0, 0]);
        expect(explodedPositions([], 1).size).toBe(0);
    });

    it('is a single-part no-op', () => {
        const out = explodedPositions([{ id: 'only', pos: at(3, 4, 5) }], 1);
        expect(out.get('only')).toEqual([3, 4, 5]);
    });
});
