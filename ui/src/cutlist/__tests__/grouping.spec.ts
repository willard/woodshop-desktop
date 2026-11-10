import { describe, it, expect } from 'vitest';
import { computeCutList, groupCutList, groupLabel, type CutList, type PartRow } from '@/cutlist';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';

/** A part row with the fields grouping cares about; the rest are filled with sane defaults. */
function row(over: Partial<PartRow> & Pick<PartRow, 'partId' | 'name'>): PartRow {
    return {
        materialId: 'm_ply',
        materialName: 'Birch Ply',
        length: 30,
        width: 12,
        thickness: 0.75,
        qty: 1,
        boardFeet: 1,
        ...over,
    };
}

/** A cut list with no packing plans — grouping only reads `parts`, `sheets`, and `lumber`. */
function cutListOf(parts: PartRow[], over: Partial<CutList> = {}): CutList {
    return {
        parts,
        sheets: [],
        lumber: [],
        hardware: [],
        totals: { boardFeet: 0, sheetCount: 0, estimatedCost: null, wastePercent: 0 },
        ...over,
    };
}

describe('groupCutList — bookshelf golden fixture', () => {
    const sections = groupCutList(computeCutList(parseSpec(bookshelf)));

    it('collapses eight part rows into four blanks to cut', () => {
        expect(sections).toHaveLength(1);
        const groups = sections[0].groups;
        expect(groups).toHaveLength(4);
        expect(groups.reduce((sum, g) => sum + g.qty, 0)).toBe(8);
        expect(groups.flatMap((g) => g.members)).toHaveLength(8);
    });

    it('names each group and counts its pieces', () => {
        const byLabel = Object.fromEntries(sections[0].groups.map((g) => [g.label, g]));
        expect(byLabel['Back Panel'].qty).toBe(1);
        // Two 11 1/4 × 72 sides, three identical shelves, a top and a bottom.
        expect(byLabel['Left Side, Right Side'].qty).toBe(2);
        expect(byLabel['Shelf'].qty).toBe(3);
        expect(byLabel['Top, Bottom'].qty).toBe(2);
    });

    it('orders groups biggest blank first, by face area', () => {
        expect(sections[0].groups.map((g) => g.label)).toEqual([
            'Back Panel',
            'Left Side, Right Side',
            'Top, Bottom',
            'Shelf',
        ]);
    });

    it('reports the sheet stock to buy and the section board feet', () => {
        const cutList = computeCutList(parseSpec(bookshelf));
        const section = groupCutList(cutList)[0];
        expect(section.kind).toBe('sheet');
        expect(section.stock).toEqual({
            count: cutList.sheets[0].sheetCount,
            unit: 'sheet',
            l: 96,
            w: 48,
        });
        expect(section.boardFeet).toBeCloseTo(cutList.totals.boardFeet, 6);
        expect(section.cost).toBe(cutList.sheets[0].cost);
    });
});

describe('groupCutList — record stand golden fixture', () => {
    it('keeps every part accounted for', () => {
        const cutList = computeCutList(parseSpec(recordStand));
        const sections = groupCutList(cutList);
        const groups = sections.flatMap((s) => s.groups);

        expect(groups.reduce((sum, g) => sum + g.qty, 0)).toBe(
            cutList.parts.reduce((sum, p) => sum + p.qty, 0),
        );
        expect(sections.every((s) => s.kind === 'sheet')).toBe(true);
    });
});

describe('groupCutList — sections', () => {
    const cutList = cutListOf(
        [
            row({
                partId: 'leg1',
                name: 'Leg 1',
                materialId: 'm_2x4',
                materialName: 'Pine 2x4',
                length: 29,
                width: 3.5,
                thickness: 1.5,
            }),
            row({ partId: 'top', name: 'Top', materialId: 'm_ply', materialName: 'Birch Ply' }),
            row({
                partId: 'leg2',
                name: 'Leg 2',
                materialId: 'm_2x4',
                materialName: 'Pine 2x4',
                length: 29,
                width: 3.5,
                thickness: 1.5,
            }),
        ],
        {
            sheets: [
                {
                    materialId: 'm_ply',
                    materialName: 'Birch Ply',
                    sheetSize: { l: 96, w: 48 },
                    sheetCount: 1,
                    placements: [],
                    waste: 0.4,
                    cost: 78,
                },
            ],
            lumber: [
                {
                    materialId: 'm_2x4',
                    materialName: 'Pine 2x4',
                    stockLength: 96,
                    stickCount: 1,
                    cuts: [],
                    waste: 0.4,
                    cost: null,
                },
            ],
        },
    );

    it('splits sheet goods from lumber, sheets first', () => {
        const sections = groupCutList(cutList);
        expect(sections.map((s) => s.kind)).toEqual(['sheet', 'lumber']);
        expect(sections.map((s) => s.materialId)).toEqual(['m_ply', 'm_2x4']);
    });

    it('reports lumber stock as sticks of a stock length', () => {
        expect(groupCutList(cutList)[1].stock).toEqual({ count: 1, unit: 'stick', l: 96 });
    });

    it('falls back to an "other" section for material with no packing plan', () => {
        const sections = groupCutList(cutListOf([row({ partId: 'x', name: 'Mystery' })]));
        expect(sections).toHaveLength(1);
        expect(sections[0].kind).toBe('other');
        expect(sections[0].stock).toBeNull();
        expect(sections[0].wastePercent).toBeNull();
    });

    it('carries the material species onto the section', () => {
        const sections = groupCutList(cutListOf([row({ partId: 'x', name: 'Mystery', species: 'walnut' })]));
        expect(sections[0].species).toBe('walnut');
    });
});

