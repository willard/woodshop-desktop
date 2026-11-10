/**
 * Cohorts — the set of parts that behave as one unit in the editor.
 *
 * A group (spec 1.6) moves, rotates, and duplicates together; a door or drawer (spec 1.12) opens
 * together. Anything that acts on a part as a *thing the user sees* should act on its whole
 * cohort, or the unit comes apart: hide a drawer front on its own and the box is left hanging in
 * mid-air, which is not a view of anything.
 *
 * Pure spec logic — no three.js, no Vue. Cohorts are a presentation concern only; nothing here
 * changes the document (hard rule 1), and a part in no group and no movable is its own cohort.
 */
import type { Spec } from '../spec/types';
import { groupOf } from './commands/groups';
import { movableOf } from './commands/movables';

/**
 * Every part that moves with this one. Groups and movables are each flat, but a part may belong
 * to one of each, so both memberships are unioned rather than one winning.
 */
export function cohortOf(spec: Spec, partId: string): string[] {
    const ids = new Set<string>([partId]);
    for (const id of groupOf(spec, partId)?.partIds ?? []) {
        ids.add(id);
    }
    for (const id of movableOf(spec, partId)?.partIds ?? []) {
        ids.add(id);
    }
    return [...ids];
}

/** The union of several parts' cohorts, in spec order so the result is stable. */
export function cohortsOf(spec: Spec, partIds: Iterable<string>): string[] {
    const ids = new Set<string>();
    for (const partId of partIds) {
        for (const id of cohortOf(spec, partId)) {
            ids.add(id);
        }
    }
    return spec.parts.map((part) => part.id).filter((id) => ids.has(id));
}
