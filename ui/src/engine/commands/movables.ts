/**
 * Commands for doors and drawers (§3.3, spec 1.12). Movables are annotations like groups: these
 * only ever touch `spec.movables`, never a part's transform. Opening one is a view-time
 * transform, not a command — nothing here makes a door swing.
 */
import type { Spec, Part, Movable } from '../../spec/types';
import type { Command } from './Command';

/** What a preset produces: the parts, the joinery holding them, and the movable itself. */
export interface MovableAddition {
    parts: Part[];
    joints: NonNullable<Spec['joints']>;
    movable: Movable;
}

/** The movable a part belongs to, if any (movables are flat — at most one). */
export function movableOf(spec: Spec, partId: string): Movable | null {
    return (spec.movables ?? []).find((m) => m.partIds.includes(partId)) ?? null;
}

/** Declares a set of existing parts a door or drawer. */
export class MakeMovable implements Command {
    readonly label = 'Make door or drawer';

    constructor(private readonly movable: Movable) {}

    do(spec: Spec): Spec {
        const known = new Set(spec.parts.map((p) => p.id));
        const claimed = new Set((spec.movables ?? []).flatMap((m) => m.partIds));
        const anchorId = this.movable.kind === 'door' ? this.movable.panelPartId : this.movable.frontPartId;

        // Defensive no-ops, matching GroupParts: an unknown part, a part already in another
        // movable, or an anchor that isn't a member would all be linter errors on arrival.
        if (
            this.movable.partIds.some((id: string) => !known.has(id) || claimed.has(id)) ||
            !this.movable.partIds.includes(anchorId)
        ) {
            return spec;
        }
        return { ...spec, movables: [...(spec.movables ?? []), this.movable] };
    }

    undo(spec: Spec): Spec {
        return {
            ...spec,
            movables: (spec.movables ?? []).filter((m) => m.id !== this.movable.id),
        };
    }
}

/** Dissolves a movable back into loose parts; the parts themselves are untouched. */
export class DissolveMovable implements Command {
    readonly label = 'Dissolve door or drawer';
    private removed?: { movable: Movable; index: number };

    constructor(private readonly movableId: string) {}

    do(spec: Spec): Spec {
        const movables = spec.movables ?? [];
        const index = movables.findIndex((m) => m.id === this.movableId);
        if (index === -1) {
            return spec;
        }
        this.removed = { movable: movables[index], index };
        return { ...spec, movables: movables.filter((m) => m.id !== this.movableId) };
    }

    undo(spec: Spec): Spec {
        const removed = this.removed;
        if (removed === undefined) {
            return spec;
        }
        const movables = [...(spec.movables ?? [])];
        movables.splice(removed.index, 0, removed.movable);
        return { ...spec, movables };
    }
}

/** Edits one movable's settings — its style, or which edge a door hinges on. */
export class UpdateMovable implements Command {
    readonly label = 'Edit door or drawer';
    private before?: Movable;

    constructor(
        private readonly movableId: string,
        private readonly patch: Partial<Movable>,
    ) {}

    do(spec: Spec): Spec {
        const movables = spec.movables ?? [];
        const current = movables.find((m) => m.id === this.movableId);
        if (current === undefined) {
            return spec;
        }
        this.before = current;
        return {
            ...spec,
            movables: movables.map((m) =>
                m.id === this.movableId ? ({ ...m, ...this.patch } as Movable) : m,
            ),
        };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return {
            ...spec,
            movables: (spec.movables ?? []).map((m) => (m.id === this.movableId ? before : m)),
        };
    }
}

/**
 * Adds a whole door or drawer — its parts, their joinery, and the annotation — as ONE undo step.
 * A drawer is five parts and six joints; undoing that in eleven presses would be absurd.
 */
export class AddMovable implements Command {
    readonly label = 'Add door or drawer';

    constructor(private readonly addition: MovableAddition) {}

    do(spec: Spec): Spec {
        return {
            ...spec,
            parts: [...spec.parts, ...this.addition.parts],
            joints: [...(spec.joints ?? []), ...this.addition.joints],
            movables: [...(spec.movables ?? []), this.addition.movable],
        };
    }

    undo(spec: Spec): Spec {
        const added = new Set(this.addition.parts.map((p) => p.id));
        return {
            ...spec,
            parts: spec.parts.filter((p) => !added.has(p.id)),
            // Every joint the addition brought touches one of its parts, so dropping by
            // membership also sweeps up any the user added to it afterwards — which is what
            // "undo the drawer" should mean.
            joints: (spec.joints ?? []).filter((j) => !added.has(j.hostPartId) && !added.has(j.insertPartId)),
            movables: (spec.movables ?? []).filter((m) => m.id !== this.addition.movable.id),
        };
    }
}