describe('groupCutList — op flags', () => {
    it('unions the members op flags and marks the group mixed', () => {
        const [section] = groupCutList(
            cutListOf([
                row({ partId: 'a', name: 'Shelf 1', notched: true }),
                row({ partId: 'b', name: 'Shelf 2' }),
            ]),
        );
        expect(section.groups[0].notched).toBe(true);
        expect(section.groups[0].mixedOps).toBe(true);
    });

    it('is not mixed when every member carries the flag', () => {
        const [section] = groupCutList(
            cutListOf([
                row({ partId: 'a', name: 'Shelf 1', notched: true }),
                row({ partId: 'b', name: 'Shelf 2', notched: true }),
            ]),
        );
        expect(section.groups[0].notched).toBe(true);
        expect('mixedOps' in section.groups[0]).toBe(false);
    });

    it('does not split a group on differing joinery', () => {
        const [section] = groupCutList(
            cutListOf([
                row({ partId: 'a', name: 'Shelf 1', notched: true }),
                row({ partId: 'b', name: 'Shelf 2', curved: true }),
            ]),
        );
        expect(section.groups).toHaveLength(1);
        expect(section.groups[0].qty).toBe(2);
    });
});

describe('groupCutList — merge key', () => {
    it('keeps different dimensions apart and sums quantities of matching ones', () => {
        const [section] = groupCutList(
            cutListOf([
                row({ partId: 'a', name: 'Slat 1', qty: 4 }),
                row({ partId: 'b', name: 'Slat 2', qty: 5 }),
                row({ partId: 'c', name: 'Rail', width: 6 }),
            ]),
        );
        expect(section.groups).toHaveLength(2);
        expect(section.groups[0].qty).toBe(9);
        expect(section.groups[0].boardFeet).toBe(2);
        expect(section.groups[1].label).toBe('Rail');
    });

    it('keeps same-sized parts of different materials apart', () => {
        const sections = groupCutList(
            cutListOf([
                row({ partId: 'a', name: 'Panel', materialId: 'm_ply', materialName: 'Birch Ply' }),
                row({ partId: 'b', name: 'Panel', materialId: 'm_mdf', materialName: 'MDF' }),
            ]),
        );
        expect(sections).toHaveLength(2);
        expect(sections.every((s) => s.groups.length === 1)).toBe(true);
    });
});

describe('groupLabel', () => {
    it('uses the shared name when the parts agree', () => {
        expect(groupLabel(['Slat', 'Slat', 'Slat'])).toBe('Slat');
    });

    it('strips trailing numbering and punctuation off a shared prefix', () => {
        expect(groupLabel(['Shelf 1', 'Shelf 2', 'Shelf 3'])).toBe('Shelf');
        expect(groupLabel(['Leg-A', 'Leg-B'])).toBe('Leg');
        expect(groupLabel(['Leg (front, left)', 'Leg (front, right)', 'Leg (back, left)'])).toBe('Leg');
    });

    it('lists a couple of unrelated names outright', () => {
        expect(groupLabel(['Top', 'Bottom'])).toBe('Top, Bottom');
    });

    it('falls back to a word every name shares', () => {
        // The picnic table cuts nine identical 72" slats under four different names.
        expect(
            groupLabel([
                'Tabletop Slat 1',
                'Tabletop Slat 2',
                'Front Bench Slat (inner)',
                'Back Bench Slat (outer)',
            ]),
        ).toBe('Slat');
    });

    it('falls back to a count when the names have nothing in common', () => {
        expect(groupLabel(['Top', 'Bottom', 'Divider', 'Cleat'])).toBe('Top +3 more');
    });
});
