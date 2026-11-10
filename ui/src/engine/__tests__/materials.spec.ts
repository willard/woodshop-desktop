import { describe, it, expect } from 'vitest';
import { woodColorFor } from '@/engine/materials';
import type { Material } from '@/spec/types';

const base: Material = {
    id: 'mat_ply34',
    type: 'sheet',
    name: 'Birch Plywood 3/4"',
    thickness: 0.75,
    sheetSize: { l: 96, w: 48 },
    grain: true,
};

describe('woodColorFor', () => {
    it('is deterministic per material id when no species is set', () => {
        expect(woodColorFor(base)).toBe(woodColorFor({ ...base }));
        expect(woodColorFor(base)).not.toBe(woodColorFor({ ...base, id: 'mat_other' }));
    });

    it('maps each species to its preset tone regardless of id', () => {
        const walnutA = woodColorFor({ ...base, species: 'walnut' });
        const walnutB = woodColorFor({ ...base, id: 'mat_xyz', species: 'walnut' });
        expect(walnutA).toBe(walnutB);
        expect(walnutA).toBe(0x6b4a2f);
        // Distinct species read as visually distinct tones.
        const tones = (['pine', 'oak', 'maple', 'walnut', 'cherry'] as const).map((species) =>
            woodColorFor({ ...base, species }),
        );
        expect(new Set(tones).size).toBe(tones.length);
    });
});
