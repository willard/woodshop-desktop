/**
 * A mirrored copy of a part, a selection or a group — one undo step. The geometry lives in
 * `../mirror`; this decides what else comes along:
 *  - joints between the mirrored parts, remapped to the copies;
 *  - joints to a part outside the selection when that part is itself centred on the mirror (the
 *    shelf that spans both sides seats in the right side's dado as it did in the left's), unless
 *    the outside part is the host of a cut the joint names — that cut is on the left only;
 *  - hardware, moved to its mirror-image spot;
 *  - a door hung from the opposite edge, a drawer as it was, and a group over the copies when a
 *    whole group was mirrored.
 */
import type { Group, HardwareMount, Joint, Movable, Part, Spec } from '../../spec/types';
import type { Command } from './Command';
import { uniqueGroupId, uniqueMovableId, uniquePartIdFrom } from './Command';
import { uniqueHardwareId } from './hardware';
import { aabbFromPart } from '../snapping';
import {
    flipEdge,
    flipFor,
    mirrorIdBase,
    mirrorMount,
    mirrorName,
    mirrorPart,
    mirrorPlane,
    type MirrorAxis,
} from '../mirror';

interface Plan {
    parts: Part[];
    joints: Joint[];
    hardware: HardwareMount[];
    movables: Movable[];
    group?: Group;
}

export class MirrorCopy implements Command {
    readonly label: string;
    private plan?: Plan;

    /**
     * @param sourceIds the parts to mirror
     * @param axis the world direction to mirror along
     * @param groupId set when a whole group is being mirrored: the copies get a group of their own
     * @param reserved ids already taken elsewhere (focus mode edits a slice of the design)
     */
    constructor(
        private readonly sourceIds: readonly string[],
        private readonly axis: MirrorAxis,
        private readonly groupId?: string,
        private readonly reserved: readonly string[] = [],
    ) {
        this.label =
            groupId !== undefined ? 'Mirror group' : sourceIds.length === 1 ? 'Mirror part' : 'Mirror parts';
    }

    /** The copies' ids, readable after execute (the workspace selects them). */
    get resultIds(): string[] {
        return this.plan?.parts.map((p) => p.id) ?? [];
    }

    get resultGroupId(): string | null {
        return this.plan?.group?.id ?? null;
    }

