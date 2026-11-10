/**
 * Group commands (spec 1.6) — the "explicit multi-transform commands" hard rule 7 reserves
 * for assemblies. Each op is ONE undo step and uses the recorded-plan pattern (the plan is
 * computed on the first do() and replayed verbatim on redo, so history is deterministic).
 * Groups are annotations: only Move/Rotate touch transforms, and they do so explicitly.
 */
import * as THREE from 'three';
import type { Spec, Part, Joint, Group, Movable, Vec3 } from '../../spec/types';
import { type Command, uniquePartIdFrom, uniqueGroupId, uniqueMovableId } from './Command';
import { aabbFromPart } from '../snapping';
import { exitFocusMode } from '../focus';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** The group a part belongs to, if any (groups are flat — at most one). */
export function groupOf(spec: Spec, partId: string): Group | null {
    return (spec.groups ?? []).find((g) => g.partIds.includes(partId)) ?? null;
}

/** Creates a group over existing, ungrouped parts. */
export class GroupParts implements Command {
    readonly label = 'Group parts';

    constructor(
        private readonly groupId: string,
        private readonly partIds: string[],
        private readonly name?: string,
    ) {}

    do(spec: Spec): Spec {
        const known = new Set(spec.parts.map((p) => p.id));
        const grouped = new Set((spec.groups ?? []).flatMap((g) => g.partIds));
        if (this.partIds.some((id) => !known.has(id) || grouped.has(id))) {
            return spec; // defensive no-op: unknown part, or flat-groups violation
        }
        const group: Group = {
            id: this.groupId,
            partIds: [...this.partIds],
            ...(this.name === undefined ? {} : { name: this.name }),
        };
        return { ...spec, groups: [...(spec.groups ?? []), group] };
    }

    undo(spec: Spec): Spec {
        return { ...spec, groups: (spec.groups ?? []).filter((g) => g.id !== this.groupId) };
    }
}

/** Dissolves a group, leaving its parts untouched. */
export class UngroupParts implements Command {
    readonly label = 'Ungroup';
    private removed?: { group: Group; index: number };

    constructor(private readonly groupId: string) {}

    do(spec: Spec): Spec {
        const groups = spec.groups ?? [];
        const index = groups.findIndex((g) => g.id === this.groupId);
        if (index === -1) {
            return spec;
        }
        this.removed = { group: groups[index], index };
        return { ...spec, groups: groups.filter((g) => g.id !== this.groupId) };
    }

    undo(spec: Spec): Spec {
        const removed = this.removed;
        if (removed === undefined) {
            return spec;
        }
        const groups = [...(spec.groups ?? [])];
        groups.splice(removed.index, 0, removed.group);
        return { ...spec, groups };
    }
}

/** Translates several parts by one shared delta — a group drag is a single undo step. */
export class MoveParts implements Command {
    readonly label = 'Move parts';
    private before?: Map<string, { pos: number[]; locked: boolean }>;

    constructor(
        private readonly partIds: string[],
        private readonly delta: Vec3,
    ) {}

    do(spec: Spec): Spec {
        const ids = new Set(this.partIds);
        const before = (this.before ??= new Map());
        return {
            ...spec,
            parts: spec.parts.map((p) => {
                if (!ids.has(p.id)) {
                    return p;
                }
                if (!before.has(p.id)) {
                    before.set(p.id, { pos: [...p.transform.pos], locked: p.locked });
                }
                const [x, y, z] = p.transform.pos;
                return {
                    ...p,
                    transform: {
                        ...p.transform,
                        pos: [x + this.delta[0], y + this.delta[1], z + this.delta[2]],
                    },
                    locked: true,
                };
            }),
        };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return {
            ...spec,
            parts: spec.parts.map((p) => {
                const prev = before.get(p.id);
                return prev === undefined
                    ? p
                    : { ...p, transform: { ...p.transform, pos: [...prev.pos] }, locked: prev.locked };
            }),
        };
    }
}

/**
 * Rotates several parts by `angleDeg` (default 90°) about a world axis through the cohort's
 * AABB centre — the rigid-body group rotate. Positions orbit the centre; orientations are
 * composed with the same quaternion convention the renderer uses (Euler 'XYZ'), so the
 * result is exact and always within the schema's ±180 bounds.
 */
export class RotateParts implements Command {
    readonly label = 'Rotate parts';
    private plan?: Map<string, { pos: number[]; rot: number[]; locked: boolean }>;
    private next?: Map<string, { pos: number[]; rot: number[] }>;

    constructor(
        private readonly partIds: string[],
        private readonly axis: 0 | 1 | 2,
        private readonly angleDeg: number = 90,
    ) {}

