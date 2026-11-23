import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
    SPECIES_TONES,
    createFlatWoodMaterial,
    showsGrain,
    surfaceColorFor,
    woodColorFor,
    woodMaterialProvider,
} from '@/engine/materials';
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
        expect(walnutA).toBe(SPECIES_TONES.walnut);
        // Distinct species read as visually distinct tones.
        const tones = (['pine', 'oak', 'maple', 'walnut', 'cherry'] as const).map((species) =>
            woodColorFor({ ...base, species }),
        );
        expect(new Set(tones).size).toBe(tones.length);
    });
});

describe('appearance (spec 1.20)', () => {
    const part = { id: 'p', name: 'P', materialId: base.id, size: { l: 10, w: 5 }, grainAxis: 'l' } as never;

    it('paints flat in the given colour, with no grain', () => {
        const painted = { ...base, appearance: { kind: 'paint' as const, color: '#8a9a5b' } };
        expect(surfaceColorFor(painted)).toBe(0x8a9a5b);
        expect(showsGrain(painted)).toBe(false);
        const grain = new THREE.Texture();
        const mat = woodMaterialProvider(grain)(painted, part) as THREE.MeshStandardMaterial;
        expect(mat.map).toBeNull();
        expect(mat.color.getHex()).toBe(0x8a9a5b);
    });

    it('stains the wood: a tint between its tone and the stain, the grain still showing', () => {
        const stained = {
            ...base,
            species: 'maple' as const,
            appearance: { kind: 'stain' as const, color: '#000000' },
        };
        const tone = new THREE.Color(SPECIES_TONES.maple);
        const got = new THREE.Color(surfaceColorFor(stained));
        expect(got.r).toBeLessThan(tone.r);
        expect(got.r).toBeGreaterThan(0);
        expect(showsGrain(stained)).toBe(true);
        const mat = woodMaterialProvider(new THREE.Texture())(stained, part) as THREE.MeshStandardMaterial;
        expect(mat.map).not.toBeNull();
    });

    it('draws glass see-through and metal shiny', () => {
        const glass = createFlatWoodMaterial({ ...base, appearance: { kind: 'glass' } });
        expect(glass).toBeInstanceOf(THREE.MeshPhysicalMaterial);
        expect(glass.transparent).toBe(true);
        expect(glass.opacity).toBeLessThan(0.5);
        const metal = createFlatWoodMaterial({ ...base, appearance: { kind: 'metal' } });
        expect(metal.metalness).toBeGreaterThan(0.5);
    });

    it('bare wood is unchanged', () => {
        expect(surfaceColorFor({ ...base, appearance: { kind: 'wood' } })).toBe(woodColorFor(base));
    });
});
