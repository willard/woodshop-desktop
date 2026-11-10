/**
 * Part-level diff between two specs, keyed by part id — used to show what an AI edit changed and
 * to highlight the affected parts in the 3D view (build-plan §5). Pure; no Three.js/Vue.
 */
import type { Spec, Part } from '@/spec';

export interface SpecDiff {
    added: string[];
    removed: string[];
    changed: string[];
}

/** Stable key order so a reordered-but-equal part isn't reported as changed. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return '[' + value.map(canonical).join(',') + ']';
    }
    if (value !== null && typeof value === 'object') {
        return (
            '{' +
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
                .join(',') +
            '}'
        );
    }
    return JSON.stringify(value ?? null);
}

function partsEqual(a: Part, b: Part): boolean {
    return canonical(a) === canonical(b);
}

export function diffSpecs(before: Spec | null, after: Spec): SpecDiff {
    const beforeById = new Map((before?.parts ?? []).map((p) => [p.id, p]));
    const afterIds = new Set(after.parts.map((p) => p.id));

    const added: string[] = [];
    const changed: string[] = [];
    for (const part of after.parts) {
        const previous = beforeById.get(part.id);
        if (previous === undefined) {
            added.push(part.id);
        } else if (!partsEqual(previous, part)) {
            changed.push(part.id);
        }
    }

    const removed = (before?.parts ?? []).filter((p) => !afterIds.has(p.id)).map((p) => p.id);

    return { added, removed, changed };
}

/** Ids the user should see emphasised after an edit: everything new or modified. */
export function highlightedIds(diff: SpecDiff): string[] {
    return [...diff.added, ...diff.changed];
}