    do(spec: Spec): Spec {
        const ids = new Set(this.partIds);
        const members = spec.parts.filter((p) => ids.has(p.id));
        if (members.length === 0) {
            return spec;
        }
        if (this.plan === undefined) {
            const thickness = new Map(spec.materials.map((m) => [m.id, m.thickness]));
            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (const part of members) {
                const box = aabbFromPart(part, thickness.get(part.materialId) ?? 0);
                for (let i = 0; i < 3; i += 1) {
                    min[i] = Math.min(min[i], box.min[i]);
                    max[i] = Math.max(max[i], box.max[i]);
                }
            }
            const centre = new THREE.Vector3(
                (min[0] + max[0]) / 2,
                (min[1] + max[1]) / 2,
                (min[2] + max[2]) / 2,
            );
            const axisVec = new THREE.Vector3(
                this.axis === 0 ? 1 : 0,
                this.axis === 1 ? 1 : 0,
                this.axis === 2 ? 1 : 0,
            );
            const R = new THREE.Quaternion().setFromAxisAngle(axisVec, this.angleDeg * DEG2RAD);

            this.plan = new Map();
            this.next = new Map();
            for (const part of members) {
                this.plan.set(part.id, {
                    pos: [...part.transform.pos],
                    rot: [...part.transform.rot],
                    locked: part.locked,
                });
                const pos = new THREE.Vector3(...part.transform.pos)
                    .sub(centre)
                    .applyQuaternion(R)
                    .add(centre);
                const [rx, ry, rz] = part.transform.rot;
                const q = new THREE.Quaternion()
                    .setFromEuler(new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ'))
                    .premultiply(R);
                const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');
                const clamp = (v: number): number => Math.min(180, Math.max(-180, round(v * RAD2DEG)));
                this.next.set(part.id, {
                    pos: [round(pos.x), round(pos.y), round(pos.z)],
                    rot: [clamp(euler.x), clamp(euler.y), clamp(euler.z)],
                });
            }
        }
        const next = this.next!;
        return {
            ...spec,
            parts: spec.parts.map((p) => {
                const target = next.get(p.id);
                return target === undefined
                    ? p
                    : {
                          ...p,
                          transform: { ...p.transform, pos: [...target.pos], rot: [...target.rot] },
                          locked: true,
                      };
            }),
        };
    }

    undo(spec: Spec): Spec {
        const plan = this.plan;
        if (plan === undefined) {
            return spec;
        }
        return {
            ...spec,
            parts: spec.parts.map((p) => {
                const prev = plan.get(p.id);
                return prev === undefined
                    ? p
                    : {
                          ...p,
                          transform: { ...p.transform, pos: [...prev.pos], rot: [...prev.rot] },
                          locked: prev.locked,
                      };
            }),
        };
    }
}

/** Kills float dust (−1.2e-14 → 0) so specs stay tidy and comparisons stable. */
function round(value: number): number {
    return Math.round(value * 1e9) / 1e9;
}

/** What a part removal did to the spec's movables, recorded for an order-exact undo. */
export interface MovableCascade {
    next: Movable[];
    dissolved: { movable: Movable; index: number }[];
    shrunk: { movableId: string; partIds: string[] }[];
}

/**
 * Deleting a part out of a door or drawer (§3.3). Losing the anchor — the panel a door hinges on,
 * the front a drawer pulls by — dissolves the movable: there is no motion left to describe.
 * Losing any other member just shrinks it, down to the anchor alone (unlike a group, a
 * single-part movable is legitimate — most doors are one panel).
 */
export function cascadeMovables(spec: Spec, removedIds: ReadonlySet<string>): MovableCascade {
    const dissolved: { movable: Movable; index: number }[] = [];
    const shrunk: { movableId: string; partIds: string[] }[] = [];
    const next: Movable[] = [];

    (spec.movables ?? []).forEach((movable, index) => {
        const remaining = movable.partIds.filter((id: string) => !removedIds.has(id));
        if (remaining.length === movable.partIds.length) {
            next.push(movable);
            return;
        }
        const anchorId = movable.kind === 'door' ? movable.panelPartId : movable.frontPartId;
        if (remaining.length === 0 || removedIds.has(anchorId)) {
            dissolved.push({ movable, index });
            return;
        }
        shrunk.push({ movableId: movable.id, partIds: [...movable.partIds] });
        next.push({ ...movable, partIds: remaining });
    });

    return { next, dissolved, shrunk };
}

/** Restores the movables a cascade changed, splicing dissolved entries back at their index. */
export function restoreMovables(spec: Spec, cascade: MovableCascade): Movable[] {
    const movables = (spec.movables ?? []).map((m) => {
        const prior = cascade.shrunk.find((s) => s.movableId === m.id);
        return prior === undefined ? m : { ...m, partIds: [...prior.partIds] };
    });
    const restored = [...movables];
    for (const { movable, index } of cascade.dissolved) {
        restored.splice(index, 0, movable);
    }
    return restored;
}

/**
 * Removes several parts at once — a group delete is one undo step. Generalizes RemovePart's
 * bookkeeping: removed parts, joints touching any of them, dissolved groups, and shrunk
 * group memberships are all recorded with their indices for order-exact undo.
 */
export class RemoveParts implements Command {
    readonly label = 'Delete parts';
    private removed?: {
        parts: { part: Part; index: number }[];
        joints: { joint: Joint; index: number }[];
        dissolved: { group: Group; index: number }[];
        shrunk: { groupId: string; partIds: string[] }[];
        movables: MovableCascade;
    };

