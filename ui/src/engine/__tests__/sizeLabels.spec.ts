import { describe, expect, it } from 'vitest';
import { parseSpec } from '@/spec';
import { place, sizeGroups } from '../sizeLabels';
import picnic from '../../../../resources/templates/picnic-table.json';
import bookshelf from '../../../../resources/templates/bookshelf.json';

const inches = (v: number) => `${Math.round(v * 100) / 100}"`;

describe('sizeGroups', () => {
    it('says each cut size once, with every part cut to it', () => {
        const groups = sizeGroups(parseSpec(bookshelf), inches);
        const shelf = groups.find((g) => g.text === '30.5" × 10.5"')!;
        expect(shelf.anchors.map((a) => a.partId)).toEqual(['p_shelf_1', 'p_shelf_2', 'p_shelf_3']);
        expect(groups).toHaveLength(4);
    });

    it('gives an angled end the angle to set the saw to', () => {
        const groups = sizeGroups(parseSpec(picnic), inches);
        expect(groups.some((g) => g.text.endsWith(' · ends 30°'))).toBe(true);
        expect(groups.some((g) => g.text.endsWith(' · ends 41° and 49°'))).toBe(true);
    });
});

describe('place', () => {
    it('keeps the nearest of two labels that would overlap', () => {
        const placed = place([
            { text: 'far', x: 100, y: 100, depth: 50 },
            { text: 'near', x: 104, y: 102, depth: 10 },
            { text: 'clear', x: 400, y: 100, depth: 80 },
        ]);
        expect(placed.map((p) => p.text)).toEqual(['near', 'clear']);
    });
});
