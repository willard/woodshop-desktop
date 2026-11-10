/**
 * The one op vocabulary (§3.1). The editor's Inspector and the standalone plan viewer (D85)
 * both read it, so a shop drawing and the screen can never disagree about what a dado is.
 * Pure — no DOM, no Vue.
 */
import type { Op } from './types';
import { formatFraction } from '../lib/fraction';

/** Formats a decimal-inch measurement the way hard rule 3 requires — via lib/fraction, only. */
export const inch = (n: number): string => `${formatFraction(n)}"`;

/** One-line human summary per op row (§3.1 vocabulary). */
export function opSummary(op: Op): string {
    switch (op.type) {
        case 'dado':
        case 'groove':
            return (
                `${op.type} · ${op.face} · axis ${op.axis} · offset ${inch(op.offset)} · ` +
                `${inch(op.width)} × ${inch(op.depth)} deep` +
                (op.from !== undefined || op.to !== undefined ? ' · stopped' : '')
            );
        case 'rabbet':
            return `rabbet · edge ${op.edge} · ${inch(op.width)} × ${inch(op.depth)} deep`;
        case 'hole': {
            const label = op.purpose === 'dowel' ? 'dowel' : op.purpose === 'shelfPin' ? 'shelf pin' : 'hole';
            return (
                `${label} · ${op.face} · (${inch(op.x)}, ${inch(op.y)}) · ⌀${inch(op.diameter)} · ` +
                (op.depth === undefined ? 'through' : `${inch(op.depth)} deep`)
            );
        }
        case 'pocketHoles':
            return (
                `pocket screws · edge ${op.edge} × ${op.count}` +
                (op.length === undefined ? '' : ` · ${inch(op.length)}`) +
                (op.thread === undefined ? '' : ` ${op.thread}`)
            );
        case 'screws':
            return (
                `screws · ${op.gauge ?? '#8'} · ${op.face} face · ${op.axis} @ ${inch(op.offset)} × ${op.count}` +
                (op.length === undefined ? '' : ` · ${inch(op.length)}`)
            );
        case 'miter':
            return `miter · edge ${op.edge} · ${op.angle}°`;
        case 'curve':
            if (op.kind === 'arc') {
                return `curve · edge ${op.edge} · arc, ${inch(op.height)} high`;
            }
            if (op.kind === 'ramp') {
                return `curve · edge ${op.edge} · sweeps ${inch(op.height)} down toward ${op.low}`;
            }
            return op.corner === undefined
                ? `curve · edge ${op.edge} · corners rounded ${inch(op.radius)}`
                : `curve · edge ${op.edge} · ${op.corner} corner rounded ${inch(op.radius)}`;
        case 'notch':
            return `notch · edge ${op.edge} · ${inch(op.from)} → ${inch(op.to)} · ${inch(op.depth)} deep`;
        case 'ease': {
            const where = op.profile === 'bullnose' ? 'both faces' : (op.face ?? 'both faces');
            const size =
                op.profile === 'roundover'
                    ? `${inch(op.radius)} roundover`
                    : op.profile === 'chamfer'
                      ? `${inch(op.width)} chamfer`
                      : 'bullnose';
            const run =
                op.from === undefined && op.to === undefined
                    ? ''
                    : ` · ${inch(op.from ?? 0)} → ${op.to === undefined ? 'end' : inch(op.to)}`;
            return `ease · edge ${op.edge} · ${size} · ${where}${run}`;
        }
        default:
            return (op as { type: string }).type;
    }
}
