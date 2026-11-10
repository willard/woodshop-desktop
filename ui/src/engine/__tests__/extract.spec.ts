import { describe, it, expect } from 'vitest';
import { extractParts } from '@/engine/extract';
import { RecenterAssembly } from '@/engine/commands';
import { parseSpec, safeParseSpec } from '@/spec';
import type { Spec } from '@/spec';
import nightstandJson from '../../../../resources/templates/nightstand.json';

const nightstand = (): Spec => parseSpec(nightstandJson);

describe('extractParts', () => {
    const source = nightstand();
    const drawer = source.movables![0];

    it('lifts a drawer out with its materials, inner joints and the movable itself', () => {
        const out = extractParts(source, drawer.partIds, 'Drawer box');
        expect(out.name).toBe('Drawer box');
        expect(out.parts.map((p) => p.id).sort()).toEqual([...drawer.partIds].sort());
        expect(out.movables).toEqual([drawer]);

        const used = new Set(out.parts.map((p) => p.materialId));
        expect(out.materials.map((m) => m.id).sort()).toEqual([...used].sort());

        const ids = new Set(drawer.partIds);
        const inner = (source.joints ?? []).filter((j) => ids.has(j.hostPartId) && ids.has(j.insertPartId));
        expect(out.joints).toEqual(inner);
        expect(out.meta).toBeUndefined();
        expect(safeParseSpec(out).success).toBe(true);
    });

    it('recentres the piece: centred on X/Z, resting on the floor', () => {
        const out = extractParts(source, drawer.partIds, 'Drawer box');
        expect(RecenterAssembly.deltaFor(out)).toEqual([0, 0, 0]);
        // Same shape, only moved: relative offsets between parts are unchanged.
        const [a, b] = drawer.partIds.map(
            (id: string) => source.parts.find((p) => p.id === id)!.transform.pos,
        );
        const [a2, b2] = drawer.partIds.map(
            (id: string) => out.parts.find((p) => p.id === id)!.transform.pos,
        );
        expect(b2[0] - a2[0]).toBeCloseTo(b[0] - a[0]);
        expect(b2[1] - a2[1]).toBeCloseTo(b[1] - a[1]);
    });

    it('drops a movable, joint or group that only partly came along', () => {
        const withGroups: Spec = {
            ...source,
            groups: [
                { id: 'g_drawer', name: 'Drawer', partIds: [...drawer.partIds] },
                { id: 'g_pair', partIds: drawer.partIds.slice(0, 2) },
            ],
        };
        const some = drawer.partIds.slice(0, 2);
        const out = extractParts(withGroups, some, 'Two parts');
        expect(out.movables).toEqual([]);
        expect(out.joints!.every((j) => some.includes(j.hostPartId) && some.includes(j.insertPartId))).toBe(
            true,
        );
        // The pair group holds every extracted part, so it would only wrap the new design.
        expect(out.groups).toEqual([]);

        const whole = extractParts(withGroups, drawer.partIds, 'Drawer box');
        expect(whole.groups!.map((g) => g.id)).toEqual(['g_pair']);
    });

    it('leaves the source design untouched', () => {
        const before = structuredClone(source);
        extractParts(source, drawer.partIds, 'Drawer box');
        expect(source).toEqual(before);
    });

    it('refuses an empty selection', () => {
        expect(() => extractParts(source, ['nope'], 'x')).toThrow(/at least one part/);
    });
});