    constructor(private readonly partIds: string[]) {}

    do(spec: Spec): Spec {
        const ids = new Set(this.partIds);
        const joints = spec.joints ?? [];
        const groups = spec.groups ?? [];

        const parts = spec.parts
            .map((part, index) => ({ part, index }))
            .filter(({ part }) => ids.has(part.id));
        if (parts.length === 0) {
            return spec;
        }
        const touchedJoints = joints
            .map((joint, index) => ({ joint, index }))
            .filter(({ joint }) => ids.has(joint.hostPartId) || ids.has(joint.insertPartId));

        const dissolved: { group: Group; index: number }[] = [];
        const shrunk: { groupId: string; partIds: string[] }[] = [];
        const nextGroups: Group[] = [];
        groups.forEach((group, index) => {
            const remaining = group.partIds.filter((id) => !ids.has(id));
            if (remaining.length === group.partIds.length) {
                nextGroups.push(group);
            } else if (remaining.length < 2) {
                dissolved.push({ group, index });
            } else {
                shrunk.push({ groupId: group.id, partIds: [...group.partIds] });
                nextGroups.push({ ...group, partIds: remaining });
            }
        });

        const movables = cascadeMovables(spec, ids);

        this.removed = { parts, joints: touchedJoints, dissolved, shrunk, movables };
        return {
            ...spec,
            parts: spec.parts.filter((p) => !ids.has(p.id)),
            joints: joints.filter((j) => !ids.has(j.hostPartId) && !ids.has(j.insertPartId)),
            groups: nextGroups,
            movables: movables.next,
        };
    }

    undo(spec: Spec): Spec {
        const removed = this.removed;
        if (removed === undefined) {
            return spec;
        }
        const parts = [...spec.parts];
        for (const { part, index } of removed.parts) {
            parts.splice(index, 0, part);
        }
        const joints = [...(spec.joints ?? [])];
        for (const { joint, index } of removed.joints) {
            joints.splice(index, 0, joint);
        }
        let groups = (spec.groups ?? []).map((g) => {
            const prior = removed.shrunk.find((s) => s.groupId === g.id);
            return prior === undefined ? g : { ...g, partIds: [...prior.partIds] };
        });
        groups = [...groups];
        for (const { group, index } of removed.dissolved) {
            groups.splice(index, 0, group);
        }
        return { ...spec, parts, joints, groups, movables: restoreMovables(spec, removed.movables) };
    }
}

/**
 * Clones a whole group: fresh ids for every member (allocated against a running set so
 * clones never collide), one shared offset, intra-group joints remapped to the new ids
 * (boundary joints are not cloned — the copy has no claim on outside parts), and a new
 * group registered over the clones.
 */
export class DuplicateGroup implements Command {
    readonly label = 'Duplicate group';
    private plan?: {
        clones: Part[];
        joints: Joint[];
        group: Group;
        movable?: Movable;
    };

    constructor(private readonly groupId: string) {}

    /** The clone group's id, readable after execute (the workspace selects it). */
    get resultGroupId(): string | null {
        return this.plan?.group.id ?? null;
    }

