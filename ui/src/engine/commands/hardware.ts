/**
 * Catalog hardware commands (spec 1.15), and the helpers that keep mounted hardware in step with
 * the parts it is screwed to: delete a part and its hardware goes with it (and comes back on
 * undo); duplicate a part and the copy carries copies.
 */
import type { HardwareMount, Spec } from '../../spec/types';
import type { Command } from './Command';

/** A hardware id not already used in the spec: `hw_<item>` with a counter when taken. */
export function uniqueHardwareId(spec: Spec, item: string, alsoTaken: Iterable<string> = []): string {
    const used = new Set([...(spec.hardware ?? []).map((h) => h.id), ...alsoTaken]);
    const slug = item.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const stem = `hw_${slug || 'item'}`.slice(0, 34);
    let candidate = stem;
    for (let n = 2; used.has(candidate); n += 1) {
        candidate = `${stem}_${n}`;
    }
    return candidate;
}

/** Mounts removed from a spec, with where each sat, so an undo restores the exact order. */
export type DetachedHardware = { mount: HardwareMount; index: number }[];

/** The spec's hardware without anything mounted on `partIds`, and what was taken off. */
export function detachHardware(
    spec: Spec,
    partIds: ReadonlySet<string>,
): { next: HardwareMount[]; detached: DetachedHardware } {
    const detached: DetachedHardware = [];
    const next: HardwareMount[] = [];
    (spec.hardware ?? []).forEach((mount, index) => {
        if (partIds.has(mount.partId)) detached.push({ mount, index });
        else next.push(mount);
    });
    return { next, detached };
}

export function reattachHardware(spec: Spec, detached: DetachedHardware): HardwareMount[] {
    const hardware = [...(spec.hardware ?? [])];
    for (const { mount, index } of detached) {
        hardware.splice(index, 0, mount);
    }
    return hardware;
}

/** Copies of every mount on a cloned part, re-pointed at the clone, with fresh ids. */
export function cloneHardware(spec: Spec, idMap: ReadonlyMap<string, string>): HardwareMount[] {
    const clones: HardwareMount[] = [];
    for (const mount of spec.hardware ?? []) {
        const partId = idMap.get(mount.partId);
        if (partId === undefined) continue;
        const id = uniqueHardwareId(
            spec,
            mount.item,
            clones.map((c) => c.id),
        );
        clones.push({ ...mount, id, partId });
    }
    return clones;
}

export class AddHardware implements Command {
    readonly label = 'Add hardware';
    constructor(private readonly mount: HardwareMount) {}

    do(spec: Spec): Spec {
        if ((spec.hardware ?? []).some((h) => h.id === this.mount.id)) {
            return spec;
        }
        return { ...spec, hardware: [...(spec.hardware ?? []), this.mount] };
    }

    undo(spec: Spec): Spec {
        return { ...spec, hardware: (spec.hardware ?? []).filter((h) => h.id !== this.mount.id) };
    }
}

export type HardwarePatch = Partial<Pick<HardwareMount, 'item' | 'side' | 'x' | 'y' | 'rot'>>;

export class UpdateHardware implements Command {
    readonly label = 'Edit hardware';
    private before?: HardwareMount;

    constructor(
        private readonly id: string,
        private readonly patch: HardwarePatch,
    ) {}

    do(spec: Spec): Spec {
        const current = (spec.hardware ?? []).find((h) => h.id === this.id);
        if (current === undefined) {
            return spec;
        }
        const next = { ...current, ...this.patch };
        if ((Object.keys(this.patch) as (keyof HardwarePatch)[]).every((k) => current[k] === next[k])) {
            return spec; // nothing changed: no undo entry
        }
        this.before = current;
        return { ...spec, hardware: (spec.hardware ?? []).map((h) => (h.id === this.id ? next : h)) };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return { ...spec, hardware: (spec.hardware ?? []).map((h) => (h.id === this.id ? before : h)) };
    }
}

export class RemoveHardware implements Command {
    readonly label = 'Remove hardware';
    private removed?: { mount: HardwareMount; index: number };

    constructor(private readonly id: string) {}

    do(spec: Spec): Spec {
        const hardware = spec.hardware ?? [];
        const index = hardware.findIndex((h) => h.id === this.id);
        if (index === -1) {
            return spec;
        }
        this.removed = { mount: hardware[index], index };
        return { ...spec, hardware: hardware.filter((h) => h.id !== this.id) };
    }

    undo(spec: Spec): Spec {
        return this.removed === undefined
            ? spec
            : { ...spec, hardware: reattachHardware(spec, [this.removed]) };
    }
}
