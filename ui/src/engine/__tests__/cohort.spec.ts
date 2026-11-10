import { describe, it, expect } from 'vitest';
import { cohortOf, cohortsOf } from '@/engine/cohort';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec/types';

/** Six parts: two in a group, three forming a drawer, and one loner. */
function spec(): Spec {
    const part = (id: string, x: number) => ({
        id,
        name: id,
        materialId: 'mat',
        size: { l: 6, w: 6 },
        transform: { pos: [x, 3, 0], rot: [0, 0, 0] },
    });

    return parseSpec({
        specVersion: '1.14',
        units: 'in',
        name: 'Cohorts',
        materials: [{ id: 'mat', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } }],
        parts: [
            part('p_slat_a', 0),
            part('p_slat_b', 7),
            part('p_front', 14),
            part('p_side', 21),
            part('p_bottom', 28),
            part('p_loner', 35),
        ],
        groups: [{ id: 'g_slats', partIds: ['p_slat_a', 'p_slat_b'] }],
        movables: [
            {
                id: 'mv_drawer',
                kind: 'drawer',
                partIds: ['p_front', 'p_side', 'p_bottom'],
                frontPartId: 'p_front',
                style: 'overlay',
            },
        ],
    } as unknown as Spec);
}

describe('cohortOf', () => {
    it('returns a grouped part with the rest of its group', () => {
        expect(cohortOf(spec(), 'p_slat_a').sort()).toEqual(['p_slat_a', 'p_slat_b']);
    });

    it('returns a drawer part with the whole box — a front alone is a box left in mid-air', () => {
        expect(cohortOf(spec(), 'p_front').sort()).toEqual(['p_bottom', 'p_front', 'p_side']);
        // Reached from any member, not just the anchor.
        expect(cohortOf(spec(), 'p_bottom').sort()).toEqual(['p_bottom', 'p_front', 'p_side']);
    });

    it('returns an ungrouped part as its own cohort', () => {
        expect(cohortOf(spec(), 'p_loner')).toEqual(['p_loner']);
    });

    it('unions both memberships when a part is in a group and a movable', () => {
        const both = spec();
        both.groups = [{ id: 'g_mixed', partIds: ['p_front', 'p_loner'] }];

        // Neither membership wins: the part drags in everything it belongs to.
        expect(cohortOf(both, 'p_front').sort()).toEqual(['p_bottom', 'p_front', 'p_loner', 'p_side']);
    });
});

describe('cohortsOf', () => {
    it('unions several cohorts and dedupes the overlap', () => {
        expect(cohortsOf(spec(), ['p_slat_a', 'p_front', 'p_side'])).toEqual([
            'p_slat_a',
            'p_slat_b',
            'p_front',
            'p_side',
            'p_bottom',
        ]);
    });

    it('returns ids in spec order, so the result is stable whatever the selection order', () => {
        const forwards = cohortsOf(spec(), ['p_loner', 'p_slat_b']);
        const backwards = cohortsOf(spec(), ['p_slat_b', 'p_loner']);
        expect(forwards).toEqual(backwards);
        expect(forwards).toEqual(['p_slat_a', 'p_slat_b', 'p_loner']);
    });

    it('is empty for an empty selection', () => {
        expect(cohortsOf(spec(), [])).toEqual([]);
    });

    it('ignores ids that are not in the spec', () => {
        expect(cohortsOf(spec(), ['p_ghost'])).toEqual([]);
    });
});
