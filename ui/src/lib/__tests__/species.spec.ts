import { describe, it, expect } from 'vitest';
import { SPECIES, SPEC_SPECIES, SOLID_SPECIES, speciesById, modulusOf } from '@/lib/species';
import { DEFAULT_STRUCT_CONFIG } from '@/struct/types';
import { HARDWOOD_SPECIES } from '@/spec/fasteners';

describe('SPECIES table', () => {
    it('has a unique id and a stiffness for every entry', () => {
        const ids = SPECIES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of SPECIES) {
            expect(s.modulus).toBeGreaterThan(0);
            expect(s.label.length).toBeGreaterThan(0);
        }
    });

    it('gives every solid species the properties the movement and pilot calculators need', () => {
        for (const s of SOLID_SPECIES) {
            expect(s.tangential).not.toBeNull();
            expect(s.radial).not.toBeNull();
            expect(s.janka).not.toBeNull();
            // Tangential movement always exceeds radial — that is why the grain question is asked.
            expect(s.tangential as number).toBeGreaterThan(s.radial as number);
        }
    });

    it('leaves panels without movement coefficients so they cannot be offered', () => {
        const panels = SPECIES.filter((s) => s.kind === 'panel');
        expect(panels.length).toBeGreaterThan(0);
        for (const p of panels) {
            expect(p.tangential).toBeNull();
            expect(p.radial).toBeNull();
        }
        expect(SOLID_SPECIES.some((s) => s.kind === 'panel')).toBe(false);
    });

    it('pins the transcribed reference values', () => {
        // A typo here is a wrong answer handed to someone gluing up a tabletop, so every number
        // the calculators lean on is asserted rather than trusted (D86).
        expect(speciesById('oak')?.tangential).toBe(0.00369);
        expect(speciesById('oak')?.radial).toBe(0.00158);
        expect(speciesById('cherry')?.tangential).toBe(0.00248);
        expect(speciesById('beech')?.tangential).toBe(0.00431); // the movingest of the set
        expect(speciesById('pine')?.radial).toBe(0.00071); // and the stillest
        expect(speciesById('oak')?.janka).toBe(1290);
        expect(speciesById('mdf')?.modulus).toBe(500_000);
        expect(speciesById('plywood_baltic')?.modulus).toBe(1_500_000);
    });

    it('makes MDF dramatically floppier than Baltic birch', () => {
        // The whole reason panels are in the sag picker: reaching for a solid species instead is
        // a comfortable lie of about 3x.
        expect(modulusOf('plywood_baltic') / modulusOf('mdf')).toBeCloseTo(3, 1);
    });

    it('falls back to conservative pine for an unknown id', () => {
        expect(modulusOf('nope' as never)).toBe(modulusOf('pine'));
    });
});

describe('agreement with the rest of the app', () => {
    it('matches DEFAULT_STRUCT_CONFIG.speciesE exactly', () => {
        // The drift guard. These two must never disagree, or the calculator and the editor's
        // sturdiness advisory would give different answers for the same shelf (D86).
        for (const id of SPEC_SPECIES) {
            expect(DEFAULT_STRUCT_CONFIG.speciesE[id]).toBe(modulusOf(id));
        }
    });

    it('covers exactly the five species the spec schema can name', () => {
        expect([...SPEC_SPECIES].sort()).toEqual(['cherry', 'maple', 'oak', 'pine', 'walnut']);
        for (const id of SPEC_SPECIES) {
            expect(speciesById(id)).toBeDefined();
        }
    });

    it('agrees with HARDWOOD_SPECIES about which of those want a fine thread', () => {
        for (const id of SPEC_SPECIES) {
            expect(speciesById(id)?.hardForFasteners).toBe(HARDWOOD_SPECIES.includes(id));
        }
    });
});
