/**
 * Prop commands (spec 1.22): things shown with the piece but not built, such as the totes on a
 * tote rack. They reference no part, so nothing else has to follow them; each is one undo step.
 */
import type { Prop, Spec } from '../../spec/types';
import type { Command } from './Command';

/** A prop id not already used in the spec: `pr_<item>` with a counter when taken. */
export function uniquePropId(spec: Spec, item: string): string {
    const used = new Set((spec.props ?? []).map((p) => p.id));
    const slug = item
        .replace(/^prop\./, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const stem = `pr_${slug || 'item'}`.slice(0, 34);
    let candidate = stem;
    for (let n = 2; used.has(candidate); n += 1) {
        candidate = `${stem}_${n}`;
    }
    return candidate;
}

export class AddProp implements Command {
    readonly label = 'Add a prop';
    constructor(private readonly prop: Prop) {}

    do(spec: Spec): Spec {
        if ((spec.props ?? []).some((p) => p.id === this.prop.id)) {
            return spec;
        }
        return { ...spec, props: [...(spec.props ?? []), this.prop] };
    }

    undo(spec: Spec): Spec {
        return { ...spec, props: (spec.props ?? []).filter((p) => p.id !== this.prop.id) };
    }
}

/** What can change on a prop; `color`/`accent` set to `undefined` go back to the catalog's. */
export type PropPatch = Partial<Pick<Prop, 'item' | 'name' | 'pos' | 'rot' | 'color' | 'accent'>>;

export class UpdateProp implements Command {
    readonly label = 'Edit a prop';
    private before?: Prop;

    constructor(
        private readonly id: string,
        private readonly patch: PropPatch,
    ) {}

    do(spec: Spec): Spec {
        const current = (spec.props ?? []).find((p) => p.id === this.id);
        if (current === undefined) {
            return spec;
        }
        const next: Prop = { ...current, ...this.patch };
        for (const key of ['name', 'color', 'accent'] as const) {
            if (next[key] === undefined) delete next[key];
        }
        if (JSON.stringify(next) === JSON.stringify(current)) {
            return spec; // nothing changed: no undo entry
        }
        this.before = current;
        return { ...spec, props: (spec.props ?? []).map((p) => (p.id === this.id ? next : p)) };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return { ...spec, props: (spec.props ?? []).map((p) => (p.id === this.id ? before : p)) };
    }
}

export class RemoveProp implements Command {
    readonly label = 'Remove a prop';
    private removed?: { prop: Prop; index: number };

    constructor(private readonly id: string) {}

    do(spec: Spec): Spec {
        const props = spec.props ?? [];
        const index = props.findIndex((p) => p.id === this.id);
        if (index === -1) {
            return spec;
        }
        this.removed = { prop: props[index], index };
        return { ...spec, props: props.filter((p) => p.id !== this.id) };
    }

    undo(spec: Spec): Spec {
        if (this.removed === undefined) {
            return spec;
        }
        const props = [...(spec.props ?? [])];
        props.splice(this.removed.index, 0, this.removed.prop);
        return { ...spec, props };
    }
}
