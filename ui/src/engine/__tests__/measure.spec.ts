import { describe, it, expect } from 'vitest';
import {
    pointDistance,
    pointDimension,
    heightDimension,
    gapDimension,
    sizeDimensions,
    midpoint,
} from '@/engine/measure';
import { worldAABB, type Box } from '@/spec/geometry';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';

function boxOf(spec: ReturnType<typeof parseSpec>, id: string): Box {
    const part = spec.parts.find((p) => p.id === id)!;
    const thickness = spec.materials.find((m) => m.id === part.materialId)!.thickness;
    return worldAABB(part, thickness);
}

describe('measure — point-to-point', () => {
    it('is the straight-line distance between two world points', () => {
        expect(pointDistance([0, 0, 0], [3, 4, 0])).toBeCloseTo(5, 6);
        const d = pointDimension([1, 2, 3], [1, 2, 8]);
        expect(d.distance).toBeCloseTo(5, 6);
        expect(midpoint(d)).toEqual([1, 2, 5.5]);
    });
});

describe('measure — height above ground', () => {
    it('drops from the top face centre to the floor (y=0)', () => {
        const box: Box = { min: [-2, 10, -1], max: [2, 12, 1] };
        const d = heightDimension(box);
        expect(d.distance).toBeCloseTo(12, 6); // top face height
        expect(d.a).toEqual([0, 12, 0]); // centre of the top face
        expect(d.b).toEqual([0, 0, 0]); // straight down to ground
    });

    it('reports a real shelf height from the fixture', () => {
        const spec = parseSpec(bookshelf);
        const box = boxOf(spec, 'p_shelf_1'); // shelf centred at y=18, 0.75 thick
        const d = heightDimension(box);
        expect(d.distance).toBeCloseTo(18.375, 3); // top of the shelf above the floor
    });
});

describe('measure — gap between two parts', () => {
    it('spans the nearest facing faces along the axis of greatest separation', () => {
        const a: Box = { min: [0, 0, 0], max: [4, 1, 4] };
        const b: Box = { min: [0, 3, 0], max: [4, 4, 4] }; // 2" above a in y
        const d = gapDimension(a, b);
        expect(d.distance).toBeCloseTo(2, 6);
        expect(d.a[1]).toBeCloseTo(1, 6); // a's top face
        expect(d.b[1]).toBeCloseTo(3, 6); // b's bottom face
        // Line sits at the shared footprint centre on the other axes.
        expect(d.a[0]).toBeCloseTo(2, 6);
        expect(d.a[2]).toBeCloseTo(2, 6);
    });

    it('returns 0 for touching or overlapping parts', () => {
        const a: Box = { min: [0, 0, 0], max: [4, 2, 4] };
        const b: Box = { min: [0, 2, 0], max: [4, 4, 4] }; // faces flush at y=2
        expect(gapDimension(a, b).distance).toBeCloseTo(0, 6);
    });

    it('measures the spacing between two bookshelf shelves', () => {
        const spec = parseSpec(bookshelf);
        const d = gapDimension(boxOf(spec, 'p_shelf_1'), boxOf(spec, 'p_shelf_2'));
        expect(d.distance).toBeCloseTo(17.25, 3); // 18" centres, 0.75" thick each
    });
});

describe('measure — a part’s own size', () => {
    it('traces length/width/thickness along the local edges (axis-aligned part)', () => {
        const spec = parseSpec(bookshelf);
        const back = spec.parts.find((p) => p.id === 'p_back')!; // rot [0,0,0]
        const dims = sizeDimensions(back, 0.75);
        expect(dims.length.distance).toBeCloseTo(32, 6);
        expect(dims.width.distance).toBeCloseTo(72, 6);
        expect(dims.thickness.distance).toBeCloseTo(0.75, 6);
        // Length edge runs along world +X for an unrotated part.
        expect(dims.length.b[0] - dims.length.a[0]).toBeCloseTo(32, 6);
        expect(dims.length.b[1] - dims.length.a[1]).toBeCloseTo(0, 6);
    });

    it('follows the part’s local axes when rotated', () => {
        const spec = parseSpec(recordStand);
        const shelf = spec.parts.find((p) => p.id === 'p_shelf_1')!; // rot [90,0,0]
        const dims = sizeDimensions(shelf, 0.709);
        // Distances are invariant under rotation.
        expect(dims.length.distance).toBeCloseTo(37.082, 3);
        expect(dims.width.distance).toBeCloseTo(18, 3);
        // Width (local +Y) maps to world Z after a 90° X-rotation, not world Y.
        expect(Math.abs(dims.width.b[2] - dims.width.a[2])).toBeCloseTo(18, 3);
        expect(Math.abs(dims.width.b[1] - dims.width.a[1])).toBeCloseTo(0, 3);
    });
});
