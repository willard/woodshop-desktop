import { describe, it, expect } from 'vitest';
import { computeCutList, groupCutList } from '@/cutlist';
import { cutListCsv } from '@/cutlist/csv';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

/** Split one CSV line into fields, honouring quotes (enough for what cutListCsv writes). */
function fields(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted && c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
        } else if (c === '"') {
            quoted = !quoted;
        } else if (c === ',' && !quoted) {
            out.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}

describe('cutListCsv', () => {
    const cutList = computeCutList(parseSpec(recordStand));
    const csv = cutListCsv(cutList);
    const lines = csv
        .replace(/^\ufeff/, '')
        .trimEnd()
        .split('\r\n');

    it('writes one row per grouped blank, then the hardware', () => {
        const groups = groupCutList(cutList).flatMap((s) => s.groups);
        expect(fields(lines[0])).toEqual([
            'Material',
            'Part',
            'Qty',
            'Length (in)',
            'Width (in)',
            'Thickness (in)',
            'Size',
            'Board feet',
            'Notes',
        ]);
        const partRows = lines.slice(1, 1 + groups.length).map(fields);
        expect(partRows).toHaveLength(groups.length);
        expect(partRows.reduce((n, r) => n + Number(r[2]), 0)).toBe(groups.reduce((n, g) => n + g.qty, 0));
        expect(lines[1 + groups.length]).toBe('');
        expect(fields(lines[2 + groups.length])).toEqual(['Hardware', 'Qty']);
        expect(lines.length - 3 - groups.length).toBe(cutList.hardware.length);
    });

    it('keeps sizes as numbers and as shop fractions', () => {
        const [first] = lines.slice(1).map(fields);
        expect(Number.isFinite(Number(first[3]))).toBe(true);
        expect(first[6]).toMatch(/^[\d /]+" × [\d /]+" × [\d /]+"$/);
    });

    it('starts with a BOM so spreadsheets read it as UTF-8', () => {
        expect(csv.startsWith('\ufeff')).toBe(true);
    });

    it('quotes fields with commas and quotes', () => {
        const spec = parseSpec(recordStand);
        spec.parts[0].name = 'Shelf, "top"';
        const tricky = cutListCsv(computeCutList(spec));
        expect(tricky).toContain('"Shelf, ""top""');
    });
});
