import { describe, it, expect } from 'vitest';
import { computePolygonAngles, computeJointMiter } from '@/calc/angles';

describe('computePolygonAngles — flat work', () => {
    it('gives the familiar settings for a square, a hexagon and an octagon', () => {
        expect(computePolygonAngles({ sides: 4, tiltDeg: 0 })?.miterDeg).toBeCloseTo(45, 10);
        expect(computePolygonAngles({ sides: 6, tiltDeg: 0 })?.miterDeg).toBeCloseTo(30, 10);
        expect(computePolygonAngles({ sides: 8, tiltDeg: 0 })?.miterDeg).toBeCloseTo(22.5, 10);
    });

    it('leaves the blade upright when the sides stand up', () => {
        for (const sides of [3, 4, 5, 6, 8, 12, 24]) {
            expect(computePolygonAngles({ sides, tiltDeg: 0 })?.bevelDeg).toBeCloseTo(0, 12);
        }
    });

    it('reports interior and exterior angles that close the shape', () => {
        const hex = computePolygonAngles({ sides: 6, tiltDeg: 0 });
        expect(hex?.interiorDeg).toBeCloseTo(120, 10);
        expect(hex?.exteriorDeg).toBeCloseTo(60, 10);
        for (const sides of [3, 5, 7, 12]) {
            const r = computePolygonAngles({ sides, tiltDeg: 0 });
            expect(
                (r as { interiorDeg: number }).interiorDeg + (r as { exteriorDeg: number }).exteriorDeg,
            ).toBeCloseTo(180, 10);
            expect((r as { exteriorDeg: number }).exteriorDeg * sides).toBeCloseTo(360, 8);
        }
    });
});

describe('computePolygonAngles — compound cuts', () => {
    it('matches the canonical table row: four sides leaning 30 degrees', () => {
        // Pinned so a change of reference angle — the way published tables disagree with each
        // other — breaks the build instead of reaching a workshop.
        const r = computePolygonAngles({ sides: 4, tiltDeg: 30 });
        expect(r?.miterDeg).toBeCloseTo(40.8934, 3);
        expect(r?.bevelDeg).toBeCloseTo(20.7048, 3);
    });

    it('matches a second row: six sides leaning 15 degrees', () => {
        const r = computePolygonAngles({ sides: 6, tiltDeg: 15 });
        expect(r?.miterDeg).toBeCloseTo(29.1474, 3);
        expect(r?.bevelDeg).toBeCloseTo(12.9525, 3);
    });

    it('eases the miter and opens the bevel as the sides lean further out', () => {
        const upright = computePolygonAngles({ sides: 8, tiltDeg: 0 });
        const leaning = computePolygonAngles({ sides: 8, tiltDeg: 25 });
        expect(leaning?.miterDeg).toBeLessThan((upright as { miterDeg: number }).miterDeg);
        expect(leaning?.bevelDeg).toBeGreaterThan(0);
    });

    it('leaves interior and exterior angles alone — they describe the plan, not the cut', () => {
        const flat = computePolygonAngles({ sides: 6, tiltDeg: 0 });
        const canted = computePolygonAngles({ sides: 6, tiltDeg: 30 });
        expect(canted?.interiorDeg).toBe(flat?.interiorDeg);
        expect(canted?.exteriorDeg).toBe(flat?.exteriorDeg);
    });
});

describe('computePolygonAngles — refusals', () => {
    it('refuses shapes that do not close', () => {
        expect(computePolygonAngles({ sides: 2, tiltDeg: 0 })).toBeNull();
        expect(computePolygonAngles({ sides: 0, tiltDeg: 0 })).toBeNull();
        expect(computePolygonAngles({ sides: -6, tiltDeg: 0 })).toBeNull();
        expect(computePolygonAngles({ sides: 6.5, tiltDeg: 0 })).toBeNull();
    });

    it('refuses a lean that is not a lean', () => {
        expect(computePolygonAngles({ sides: 6, tiltDeg: 90 })).toBeNull();
        expect(computePolygonAngles({ sides: 6, tiltDeg: -10 })).toBeNull();
        expect(computePolygonAngles({ sides: 6, tiltDeg: Number.NaN })).toBeNull();
    });

    it('stops where a saw setting stops being the answer', () => {
        expect(computePolygonAngles({ sides: 24, tiltDeg: 0 })).not.toBeNull();
        expect(computePolygonAngles({ sides: 25, tiltDeg: 0 })).toBeNull();
    });
});

describe('computeJointMiter', () => {
    it('halves the included angle', () => {
        expect(computeJointMiter(90)?.miterDeg).toBe(45);
        expect(computeJointMiter(120)?.miterDeg).toBe(60);
        expect(computeJointMiter(35)?.miterDeg).toBe(17.5);
    });

    it('refuses an angle that is not one', () => {
        expect(computeJointMiter(0)).toBeNull();
        expect(computeJointMiter(-90)).toBeNull();
        expect(computeJointMiter(360)).toBeNull();
    });
});
