import { describe, it, expect } from 'vitest';
import { parseSpec, safeParseSpec, CURRENT_SPEC_VERSION } from '@/spec';
import { migrateToLatest } from '@/spec/migrations';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';
import { goldenExpectations } from '@fixtures/specs/expected';

describe('spec validation', () => {
    it('accepts the golden fixtures and preserves counts', () => {
        const stand = parseSpec(recordStand);
        expect(stand.name).toBe('Record Stand');
        expect(stand.parts).toHaveLength(goldenExpectations['record-stand'].partCount);
        expect(stand.materials).toHaveLength(goldenExpectations['record-stand'].materialCount);
        expect(stand.joints).toHaveLength(goldenExpectations['record-stand'].jointCount);

        const shelf = parseSpec(bookshelf);
        expect(shelf.parts).toHaveLength(goldenExpectations.bookshelf.partCount);
    });

    it('applies schema defaults (joints, qty, rot)', () => {
        const shelf = parseSpec(bookshelf);
        // Every part defaults qty and a rot triple when omitted.
        for (const part of shelf.parts) {
            expect(part.transform.rot).toHaveLength(3);
        }
    });

    it('rejects a part that references dimensions over the allowed max', () => {
        const bad = structuredClone(recordStand) as Record<string, unknown>;
        (bad.parts as Array<{ size: { l: number } }>)[0].size.l = 999;
        const result = safeParseSpec(bad);
        expect(result.success).toBe(false);
    });

    it('rejects an unknown units value', () => {
        const bad = { ...structuredClone(recordStand), units: 'cm' };
        expect(safeParseSpec(bad).success).toBe(false);
    });
});

describe('material species (spec 1.3)', () => {
    it('accepts a preset species and rejects an unknown one', () => {
        const spec = parseSpec(recordStand);
        const withSpecies = {
            ...spec,
            materials: [{ ...spec.materials[0], species: 'walnut' }],
        };
        expect(parseSpec(withSpecies).materials[0].species).toBe('walnut');

        const bad = {
            ...spec,
            materials: [{ ...spec.materials[0], species: 'mahogany' }],
        };
        expect(safeParseSpec(bad).success).toBe(false);
    });
});

describe('curve op one-sided variants (spec 1.5)', () => {
    const withOps = (ops: unknown[]): Record<string, unknown> => {
        const spec = structuredClone(recordStand) as { parts: Array<{ ops?: unknown[] }> };
        spec.parts[2].ops = ops; // p_top has no ops in the fixture
        return spec as unknown as Record<string, unknown>;
    };

    it('accepts a single-corner round and a ramp', () => {
        const good = withOps([
            { type: 'curve', edge: 'l1', kind: 'round', radius: 3, corner: 'w1' },
            { type: 'curve', edge: 'l0', kind: 'ramp', height: 4, low: 'w0' },
        ]);
        expect(safeParseSpec(good).success).toBe(true);
    });

    it('rejects a ramp without its low edge and a round with a bogus corner', () => {
        expect(safeParseSpec(withOps([{ type: 'curve', edge: 'l1', kind: 'ramp', height: 4 }])).success).toBe(
            false,
        );
        expect(
            safeParseSpec(withOps([{ type: 'curve', edge: 'l1', kind: 'round', radius: 3, corner: 'north' }]))
                .success,
        ).toBe(false);
    });
});

describe('part groups (spec 1.6)', () => {
    it('accepts a valid group and rejects singleton or duplicate memberships', () => {
        const spec = parseSpec(recordStand);
        const withGroup = {
            ...spec,
            groups: [{ id: 'g_sides', name: 'Sides', partIds: ['p_side_l', 'p_side_r'] }],
        };
        expect(parseSpec(withGroup).groups).toHaveLength(1);

        expect(safeParseSpec({ ...spec, groups: [{ id: 'g_solo', partIds: ['p_top'] }] }).success).toBe(
            false,
        );
        expect(
            safeParseSpec({ ...spec, groups: [{ id: 'g_dup', partIds: ['p_top', 'p_top'] }] }).success,
        ).toBe(false);
        expect(
            safeParseSpec({
                ...spec,
                groups: [{ id: 'g_x', partIds: ['p_top', 'p_back'], nested: true }],
            }).success,
        ).toBe(false);
    });
});

describe('migrations', () => {
    it('treats the current version as a no-op', () => {
        const migrated = migrateToLatest(recordStand);
        expect(migrated.specVersion).toBe(CURRENT_SPEC_VERSION);
    });

    it('stamps a 1.2 spec through the chain to 1.14 (species/curves/groups/notches/fasteners/eases/movables/round are additive)', () => {
        const migrated = migrateToLatest({ ...(recordStand as object), specVersion: '1.2' });
        expect(migrated.specVersion).toBe('1.14');
    });

    it('walks 1.9 → … → 1.14 (the version is a number pair, not a decimal)', () => {
        expect(migrateToLatest({ ...(recordStand as object), specVersion: '1.9' }).specVersion).toBe('1.14');
        expect(migrateToLatest({ ...(recordStand as object), specVersion: '1.11' }).specVersion).toBe('1.14');
        expect(migrateToLatest({ ...(recordStand as object), specVersion: '1.12' }).specVersion).toBe('1.14');
    });

    /**
     * 1.14 is the first migration that rewrites data rather than stamping a version, so the ids it
     * mints are a contract, not an implementation detail: this chain and its PHP mirror run
     * independently against the same stored document, and anything non-deterministic would give one
     * design different ids depending on which runtime read it first. The identical literal
     * expectation lives in tests/Feature/SpecMigratorTest.php — change one and the other must move.
     */
    it('1.14 mints positional joint ids, preserving any already present', () => {
        const migrated = migrateToLatest({
            ...(recordStand as object),
            specVersion: '1.13',
            joints: [
                { type: 'screw', hostPartId: 'p_side_l', insertPartId: 'p_shelf_1' },
                { id: 'j1', type: 'screw', hostPartId: 'p_side_r', insertPartId: 'p_shelf_1' },
                { type: 'screw', hostPartId: 'p_top', insertPartId: 'p_side_l' },
            ],
        });

        expect((migrated.joints as { id: string }[]).map((j) => j.id)).toEqual(['j0', 'j1', 'j2']);
    });

    it('mints joint ids idempotently — migrating twice changes nothing', () => {
        const once = migrateToLatest({ ...(recordStand as object), specVersion: '1.0' });
        const twice = migrateToLatest({ ...once, specVersion: '1.13' });

        expect((twice.joints as { id: string }[]).map((j) => j.id)).toEqual(
            (once.joints as { id: string }[]).map((j) => j.id),
        );
    });

    it('suffixes a positional id that collides with one already taken', () => {
        const migrated = migrateToLatest({
            ...(recordStand as object),
            specVersion: '1.13',
            joints: [
                { type: 'screw', hostPartId: 'p_side_l', insertPartId: 'p_shelf_1' },
                { id: 'j0', type: 'screw', hostPartId: 'p_side_r', insertPartId: 'p_shelf_1' },
            ],
        });

        expect((migrated.joints as { id: string }[]).map((j) => j.id)).toEqual(['j0_1', 'j0']);
    });

    it('throws on a spec missing specVersion', () => {
        expect(() => migrateToLatest({ units: 'in' })).toThrow(/specVersion/);
    });

    it('throws on an unknown future version with no migration path', () => {
        expect(() => migrateToLatest({ specVersion: '99.0' })).toThrow(/migration path/i);
    });
});
