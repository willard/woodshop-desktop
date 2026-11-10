import { describe, it, expect } from 'vitest';
import { enterFocusMode, exitFocusMode } from '../focus';
import { parseSpec, type Spec } from '@/spec';
import { lintSpec } from '@/spec/linter';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function baseSpec(): Spec {
    const spec = parseSpec(structuredClone(recordStand));
    // Create a group containing the first two parts
    spec.groups = [
        {
            id: 'g_test',
            partIds: [spec.parts[0].id, spec.parts[1].id],
        },
    ];
    return spec;
}

describe('focus mode', () => {
    it('enters and exits focus mode without modifications cleanly', () => {
        const main = baseSpec();
        const state = enterFocusMode(main, 'g_test');
        expect(state).not.toBeNull();
        if (!state) return;

        const result = exitFocusMode(main, state.focusSpec, 'g_test', state.offset);
        expect(result.parts.length).toBe(main.parts.length);
        expect(lintSpec(result).filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('disambiguates duplicate part ids when exiting focus mode', () => {
        const main = baseSpec();
        const state = enterFocusMode(main, 'g_test');
        expect(state).not.toBeNull();
        if (!state) return;

        // Simulate creating a part inside focus mode whose ID collides with a part outside the group
        const outsidePart = main.parts[2];
        const collidingPart = {
            ...state.focusSpec.parts[0],
            id: outsidePart.id, // Collides with part 2 in main
            name: 'Colliding Copy',
        };
        state.focusSpec.parts.push(collidingPart);
        state.focusSpec.groups![0].partIds.push(outsidePart.id);

        const result = exitFocusMode(main, state.focusSpec, 'g_test', state.offset);

        // Check that all part IDs in result are strictly unique
        const ids = result.parts.map((p) => p.id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);

        // The colliding part in the group should have received a new unique ID
        const group = result.groups!.find((g) => g.id === 'g_test')!;
        expect(group.partIds).toHaveLength(3);
        const newPartId = group.partIds[2];
        expect(newPartId).not.toBe(outsidePart.id);
        expect(result.parts.some((p) => p.id === newPartId)).toBe(true);
        expect(result.parts.some((p) => p.id === outsidePart.id)).toBe(true);

        // No duplicate ID lint errors
        const duplicateIssues = lintSpec(result).filter((i) => i.code === 'part.duplicate-id');
        expect(duplicateIssues).toEqual([]);
    });
});
