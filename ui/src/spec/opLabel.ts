/**
 * The one op vocabulary (§3.1). The editor's Inspector and the standalone plan viewer (D85)
 * both read it, so a shop drawing and the screen can never disagree about what a dado is.
 * Pure — no DOM, no Vue.
 */
import type { Op } from './types';
import { len } from '@/lib/display';

/** Formats a decimal-inch measurement the way hard rule 3 requires — via lib/fraction, only. */
export const inch = (n: number): string => `${len(n)}`;

/** The four edges and two faces of a part as drawn face-on (§3.1: l runs left to right). */
const EDGE: Record<string, string> = { l0: 'bottom edge', l1: 'top edge', w0: 'left end', w1: 'right end' };
const edgeName = (edge: string): string => EDGE[edge] ?? edge;
const faceName = (face: string): string => `${face} face`;
const many = (n: number, one: string, more = `${one}s`): string => `${n} ${n === 1 ? one : more}`;

/**
 * One line a woodworker can read: what the cut is, how big, and where (§3.1 vocabulary, in shop
 * words). The editor's inspector and the offline plan viewer both read it, so the screen and the
 * printed plan can never disagree.
 */
export function opSummary(op: Op): string {
    switch (op.type) {
        case 'dado':
        case 'groove': {
            const name = op.type === 'dado' ? 'Dado' : 'Groove';
            const runs = op.axis === 'l' ? 'running the length' : 'across the width';
            const from = op.axis === 'l' ? 'bottom edge' : 'left end';
            const stopped = op.from !== undefined || op.to !== undefined ? ', stopped' : '';
            return `${name} ${inch(op.width)} wide × ${inch(op.depth)} deep in the ${faceName(op.face)}, ${runs}, ${inch(op.offset)} from the ${from}${stopped}`;
        }
        case 'rabbet':
            return `Rabbet ${inch(op.width)} wide × ${inch(op.depth)} deep along the ${edgeName(op.edge)}`;
        case 'hole': {
            const name =
                op.purpose === 'dowel' ? 'Dowel hole' : op.purpose === 'shelfPin' ? 'Shelf-pin hole' : 'Hole';
            const depth = op.depth === undefined ? 'through' : `${inch(op.depth)} deep`;
            return `${name} ⌀ ${inch(op.diameter)}, ${depth}, in the ${faceName(op.face)}, ${inch(op.x)} from the left end, ${inch(op.y)} up`;
        }
        case 'pocketHoles':
            return (
                `${many(op.count, 'pocket screw')} through the ${edgeName(op.edge)}` +
                (op.length === undefined ? '' : `, ${inch(op.length)}`) +
                (op.thread === undefined ? '' : ` ${op.thread} thread`)
            );
        case 'screws':
            return (
                `${many(op.count, 'screw')}, ${op.gauge ?? '#8'}` +
                (op.length === undefined ? '' : ` × ${inch(op.length)}`) +
                `, through the ${faceName(op.face)}, ${inch(op.offset)} from the ${op.axis === 'l' ? 'bottom edge' : 'left end'}`
            );
        case 'miter':
            return `Miter ${op.angle}° on the ${edgeName(op.edge)}`;
        case 'curve':
            if (op.kind === 'arc') {
                return `Arched ${edgeName(op.edge)}, ${inch(op.height)} high`;
            }
            if (op.kind === 'ramp') {
                return `The ${edgeName(op.edge)} sweeps ${inch(op.height)} down toward the ${edgeName(op.low)}`;
            }
            return op.corner === undefined
                ? `Corners of the ${edgeName(op.edge)} rounded, ${inch(op.radius)} radius`
                : `Corner rounded where the ${edgeName(op.edge)} meets the ${edgeName(op.corner)}, ${inch(op.radius)} radius`;
        case 'notch':
            return `Notch in the ${edgeName(op.edge)}, ${inch(op.depth)} deep, from ${inch(op.from)} to ${inch(op.to)}`;
        case 'ease': {
            const where =
                op.profile === 'bullnose'
                    ? 'both faces'
                    : op.face === undefined
                      ? 'both faces'
                      : faceName(op.face);
            const size =
                op.profile === 'roundover'
                    ? `${inch(op.radius)} roundover`
                    : op.profile === 'chamfer'
                      ? `${inch(op.width)} chamfer`
                      : 'Bullnose';
            const run =
                op.from === undefined && op.to === undefined
                    ? ''
                    : `, from ${inch(op.from ?? 0)} to ${op.to === undefined ? 'the end' : inch(op.to)}`;
            return `${size} on the ${edgeName(op.edge)}, ${where}${run}`;
        }
        default:
            return (op as { type: string }).type;
    }
}
