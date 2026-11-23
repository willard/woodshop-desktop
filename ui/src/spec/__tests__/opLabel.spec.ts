import { describe, it, expect } from 'vitest';
import { opSummary, inch } from '@/spec/opLabel';
import type { Op } from '@/spec';
import schema from '../../../../resources/spec.schema.json';

/**
 * Exact strings, not shapes. This vocabulary is what a maker reads off the Inspector and off a
 * printed plan (D85), so drift here is drift between the screen and the shop — pin it.
 */
const cases: ReadonlyArray<readonly [string, Op, string]> = [
    [
        'dado',
        { type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25 },
        'Dado 3/4" wide × 1/4" deep in the front face, running the length, 3" from the bottom edge',
    ],
    [
        'groove',
        { type: 'groove', face: 'back', axis: 'w', offset: 1.5, width: 0.25, depth: 0.375 },
        'Groove 1/4" wide × 3/8" deep in the back face, across the width, 1 1/2" from the left end',
    ],
    [
        'stopped dado',
        { type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25, from: 1, to: 8 },
        'Dado 3/4" wide × 1/4" deep in the front face, running the length, 3" from the bottom edge, stopped',
    ],
    [
        'stopped dado, only `to`',
        { type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25, to: 8 },
        'Dado 3/4" wide × 1/4" deep in the front face, running the length, 3" from the bottom edge, stopped',
    ],
    [
        'rabbet',
        { type: 'rabbet', edge: 'l0', width: 0.5, depth: 0.25 },
        'Rabbet 1/2" wide × 1/4" deep along the bottom edge',
    ],
    [
        'cutout',
        { type: 'cutout', face: 'front', x: 18, y: 12, length: 21.5, width: 6.75, radius: 0.5 },
        'Cutout 21 1/2" × 6 3/4", through, 1/2" corners, in the front face, centred 18" from the left end, 12" up',
    ],
    [
        'hole, through',
        { type: 'hole', face: 'front', x: 2, y: 3, diameter: 0.25 },
        'Hole ⌀ 1/4", through, in the front face, 2" from the left end, 3" up',
    ],
    [
        'hole, blind',
        { type: 'hole', face: 'front', x: 2, y: 3, diameter: 0.25, depth: 0.5 },
        'Hole ⌀ 1/4", 1/2" deep, in the front face, 2" from the left end, 3" up',
    ],
    [
        'dowel hole',
        { type: 'hole', face: 'back', x: 1, y: 1, diameter: 0.375, purpose: 'dowel', depth: 1 },
        'Dowel hole ⌀ 3/8", 1" deep, in the back face, 1" from the left end, 1" up',
    ],
    [
        'shelf-pin hole',
        { type: 'hole', face: 'front', x: 1, y: 6, diameter: 0.25, purpose: 'shelfPin', depth: 0.5 },
        'Shelf-pin hole ⌀ 1/4", 1/2" deep, in the front face, 1" from the left end, 6" up',
    ],
    [
        'pocket screws',
        { type: 'pocketHoles', edge: 'l0', count: 2 },
        '2 pocket screws through the bottom edge',
    ],
    [
        'pocket screws with length and thread',
        { type: 'pocketHoles', edge: 'w1', count: 3, length: 1.25, thread: 'coarse' },
        '3 pocket screws through the right end, 1 1/4" coarse thread',
    ],
    [
        'screws, default gauge',
        { type: 'screws', face: 'front', axis: 'l', offset: 0.375, count: 4 },
        '4 screws, #8, through the front face, 3/8" from the bottom edge',
    ],
    [
        'screws with gauge and length',
        { type: 'screws', face: 'back', axis: 'w', offset: 0.5, count: 2, gauge: '#6', length: 1.5 },
        '2 screws, #6 × 1 1/2", through the back face, 1/2" from the left end',
    ],
    ['miter', { type: 'miter', edge: 'l1', angle: 45 }, 'Miter 45° on the top edge'],
    ['curve, arc', { type: 'curve', edge: 'w0', kind: 'arc', height: 1.5 }, 'Arched left end, 1 1/2" high'],
    [
        'curve, ramp',
        { type: 'curve', edge: 'l0', kind: 'ramp', height: 2, low: 'w0' },
        'The bottom edge sweeps 2" down toward the left end',
    ],
    [
        'curve, taper on an end',
        { type: 'curve', edge: 'w1', kind: 'taper', height: 3.1875, low: 'l0' },
        'The right end is cut at an angle, 3 3/16" shorter along the bottom edge',
    ],
    [
        'curve, taper on an edge',
        { type: 'curve', edge: 'l0', kind: 'taper', height: 1, low: 'w0' },
        'The bottom edge tapers 1" in toward the left end',
    ],
    [
        'curve, round (both corners)',
        { type: 'curve', edge: 'l1', kind: 'round', radius: 0.75 },
        'Corners of the top edge rounded, 3/4" radius',
    ],
    [
        'curve, round (one corner)',
        { type: 'curve', edge: 'l1', kind: 'round', radius: 0.75, corner: 'w0' },
        'Corner rounded where the top edge meets the left end, 3/4" radius',
    ],
    [
        'notch',
        { type: 'notch', edge: 'w1', from: 2, to: 5.5, depth: 0.75 },
        'Notch in the right end, 3/4" deep, from 2" to 5 1/2"',
    ],
    [
        'ease, roundover',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.125 },
        '1/8" roundover on the bottom edge, both faces',
    ],
    [
        'ease, roundover on one face',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.125, face: 'front' },
        '1/8" roundover on the bottom edge, front face',
    ],
    [
        'ease, chamfer',
        { type: 'ease', edge: 'w1', profile: 'chamfer', width: 0.25 },
        '1/4" chamfer on the right end, both faces',
    ],
    [
        'ease, bullnose ignores face',
        { type: 'ease', edge: 'w0', profile: 'bullnose', face: 'front' },
        'Bullnose on the left end, both faces',
    ],
    [
        'stopped ease',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.25, from: 3, to: 9 },
        '1/4" roundover on the bottom edge, both faces, from 3" to 9"',
    ],
    [
        'stopped ease, open-ended run',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.25, from: 3 },
        '1/4" roundover on the bottom edge, both faces, from 3" to the end',
    ],
];

describe('opSummary', () => {
    it.each(cases)('describes %s', (_name, op, expected) => {
        expect(opSummary(op)).toBe(expected);
    });

    /**
     * The default arm returns the bare op type, which reads like a label but says nothing. Derive
     * the op list from the JSON Schema (the source of truth) so adding an op without a sentence
     * for it fails here rather than shipping "notch" as its own description.
     */
    it('has a real sentence for every op type in the schema', () => {
        const variants = schema.$defs.op.oneOf as ReadonlyArray<{
            properties: { type: { const?: string; enum?: readonly string[] } };
        }>;
        const types = new Set(
            variants.flatMap(({ properties: { type } }) =>
                type.const !== undefined ? [type.const] : [...(type.enum ?? [])],
            ),
        );
        expect(types.size).toBeGreaterThan(0);

        const described = new Set(cases.map(([, op]) => op.type));
        expect([...types].sort()).toEqual([...described].sort());

        for (const [, op, expected] of cases) {
            expect(expected).not.toBe(op.type);
        }
    });
});

describe('inch', () => {
    it('formats through lib/fraction only (hard rule 3)', () => {
        expect(inch(0.125)).toBe('1/8"');
        expect(inch(3)).toBe('3"');
        expect(inch(10.75)).toBe('10 3/4"');
    });
});
