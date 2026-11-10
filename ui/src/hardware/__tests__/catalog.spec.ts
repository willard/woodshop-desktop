import { describe, it, expect } from 'vitest';
import { wasm } from '@/domain';
import {
    catalog,
    findItem,
    itemsForRole,
    mountFrame,
    DEFAULT_HINGE,
    DEFAULT_PULL,
    DEFAULT_SLIDE,
} from '@/hardware/catalog';
import type { HardwareMount, Part } from '@/spec/types';

describe('hardware catalog', () => {
    it('comes from the core with every item addressable', () => {
        const c = catalog();
        expect(c.items.length).toBeGreaterThanOrEqual(60);
        expect(c.categories.map((x) => x.id)).toContain('pulls');
        expect(findItem('pull.bar-96mm')?.role).toBe('pull');
        expect(findItem('nope')).toBeUndefined();
        for (const id of [DEFAULT_PULL, DEFAULT_SLIDE, DEFAULT_HINGE.overlay, DEFAULT_HINGE.inset]) {
            expect(findItem(id), id).toBeDefined();
        }
        expect(itemsForRole('slide').every((i) => i.placeable === false)).toBe(true);
    });

    it('places mounts exactly where the core does, on all six sides', () => {
        const part = {
            id: 'p_a',
            name: 'A',
            materialId: 'm',
            size: { l: 24, w: 10 },
            transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        } as unknown as Part;
        for (const side of ['front', 'back', 'l0', 'l1', 'w0', 'w1'] as const) {
            const mount = {
                id: 'hw_1',
                item: 'pull.bar-96mm',
                partId: 'p_a',
                side,
                x: 3,
                y: 0.25,
            } as HardwareMount;
            expect(mountFrame(part, 0.75, mount), side).toEqual(wasm.hardwareMountFrame(part, 0.75, mount));
        }
    });
});
