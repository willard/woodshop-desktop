import { describe, it, expect } from 'vitest';
import { overallSize } from '../geometry';
import type { Spec } from '../types';

/**
 * Every shipped template, keyed by file name — the same corpus buildScene's tests walk. Loaded
 * through Vite's glob rather than node:fs so this file stays inside the typecheck; the one spec
 * that does reach for Node globals (linter-parity) had to be excluded from tsconfig for it.
 */
const templates: Record<string, Spec> = Object.fromEntries(
    Object.entries(import.meta.glob('../../../../resources/templates/*.json', { eager: true })).map(
        ([path, mod]) => [path.split('/').pop()!.replace('.json', ''), (mod as { default: Spec }).default],
    ),
);

describe('overallSize', () => {
    /**
     * The same figures tests/Feature/SpecBoundsTest.php pins on the PHP side. Both implementations
     * union the same world AABB, so a divergence here means the editor and check_design would quote
     * different sizes for one design.
     */
    it('measures the assembled piece, matching the PHP contract', () => {
        expect(overallSize(templates['side-table'])).toEqual({ width: 18, depth: 18, height: 24 });
    });

    it('accounts for rotation, not just part sizes', () => {
        const spec = templates['side-table'];
        const original = overallSize(spec)!;
        const rotated = overallSize({
            ...spec,
            parts: spec.parts.map((part) =>
                part.id === 'p_top' ? { ...part, transform: { ...part.transform, rot: [0, 0, 0] } } : part,
            ),
        } as Spec)!;

        expect(rotated.height).toBeGreaterThan(original.height);
        expect(rotated.depth).toBeLessThan(original.depth);
    });

    it('is null for a spec with nothing in it', () => {
        expect(overallSize({ parts: [], materials: [] } as unknown as Spec)).toBeNull();
    });

    it('reports a plausible size for every template', () => {
        for (const [name, spec] of Object.entries(templates)) {
            const size = overallSize(spec);
            expect(size, name).not.toBeNull();
            expect(size!.width, name).toBeGreaterThan(0);
            expect(size!.depth, name).toBeGreaterThan(0);
            expect(size!.height, name).toBeGreaterThan(0);
        }
    });
});
