import { describe, it, expect } from 'vitest';
import { computeTaper, computeSplay } from '@/calc/taper';

describe('computeTaper', () => {
    it('works the reference leg: 29in, 1 3/4 down to 1 over the last 24in', () => {
        const r = computeTaper({ length: 29, startWidth: 1.75, endWidth: 1, startAt: 5, faces: 2 });
        expect(r?.taperLength).toBe(24);
        expect(r?.removalPerFace).toBeCloseTo(0.375, 10); // two faces share the 0.75
        expect(r?.angleDeg).toBeCloseTo(0.895, 3);
    });

    it('puts the whole reduction on one face when only one is tapered', () => {
        const one = computeTaper({ length: 29, startWidth: 1.75, endWidth: 1, startAt: 5, faces: 1 });
        expect(one?.removalPerFace).toBeCloseTo(0.75, 10);
        expect(one?.angleDeg).toBeCloseTo(1.79, 2);
    });

    it('measures the jig offset over the whole blank', () => {
        const full = computeTaper({ length: 24, startWidth: 1.75, endWidth: 1, startAt: 0, faces: 1 });
        // A full-length taper offsets by exactly the removal.
        expect(full?.jigOffset).toBeCloseTo(0.75, 10);

        const partial = computeTaper({ length: 29, startWidth: 1.75, endWidth: 1, startAt: 5, faces: 1 });
        // A partial taper needs a bigger offset over the longer blank.
        expect(partial?.jigOffset).toBeGreaterThan(0.75);
    });

    it('keeps slope and angle consistent', () => {
        const r = computeTaper({ length: 30, startWidth: 2, endWidth: 1, startAt: 0, faces: 1 });
        expect(Math.tan((r?.angleDeg as number) * (Math.PI / 180))).toBeCloseTo(r?.slope as number, 12);
    });

    it('reports a leg that is not tapered at all', () => {
        const r = computeTaper({ length: 29, startWidth: 1.75, endWidth: 1.75, startAt: 0, faces: 2 });
        expect(r?.removalPerFace).toBe(0);
        expect(r?.angleDeg).toBe(0);
    });

    it('refuses a taper that is not one', () => {
        expect(computeTaper({ length: 29, startWidth: 1, endWidth: 2, startAt: 0, faces: 2 })).toBeNull();
        expect(computeTaper({ length: 29, startWidth: 1.75, endWidth: 1, startAt: 29, faces: 2 })).toBeNull();
        expect(computeTaper({ length: 0, startWidth: 1.75, endWidth: 1, startAt: 0, faces: 2 })).toBeNull();
    });

    it('warns about the trap in tapering all four faces', () => {
        expect(
            computeTaper({ length: 29, startWidth: 1.75, endWidth: 1, startAt: 5, faces: 4 })?.notes.join(
                ' ',
            ),
        ).toContain('fresh face');
    });
});

describe('computeSplay', () => {
    it('turns equal rake and splay into one angle on a 45 degree sightline', () => {
        const r = computeSplay({ rakeDeg: 10, splayDeg: 10, legLength: 18 });
        expect(r?.sightlineDeg).toBeCloseTo(45, 10);
        expect(r?.resultantDeg).toBeCloseTo(14.0019, 4);
    });

    it('always leans more than either angle alone', () => {
        // This is the whole point: drilling at 10 degrees for a 10-and-10 leg is wrong.
        for (const [rake, splay] of [
            [10, 10],
            [6, 12],
            [15, 4],
        ]) {
            const r = computeSplay({ rakeDeg: rake, splayDeg: splay, legLength: 18 });
            expect(r?.resultantDeg as number).toBeGreaterThan(Math.max(rake, splay));
        }
    });

    it('collapses to the single angle when there is only one', () => {
        const rakeOnly = computeSplay({ rakeDeg: 12, splayDeg: 0, legLength: 18 });
        expect(rakeOnly?.resultantDeg).toBeCloseTo(12, 10);
        expect(rakeOnly?.sightlineDeg).toBeCloseTo(0, 10);

        const splayOnly = computeSplay({ rakeDeg: 0, splayDeg: 12, legLength: 18 });
        expect(splayOnly?.resultantDeg).toBeCloseTo(12, 10);
        expect(splayOnly?.sightlineDeg).toBeCloseTo(90, 10);
    });

    it('bevels the foot at the angle the leg leans', () => {
        const r = computeSplay({ rakeDeg: 10, splayDeg: 10, legLength: 18 });
        expect(r?.footBevelDeg).toBe(r?.resultantDeg);
    });

    it('spreads the foot by the lean in each direction', () => {
        const r = computeSplay({ rakeDeg: 10, splayDeg: 20, legLength: 18 });
        expect(r?.footSpread.x).toBeCloseTo(18 * Math.sin(10 * (Math.PI / 180)), 10);
        expect(r?.footSpread.z).toBeCloseTo(18 * Math.sin(20 * (Math.PI / 180)), 10);
        expect(r?.footSpread.z as number).toBeGreaterThan(r?.footSpread.x as number);
    });

    it('refuses angles that are not leans', () => {
        expect(computeSplay({ rakeDeg: 90, splayDeg: 10, legLength: 18 })).toBeNull();
        expect(computeSplay({ rakeDeg: -5, splayDeg: 10, legLength: 18 })).toBeNull();
        expect(computeSplay({ rakeDeg: 10, splayDeg: 10, legLength: 0 })).toBeNull();
    });
});
