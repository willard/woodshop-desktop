/**
 * The cut list as a spreadsheet: one row per distinct blank, grouped by material the way the
 * panel shows it. Sizes come twice — plain numbers for sorting and sums (decimal inches, or
 * millimetres when working in metric), and as written at the bench — and the hardware follows
 * the parts after a blank row.
 */
import type { CutList } from './types';
import { groupCutList } from './grouping';
import { getUnits, len, lenValue, type Units } from '@/lib/display';

function header(units: Units): string[] {
    const u = units === 'metric' ? 'mm' : 'in';
    return [
        'Material',
        'Part',
        'Qty',
        `Length (${u})`,
        `Width (${u})`,
        `Thickness (${u})`,
        'Size',
        'Board feet',
        'Notes',
    ];
}

/** RFC 4180: quote a field when it holds a comma, quote or line break; double inner quotes. */
function field(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values: (string | number)[]): string {
    return values.map(field).join(',');
}

/** Trim float dust without turning 0.75 into "0.750". */
function decimal(value: number, places = 4): number {
    return Number(value.toFixed(places));
}

/** The number column: decimal inches, or millimetres to a tenth when working in metric. */
function amount(inches: number, units: Units): number {
    return units === 'metric' ? decimal(inches * 25.4, 1) : decimal(inches);
}

/** The size as written: `24" × 16" × 3/4"`, or `610 × 406 × 19 mm`. */
function written(l: number, w: number, t: number, units: Units): string {
    return units === 'metric'
        ? `${lenValue(l, units)} × ${lenValue(w, units)} × ${lenValue(t, units)} mm`
        : `${len(l, units)} × ${len(w, units)} × ${len(t, units)}`;
}

export function cutListCsv(cutList: CutList, units: Units = getUnits()): string {
    const lines = [row(header(units))];
    for (const section of groupCutList(cutList)) {
        for (const group of section.groups) {
            const notes = [
                group.curved && 'curved',
                group.notched && 'notched',
                group.mitered && 'mitered',
                group.eased && 'eased',
            ].filter(Boolean);
            lines.push(
                row([
                    section.materialName,
                    group.label,
                    group.qty,
                    amount(group.length, units),
                    amount(group.width, units),
                    amount(group.thickness, units),
                    written(group.length, group.width, group.thickness, units),
                    decimal(group.boardFeet, 2),
                    notes.join('; '),
                ]),
            );
        }
    }
    if (cutList.hardware.length > 0) {
        lines.push('', row(['Hardware', 'Qty']));
        for (const item of cutList.hardware) {
            lines.push(row([item.description + (item.derived ? ' (estimated)' : ''), item.qty]));
        }
    }
    // A byte-order mark so Excel reads the × and inch marks as UTF-8.
    return `\ufeff${lines.join('\r\n')}\r\n`;
}