    private makePlan(spec: Spec): Plan | undefined {
        const sources = spec.parts.filter((p) => this.sourceIds.includes(p.id));
        if (sources.length === 0) return undefined;
        const axis = this.axis;
        const plane = mirrorPlane(spec, sources, axis);
        const thickness = new Map(spec.materials.map((m) => [m.id, m.thickness]));

        const used = new Set([...spec.parts.map((p) => p.id), ...this.reserved]);
        const idMap = new Map<string, string>();
        for (const part of sources) idMap.set(part.id, uniquePartIdFrom(used, mirrorIdBase(part.id, axis)));
        const flips = new Map(sources.map((p) => [p.id, flipFor(p, axis)]));

        const parts = sources.map((part) => ({
            ...mirrorPart(part, axis, plane),
            id: idMap.get(part.id)!,
            name: mirrorName(part.name, axis),
        }));

        // An outside part whose own middle sits on the mirror is its own mirror image.
        const centred = (id: string): boolean => {
            const part = spec.parts.find((p) => p.id === id);
            if (part === undefined) return false;
            const box = aabbFromPart(part, thickness.get(part.materialId) ?? 0);
            return Math.abs((box.min[axis] + box.max[axis]) / 2 - plane) < 1e-3;
        };
        const joints: Joint[] = [];
        for (const joint of spec.joints ?? []) {
            const host = idMap.get(joint.hostPartId);
            const insert = idMap.get(joint.insertPartId);
            if (host === undefined && insert === undefined) continue;
            if (host === undefined && (joint.opRef !== undefined || !centred(joint.hostPartId))) continue;
            if (insert === undefined && !centred(joint.insertPartId)) continue;
            // A fresh joint: ids are minted when the design is saved, never shared.
            const { id: _id, ...rest } = joint;
            joints.push({
                ...rest,
                hostPartId: host ?? joint.hostPartId,
                insertPartId: insert ?? joint.insertPartId,
            });
        }

        const hardware: HardwareMount[] = [];
        for (const mount of spec.hardware ?? []) {
            const partId = idMap.get(mount.partId);
            if (partId === undefined) continue;
            const part = sources.find((p) => p.id === mount.partId)!;
            const moved = mirrorMount(mount, part, thickness.get(part.materialId) ?? 0, flips.get(part.id)!);
            const id = uniqueHardwareId(
                spec,
                mount.item,
                hardware.map((h) => h.id),
            );
            hardware.push({ ...moved, id, partId });
        }

        const movables: Movable[] = [];
        const takenMovables: Movable[] = [...(spec.movables ?? [])];
        for (const movable of spec.movables ?? []) {
            const partIds = movable.partIds.map((id: string) => idMap.get(id));
            if (partIds.some((id: string | undefined) => id === undefined)) continue; // only whole movables
            const id = uniqueMovableId({ ...spec, movables: takenMovables }, movable.kind);
            const name = movable.name === undefined ? undefined : mirrorName(movable.name, axis);
            let copy: Movable;
            if (movable.kind === 'door') {
                const flip = flips.get(movable.panelPartId) ?? 'l';
                copy = {
                    ...movable,
                    id,
                    partIds: partIds as string[],
                    panelPartId: idMap.get(movable.panelPartId)!,
                    hingeEdge: flipEdge(movable.hingeEdge, flip),
                };
            } else {
                copy = {
                    ...movable,
                    id,
                    partIds: partIds as string[],
                    frontPartId: idMap.get(movable.frontPartId)!,
                };
            }
            if (name === undefined) delete copy.name;
            else copy.name = name;
            movables.push(copy);
            takenMovables.push(copy);
        }

        let group: Group | undefined;
        const source = (spec.groups ?? []).find((g) => g.id === this.groupId);
        if (source !== undefined) {
            const name = source.name === undefined ? undefined : mirrorName(source.name, axis);
            group = {
                id: uniqueGroupId(spec, mirrorIdBase(source.id.replace(/^g_/, ''), axis)),
                partIds: source.partIds
                    .map((id) => idMap.get(id))
                    .filter((id): id is string => id !== undefined),
                ...(name === undefined ? {} : { name }),
            };
        }
        return { parts, joints, hardware, movables, group };
    }

    do(spec: Spec): Spec {
        this.plan ??= this.makePlan(spec);
        const plan = this.plan;
        if (plan === undefined) return spec;
        return {
            ...spec,
            parts: [...spec.parts, ...plan.parts],
            joints: [...(spec.joints ?? []), ...plan.joints],
            hardware: plan.hardware.length > 0 ? [...(spec.hardware ?? []), ...plan.hardware] : spec.hardware,
            movables: plan.movables.length > 0 ? [...(spec.movables ?? []), ...plan.movables] : spec.movables,
            groups: plan.group ? [...(spec.groups ?? []), plan.group] : spec.groups,
        };
    }

    undo(spec: Spec): Spec {
        const plan = this.plan;
        if (plan === undefined) return spec;
        const ids = new Set(plan.parts.map((p) => p.id));
        const hardware = new Set(plan.hardware.map((h) => h.id));
        const movables = new Set(plan.movables.map((m) => m.id));
        return {
            ...spec,
            parts: spec.parts.filter((p) => !ids.has(p.id)),
            joints: (spec.joints ?? []).filter((j) => !ids.has(j.hostPartId) && !ids.has(j.insertPartId)),
            hardware:
                plan.hardware.length > 0
                    ? (spec.hardware ?? []).filter((h) => !hardware.has(h.id))
                    : spec.hardware,
            movables:
                plan.movables.length > 0
                    ? (spec.movables ?? []).filter((m) => !movables.has(m.id))
                    : spec.movables,
            groups: plan.group ? (spec.groups ?? []).filter((g) => g.id !== plan.group!.id) : spec.groups,
        };
    }
}
