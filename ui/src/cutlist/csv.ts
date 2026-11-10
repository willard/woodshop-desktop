/**
 * The cut list as a spreadsheet: one row per distinct blank, grouped by material the way the
 * panel shows it. Sizes come twice — decimal inches for sorting and sums, shop fractions for the
 * bench — and the hardware follows the parts after a blank row.
 */
import type { CutList } from './types';
import { groupCutList } from './grouping';
import { formatFraction } from '@/lib/fraction';

const PART_HEADER = [
    'Material',
    'Part',
    'Qty',
    'Length (in)',
    'Width (in)',
    'Thickness (in)',
    'Size',
    'Board feet',
    'Notes',
];

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

function inches(value: number): string {
    return `${formatFraction(value)}"`;
}

export function cutListCsv(cutList: CutList): string {
    const lines = [row(PART_HEADER)];
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
                    decimal(group.length),
                    decimal(group.width),
                    decimal(group.thickness),
                    `${inches(group.length)} × ${inches(group.width)} × ${inches(group.thickness)}`,
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
