import { describe, it, expect } from 'vitest';
import { parseSpec, type Spec } from '@/spec';
import { lintSpec } from '@/spec/linter';
import corpus from '@fixtures/lint-cases.json';

/**
 * A row of screws driven down through a shelf into a rail below it.
 *
 * `railLength` decides how many of them land: the screws sit at x = −10, 0 and +10, so a 24" rail
 * catches all three and an 8.5" one catches only the middle.
 *
 * The gap this covers: `fastenerMates` asked whether ANY screw bit, so one landing satisfied every
 * fastening rule and a row hanging off the end of its mate produced complete silence — not a
 * misleading message, no message at all. A second reviewer flagged the wording; the real defect was
 * that the case was never reported.
 */
function shelfOnRail(railLength: number, count = 3): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'partial miss',
        materials: [
            { id: 'mat_a', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
            { id: 'mat_b', type: 'lumber', name: 'Pine', thickness: 3, stockWidth: 8, stockLengths: [96] },
        ],
        parts: [
            {
                id: 'p_top',
                name: 'Top Shelf',
                materialId: 'mat_a',
                size: { l: 24, w: 8 },
                transform: { pos: [0, 10, 0], rot: [90, 0, 0] },
                // rot [90,0,0] puts local +Z on world +Y, so `back` drives the screws DOWN.
                ops: [{ type: 'screws', face: 'back', axis: 'l', offset: 4, count, from: 2, to: 22 }],
            },
            {
                id: 'p_rail',
                name: 'Back Rail',
                materialId: 'mat_b',
                size: { l: railLength, w: 8 },
                transform: { pos: [0, 8.5, 0], rot: [90, 0, 0] },
            },
        ],
        joints: [{ id: 'j0', type: 'screw', hostPartId: 'p_top', insertPartId: 'p_rail', opRef: 0 }],
    }) as Spec;
}

const partialMiss = (spec: Spec) => lintSpec(spec).find((i) => i.code === 'op.fastener-partial-miss');

describe('op.fastener-partial-miss', () => {
    it('says nothing when every screw lands', () => {
        expect(partialMiss(shelfOnRail(24))).toBeUndefined();
    });

    it('reports the two screws hanging off the end of a short rail', () => {
        const issue = partialMiss(shelfOnRail(8.5));

        expect(issue?.severity).toBe('warn');
        expect(issue?.partId).toBe('p_top');
        expect(issue?.opIndex).toBe(0);
        expect(issue?.message).toContain('2 of 3 screws');
    });

    it('names the run that did land, so the fix is a from/to you can paste', () => {
        // A 16" rail catches the middle two of four screws.
        const issue = partialMiss(shelfOnRail(16, 4));

        expect(issue?.message).toContain('from: 8.667, to: 15.333');
    });

    it('does not suggest a zero-length run when only one screw landed', () => {
        const issue = partialMiss(shelfOnRail(8.5));

        // from: 12, to: 12 is not a row — the schema rejects it and a shop would laugh.
        expect(issue?.message).not.toContain('to: 12');
        expect(issue?.message).toContain('Move the mate under the row');
    });

    it('stays out of the way when the whole row misses — that is the other rule', () => {
        // The rail moved out from under the shelf entirely.
        const spec = shelfOnRail(24);
        spec.parts[1].transform.pos = [0, 8.5, 40];

        const codes = lintSpec(spec).map((i) => i.code);

        expect(codes).toContain('op.fastener-no-mate');
        expect(codes).not.toContain('op.fastener-partial-miss');
    });

    /**
     * The corpus is shared with the PHP mirror; these two cases live there so both runtimes are
     * pinned to the same verdict, not just to the same code path.
     */
    it('matches the shared corpus the PHP linter is held to', () => {
        const cases = corpus as unknown as Record<string, unknown>;

        expect(partialMiss(parseSpec(cases['fastener-row-fully-lands']))).toBeUndefined();
        expect(partialMiss(parseSpec(cases['fastener-row-partial-miss']))).toBeDefined();
    });
});
