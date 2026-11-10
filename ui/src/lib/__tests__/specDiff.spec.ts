import { describe, it, expect } from 'vitest';
import { diffSpecs, highlightedIds } from '@/lib/specDiff';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function base(): Spec {
    return parseSpec(recordStand);
}

describe('diffSpecs', () => {
    it('reports no changes for an identical spec', () => {
        const spec = base();
        expect(diffSpecs(spec, structuredClone(spec))).toEqual({ added: [], removed: [], changed: [] });
    });

    it('reports an added part', () => {
        const before = base();
        const after = structuredClone(before);
        after.parts.push({ ...after.parts[0], id: 'p_new' });
        const diff = diffSpecs(before, after);
        expect(diff.added).toEqual(['p_new']);
        expect(diff.changed).toEqual([]);
        expect(diff.removed).toEqual([]);
    });

    it('reports a removed part', () => {
        const before = base();
        const after = structuredClone(before);
        const removedId = after.parts[0].id;
        after.parts.shift();
        expect(diffSpecs(before, after).removed).toContain(removedId);
    });

    it('reports a changed part but ignores key reordering', () => {
        const before = base();
        const after = structuredClone(before);
        after.parts[1].size = { l: 99, w: after.parts[1].size.w };
        const diff = diffSpecs(before, after);
        expect(diff.changed).toEqual([after.parts[1].id]);
    });

    it('treats a null before-spec as everything added', () => {
        const after = base();
        expect(diffSpecs(null, after).added).toHaveLength(after.parts.length);
    });

    it('highlightedIds merges added and changed', () => {
        expect(highlightedIds({ added: ['a'], changed: ['b'], removed: ['c'] })).toEqual(['a', 'b']);
    });
});
