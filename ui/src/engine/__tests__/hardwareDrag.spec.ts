import { describe, it, expect } from 'vitest';
import { parseSpec } from '@/spec';
import type { HardwareMount, Spec } from '@/spec';
import { mountFrame, sideExtent } from '@/hardware/catalog';
import { mountTargets, sideCoords, sidePlane, snapMount } from '@/engine/hardwareDrag';

const SIDES = ['front', 'back', 'l0', 'l1', 'w0', 'w1'] as const;

function spec(hardware: Partial<HardwareMount>[], parts = [{ id: 'd1' }, { id: 'd2' }]): Spec {
    return parseSpec({
        specVersion: '1.22',
        name: 'Drawers',
        units: 'in',
        materials: [
            { id: 'ply', name: 'Plywood', type: 'sheet', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
        ],
        parts: parts.map((p, i) => ({
            name: `Front ${i}`,
            materialId: 'ply',
            size: { l: 20, w: 6 },
            transform: { pos: [0, 4 + i * 7, 0] },
            ...p,
        })),
        hardware: hardware.map((h, i) => ({
            id: `hw_${i}`,
            item: 'knob.round-1-1-4',
            partId: 'd1',
            side: 'front',
            x: 10,
            y: 3,
            ...h,
        })),
    });
}

describe('sideCoords', () => {
    it('undoes mountFrame on every side', () => {
        const part = spec([]).parts[0];
        for (const side of SIDES) {
            const [mx, my] = sideExtent(part, 0.75, side);
            const mount = { side, x: mx * 0.3, y: my * 0.8 };
            const frame = mountFrame(part, 0.75, mount);
            const back = sideCoords(part.size, 0.75, side, frame.point);
            expect(back.x, side).toBeCloseTo(mount.x, 9);
            expect(back.y, side).toBeCloseTo(mount.y, 9);
        }
    });

    it('agrees with the plane each side lies in', () => {
        const part = spec([]).parts[0];
        for (const side of SIDES) {
            const frame = mountFrame(part, 0.75, { side, x: 1, y: 0.25 });
            const plane = sidePlane(part.size, 0.75, side);
            expect(plane.normal, side).toEqual(frame.normal);
            const off = frame.point.map((v, i) => (v - plane.point[i]) * plane.normal[i]);
            expect(off[0] + off[1] + off[2], side).toBeCloseTo(0, 9);
        }
    });
});

describe('snapMount', () => {
    const options = { gridSize: 0.125, tolerance: 0.25 };
    const none = { x: [], y: [] };

    it('pulls onto the centre lines of the face', () => {
        const snap = snapMount({ x: 10.2, y: 2.9 }, [20, 6], none, options);
        expect(snap).toMatchObject({ x: 10, y: 3 });
        expect(snap.guides).toEqual([
            { axis: 'x', at: 10, kind: 'centre' },
            { axis: 'y', at: 3, kind: 'centre' },
        ]);
    });

    it('lines up with other hardware, nearest line first', () => {
        const snap = snapMount({ x: 4.1, y: 1.3 }, [20, 6], { x: [4, 4.3], y: [5] }, options);
        expect(snap.x).toBe(4);
        expect(snap.guides).toEqual([{ axis: 'x', at: 4, kind: 'hardware' }]);
        // No line near y: it falls to the grid.
        expect(snap.y).toBeCloseTo(1.25, 9);
    });

    it('prefers the centre line to a piece sitting just beside it', () => {
        const snap = snapMount({ x: 10.1, y: 1 }, [20, 6], { x: [10.125], y: [] }, options);
        expect(snap.x).toBe(10);
    });

    it('keeps the piece on the side', () => {
        const snap = snapMount({ x: -3, y: 99 }, [20, 6], none, options);
        expect(snap).toMatchObject({ x: 0, y: 6, guides: [] });
        // A line off the side (a taller twin) is not a target.
        expect(snapMount({ x: 1, y: 5.9 }, [20, 6], { x: [], y: [6.1] }, options).y).toBeCloseTo(5.875, 9);
    });

    it('moves freely with the grid off', () => {
        const snap = snapMount({ x: 4.137, y: 1.011 }, [20, 6], none, { gridSize: 0, tolerance: 0.25 });
        expect(snap).toMatchObject({ x: 4.137, y: 1.011 });
    });
});

describe('mountTargets', () => {
    it('offers the same item on a matching part, and anything on the same side of this part', () => {
        const s = spec([
            { x: 10, y: 3 },
            { partId: 'd2', x: 14, y: 2 },
            { item: 'pull.bar-96mm', x: 5, y: 1 },
            { item: 'pull.bar-96mm', partId: 'd2', x: 7, y: 4 },
            { side: 'back', x: 9, y: 5 },
        ]);
        expect(mountTargets(s, 'hw_0')).toEqual({ x: [14, 5], y: [2, 1] });
    });

    it('ignores a twin on a part of another size', () => {
        const s = spec(
            [{}, { partId: 'd2', x: 14, y: 2 }],
            [{ id: 'd1' }, { id: 'd2', size: { l: 30, w: 6 } } as never],
        );
        expect(mountTargets(s, 'hw_0')).toEqual({ x: [], y: [] });
    });
});
