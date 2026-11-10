import { describe, it, expect } from 'vitest';
import { computeCutList, type CutList, type Placement } from '@/cutlist';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';

const EPS = 1e-6;

/** Rounds every number so snapshots are readable and platform-stable. */
function round(value: unknown): unknown {
    if (typeof value === 'number') {
        return Math.round(value * 1000) / 1000;
    }
    if (Array.isArray(value)) {
        return value.map(round);
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
    }
    return value;
}

function overlaps(a: Placement, b: Placement): boolean {
    return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

function assertValidPacking(cutList: CutList): void {
    for (const plan of cutList.sheets) {
        // Every placement stays inside its sheet.
        for (const p of plan.placements) {
            expect(p.x + p.w).toBeLessThanOrEqual(plan.sheetSize.l + EPS);
            expect(p.y + p.h).toBeLessThanOrEqual(plan.sheetSize.w + EPS);
        }
        // No two placements on the same sheet overlap.
        const bySheet = new Map<number, Placement[]>();
        for (const p of plan.placements) {
            (bySheet.get(p.sheet) ?? bySheet.set(p.sheet, []).get(p.sheet)!).push(p);
        }
        for (const group of bySheet.values()) {
            for (let i = 0; i < group.length; i += 1) {
                for (let j = i + 1; j < group.length; j += 1) {
                    expect(overlaps(group[i], group[j])).toBe(false);
                }
            }
        }
    }
}

describe('computeCutList — record stand', () => {
    const cutList = computeCutList(parseSpec(recordStand));

    it('lists every part with board feet', () => {
        expect(cutList.parts).toHaveLength(6);
        expect(cutList.parts.every((p) => p.boardFeet > 0)).toBe(true);
        expect(cutList.totals.boardFeet).toBeGreaterThan(0);
    });

    it('packs onto the sheet with a valid, non-overlapping layout', () => {
        expect(cutList.sheets).toHaveLength(1);
        expect(cutList.sheets[0].sheetCount).toBeGreaterThanOrEqual(1);
        assertValidPacking(cutList);
    });

    it('never rotates grain-locked parts', () => {
        expect(cutList.sheets[0].placements.every((p) => p.rotated === false)).toBe(true);
    });

    it('estimates cost from the sheet count and price', () => {
        // Baltic Birch is $95/sheet in the fixture.
        expect(cutList.totals.estimatedCost).toBe(cutList.sheets[0].sheetCount * 95);
    });

    it('matches the frozen golden snapshot', () => {
        expect(round(cutList)).toMatchSnapshot();
    });
});

describe('computeCutList — bookshelf', () => {
    const cutList = computeCutList(parseSpec(bookshelf));

    it('produces a valid packing', () => {
        expect(cutList.parts).toHaveLength(8);
        assertValidPacking(cutList);
    });

    it('matches the frozen golden snapshot', () => {
        expect(round(cutList)).toMatchSnapshot();
    });
});

describe('computeCutList — species (spec 1.3)', () => {
    it('carries species onto rows and groups two same-stock species separately', () => {
        const base = parseSpec(recordStand);
        const walnut = {
            ...base.materials[0],
            id: 'mat_bb18_walnut',
            species: 'walnut' as const,
            name: 'Walnut — Baltic Birch 18mm',
        };
        const spec = parseSpec({
            ...base,
            materials: [...base.materials, walnut],
            parts: base.parts.map((p) => (p.id === 'p_top' ? { ...p, materialId: 'mat_bb18_walnut' } : p)),
        });
        const cutList = computeCutList(spec);

        const topRow = cutList.parts.find((r) => r.partId === 'p_top')!;
        expect(topRow.species).toBe('walnut');
        expect(cutList.parts.find((r) => r.partId === 'p_side_l')!.species).toBeUndefined();
        // Each material packs its own sheets — walnut parts never share birch stock.
        expect(cutList.sheets.map((s) => s.materialId).sort()).toEqual(['mat_bb18', 'mat_bb18_walnut']);
        assertValidPacking(cutList);
    });
});

describe('computeCutList — notch flag (spec 1.7)', () => {
    it('marks notched parts and leaves the blank dims and other rows untouched', () => {
        const base = parseSpec(recordStand);
        const spec = parseSpec({
            ...base,
            parts: base.parts.map((p) =>
                p.id === 'p_shelf_1'
                    ? { ...p, ops: [{ type: 'notch', edge: 'w0', from: 0, to: 18, depth: 0.3125 }] }
                    : p,
            ),
        });
        const cutList = computeCutList(spec);

        const shelf = cutList.parts.find((r) => r.partId === 'p_shelf_1')!;
        expect(shelf.notched).toBe(true);
        // The blank stays the rectangular size — you cut the notch from it.
        expect(shelf.length).toBeCloseTo(37.082, 6);
        // Un-notched rows must not carry the key at all (golden-snapshot safety).
        expect('notched' in cutList.parts.find((r) => r.partId === 'p_top')!).toBe(false);
        assertValidPacking(cutList);
    });
});

describe('computeCutList — ease flag (spec 1.10)', () => {
    it('marks eased parts without changing the blank they are cut from', () => {
        const base = parseSpec(recordStand);
        const spec = parseSpec({
            ...base,
            parts: base.parts.map((p) =>
                p.id === 'p_top'
                    ? { ...p, ops: [{ type: 'ease', edge: 'l1', profile: 'roundover', radius: 0.25 }] }
                    : p,
            ),
        });
        const cutList = computeCutList(spec);

        const top = cutList.parts.find((r) => r.partId === 'p_top')!;
        const plain = parseSpec(recordStand);
        expect(top.eased).toBe(true);
        // The router runs after the saw, so the blank — and the board feet — are unchanged.
        expect(top.length).toBe(computeCutList(plain).parts.find((r) => r.partId === 'p_top')!.length);
        expect(top.boardFeet).toBe(computeCutList(plain).parts.find((r) => r.partId === 'p_top')!.boardFeet);
        // Un-eased rows must not carry the key at all (golden-snapshot safety).
        expect('eased' in cutList.parts.find((r) => r.partId === 'p_shelf_1')!).toBe(false);
        assertValidPacking(cutList);
    });
});

describe('computeCutList — miter flag', () => {
    it('marks mitered parts and leaves the blank dims and other rows untouched', () => {
        const base = parseSpec(recordStand);
        const shelfBlank = base.parts.find((p) => p.id === 'p_shelf_1')!.size;
        const spec = parseSpec({
            ...base,
            parts: base.parts.map((p) =>
                p.id === 'p_shelf_1' ? { ...p, ops: [{ type: 'miter', edge: 'w1', angle: 15 }] } : p,
            ),
        });
        const cutList = computeCutList(spec);

        const shelf = cutList.parts.find((r) => r.partId === 'p_shelf_1')!;
        expect(shelf.mitered).toBe(true);
        // A miter bevels the edge but doesn't change the blank you cut to size.
        expect(shelf.length).toBeCloseTo(shelfBlank.l, 6);
        expect(shelf.width).toBeCloseTo(shelfBlank.w, 6);
        // Un-mitered rows must not carry the key at all (golden-snapshot safety).
        expect('mitered' in cutList.parts.find((r) => r.partId === 'p_top')!).toBe(false);
        assertValidPacking(cutList);
    });
});