    do(spec: Spec): Spec {
        const source = (spec.groups ?? []).find((g) => g.id === this.groupId);
        if (source === undefined) {
            return spec;
        }
        if (this.plan === undefined) {
            const members = spec.parts.filter((p) => source.partIds.includes(p.id));
            if (members.length === 0) {
                return spec;
            }
            const thickness = new Map(spec.materials.map((m) => [m.id, m.thickness]));
            let minX = Infinity;
            let maxX = -Infinity;
            for (const part of members) {
                const box = aabbFromPart(part, thickness.get(part.materialId) ?? 0);
                minX = Math.min(minX, box.min[0]);
                maxX = Math.max(maxX, box.max[0]);
            }
            const offsetX = maxX - minX + 2;

            const used = new Set(spec.parts.map((p) => p.id));
            const idMap = new Map<string, string>();
            for (const part of members) {
                idMap.set(part.id, uniquePartIdFrom(used, `${part.id}_copy`));
            }
            const clones = members.map((part) => ({
                ...part,
                id: idMap.get(part.id)!,
                name: `${part.name} copy`,
                transform: {
                    ...part.transform,
                    pos: [part.transform.pos[0] + offsetX, part.transform.pos[1], part.transform.pos[2]] as [
                        number,
                        number,
                        number,
                    ],
                },
            }));
            const joints = (spec.joints ?? [])
                .filter((j) => idMap.has(j.hostPartId) && idMap.has(j.insertPartId))
                .map((j) => ({
                    ...j,
                    hostPartId: idMap.get(j.hostPartId)!,
                    insertPartId: idMap.get(j.insertPartId)!,
                }));
            const group: Group = {
                id: uniqueGroupId(spec, `${source.name ?? source.id}_copy`),
                partIds: source.partIds.map((id) => idMap.get(id)!),
                ...(source.name === undefined ? {} : { name: `${source.name} copy` }),
            };

            const sourceMovable = (spec.movables ?? []).find((m) =>
                m.partIds.some((id: string) => source.partIds.includes(id)),
            );
            let movable: Movable | undefined = undefined;
            if (sourceMovable !== undefined) {
                const clonedPartIds = sourceMovable.partIds
                    .map((id: string) => idMap.get(id))
                    .filter((id: string | undefined): id is string => id !== undefined);
                if (clonedPartIds.length > 0) {
                    if (sourceMovable.kind === 'door') {
                        movable = {
                            ...sourceMovable,
                            id: uniqueMovableId(spec, 'door'),
                            name: sourceMovable.name ? `${sourceMovable.name} copy` : undefined,
                            partIds: clonedPartIds,
                            panelPartId: idMap.get(sourceMovable.panelPartId) ?? clonedPartIds[0],
                        };
                    } else {
                        movable = {
                            ...sourceMovable,
                            id: uniqueMovableId(spec, 'drawer'),
                            name: sourceMovable.name ? `${sourceMovable.name} copy` : undefined,
                            partIds: clonedPartIds,
                            frontPartId: idMap.get(sourceMovable.frontPartId) ?? clonedPartIds[0],
                        };
                    }
                }
            }

            this.plan = { clones, joints, group, movable };
        }
        const plan = this.plan;
        return {
            ...spec,
            parts: [...spec.parts, ...plan.clones],
            joints: [...(spec.joints ?? []), ...plan.joints],
            groups: [...(spec.groups ?? []), plan.group],
            movables: plan.movable ? [...(spec.movables ?? []), plan.movable] : spec.movables,
        };
    }

    undo(spec: Spec): Spec {
        const plan = this.plan;
        if (plan === undefined) {
            return spec;
        }
        const cloneIds = new Set(plan.clones.map((p) => p.id));
        return {
            ...spec,
            parts: spec.parts.filter((p) => !cloneIds.has(p.id)),
            joints: (spec.joints ?? []).filter(
                (j) => !cloneIds.has(j.hostPartId) && !cloneIds.has(j.insertPartId),
            ),
            groups: (spec.groups ?? []).filter((g) => g.id !== plan.group.id),
            movables: plan.movable
                ? (spec.movables ?? []).filter((m) => m.id !== plan.movable!.id)
                : spec.movables,
        };
    }
}

/** Renames a group, preserving its ID and membership. */
export class RenameGroup implements Command {
    readonly label = 'Rename group';
    private before?: string;

    constructor(
        private readonly groupId: string,
        private readonly name: string,
    ) {}

    do(spec: Spec): Spec {
        const trimmed = this.name.trim();
        const group = (spec.groups ?? []).find((g) => g.id === this.groupId);
        if (group === undefined || trimmed === '' || trimmed === group.name) {
            return spec;
        }
        this.before = group.name;
        return {
            ...spec,
            groups: spec.groups!.map((g) => (g.id === this.groupId ? { ...g, name: trimmed } : g)),
        };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return {
            ...spec,
            groups: spec.groups!.map((g) => (g.id === this.groupId ? { ...g, name: before } : g)),
        };
    }
}

export class ApplyFocusEdits implements Command {
    readonly label = 'Focus edits';
    private beforeSpec: Spec | undefined;

    constructor(
        public readonly focusSpec: Spec,
        public readonly originalGroupId: string,
        public readonly offset: Vec3,
    ) {}

    do(spec: Spec): Spec {
        this.beforeSpec = spec;
        return exitFocusMode(spec, this.focusSpec, this.originalGroupId, this.offset);
    }

    undo(spec: Spec): Spec {
        return this.beforeSpec ?? spec;
    }
}
