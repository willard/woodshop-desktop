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
        'dado · front · axis l · offset 3" · 3/4" × 1/4" deep',
    ],
    [
        'groove',
        { type: 'groove', face: 'back', axis: 'w', offset: 1.5, width: 0.25, depth: 0.375 },
        'groove · back · axis w · offset 1 1/2" · 1/4" × 3/8" deep',
    ],
    [
        'stopped dado',
        { type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25, from: 1, to: 8 },
        'dado · front · axis l · offset 3" · 3/4" × 1/4" deep · stopped',
    ],
    [
        'stopped dado, only `to`',
        { type: 'dado', face: 'front', axis: 'l', offset: 3, width: 0.75, depth: 0.25, to: 8 },
        'dado · front · axis l · offset 3" · 3/4" × 1/4" deep · stopped',
    ],
    [
        'rabbet',
        { type: 'rabbet', edge: 'l0', width: 0.5, depth: 0.25 },
        'rabbet · edge l0 · 1/2" × 1/4" deep',
    ],
    [
        'hole, through',
        { type: 'hole', face: 'front', x: 2, y: 3, diameter: 0.25 },
        'hole · front · (2", 3") · ⌀1/4" · through',
    ],
    [
        'hole, blind',
        { type: 'hole', face: 'front', x: 2, y: 3, diameter: 0.25, depth: 0.5 },
        'hole · front · (2", 3") · ⌀1/4" · 1/2" deep',
    ],
    [
        'dowel hole',
        { type: 'hole', face: 'back', x: 1, y: 1, diameter: 0.375, purpose: 'dowel', depth: 1 },
        'dowel · back · (1", 1") · ⌀3/8" · 1" deep',
    ],
    [
        'shelf-pin hole',
        { type: 'hole', face: 'front', x: 1, y: 6, diameter: 0.25, purpose: 'shelfPin', depth: 0.5 },
        'shelf pin · front · (1", 6") · ⌀1/4" · 1/2" deep',
    ],
    ['pocket screws', { type: 'pocketHoles', edge: 'l0', count: 2 }, 'pocket screws · edge l0 × 2'],
    [
        'pocket screws with length and thread',
        { type: 'pocketHoles', edge: 'w1', count: 3, length: 1.25, thread: 'coarse' },
        'pocket screws · edge w1 × 3 · 1 1/4" coarse',
    ],
    [
        'screws, default gauge',
        { type: 'screws', face: 'front', axis: 'l', offset: 0.375, count: 4 },
        'screws · #8 · front face · l @ 3/8" × 4',
    ],
    [
        'screws with gauge and length',
        { type: 'screws', face: 'back', axis: 'w', offset: 0.5, count: 2, gauge: '#6', length: 1.5 },
        'screws · #6 · back face · w @ 1/2" × 2 · 1 1/2"',
    ],
    ['miter', { type: 'miter', edge: 'l1', angle: 45 }, 'miter · edge l1 · 45°'],
    [
        'curve, arc',
        { type: 'curve', edge: 'w0', kind: 'arc', height: 1.5 },
        'curve · edge w0 · arc, 1 1/2" high',
    ],
    [
        'curve, ramp',
        { type: 'curve', edge: 'l0', kind: 'ramp', height: 2, low: 'w0' },
        'curve · edge l0 · sweeps 2" down toward w0',
    ],
    [
        'curve, round (both corners)',
        { type: 'curve', edge: 'l1', kind: 'round', radius: 0.75 },
        'curve · edge l1 · corners rounded 3/4"',
    ],
    [
        'curve, round (one corner)',
        { type: 'curve', edge: 'l1', kind: 'round', radius: 0.75, corner: 'w0' },
        'curve · edge l1 · w0 corner rounded 3/4"',
    ],
    [
        'notch',
        { type: 'notch', edge: 'w1', from: 2, to: 5.5, depth: 0.75 },
        'notch · edge w1 · 2" → 5 1/2" · 3/4" deep',
    ],
    [
        'ease, roundover',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.125 },
        'ease · edge l0 · 1/8" roundover · both faces',
    ],
    [
        'ease, roundover on one face',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.125, face: 'front' },
        'ease · edge l0 · 1/8" roundover · front',
    ],
    [
        'ease, chamfer',
        { type: 'ease', edge: 'w1', profile: 'chamfer', width: 0.25 },
        'ease · edge w1 · 1/4" chamfer · both faces',
    ],
    [
        'ease, bullnose ignores face',
        { type: 'ease', edge: 'w0', profile: 'bullnose', face: 'front' },
        'ease · edge w0 · bullnose · both faces',
    ],
    [
        'stopped ease',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.25, from: 3, to: 9 },
        'ease · edge l0 · 1/4" roundover · both faces · 3" → 9"',
    ],
    [
        'stopped ease, open-ended run',
        { type: 'ease', edge: 'l0', profile: 'roundover', radius: 0.25, from: 3 },
        'ease · edge l0 · 1/4" roundover · both faces · 3" → end',
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
