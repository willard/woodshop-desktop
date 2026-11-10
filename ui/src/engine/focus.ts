import type { Spec, Vec3 } from '../spec/types';
import { aabbFromPart } from './snapping';
import { uniquePartIdFrom } from './commands/Command';

export interface FocusState {
    focusSpec: Spec;
    offset: Vec3;
}

export function enterFocusMode(spec: Spec, groupId: string): FocusState | null {
    const group = (spec.groups ?? []).find((g) => g.id === groupId);
    if (!group || group.partIds.length === 0) return null;

    const groupPartIds = new Set(group.partIds);
    const parts = spec.parts.filter((p) => groupPartIds.has(p.id));

    // Find bounding box center
    const thickness = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const part of parts) {
        const box = aabbFromPart(part, thickness.get(part.materialId) ?? 0);
        for (let i = 0; i < 3; i += 1) {
            min[i] = Math.min(min[i], box.min[i]);
            max[i] = Math.max(max[i], box.max[i]);
        }
    }
    const offset: Vec3 = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];

    // Offset parts
    const recenteredParts = parts.map((p) => ({
        ...p,
        transform: {
            ...p.transform,
            pos: [
                p.transform.pos[0] - offset[0],
                p.transform.pos[1] - offset[1],
                p.transform.pos[2] - offset[2],
            ] as [number, number, number],
        },
    }));

    // Extract materials used by parts
    const usedMaterialIds = new Set(parts.map((p) => p.materialId));
    const materials = spec.materials.filter((m) => usedMaterialIds.has(m.id));

    // Extract joints entirely within the group
    const joints = (spec.joints ?? []).filter(
        (j) => groupPartIds.has(j.hostPartId) && groupPartIds.has(j.insertPartId),
    );

    // Extract movables entirely within the group
    const movables = (spec.movables ?? []).filter((m) =>
        m.partIds.every((id: string) => groupPartIds.has(id)),
    );

    const focusSpec: Spec = {
        ...spec,
        parts: recenteredParts,
        materials,
        joints,
        groups: [{ ...group, partIds: recenteredParts.map((p) => p.id) }],
        movables,
    };

    return { focusSpec, offset };
}

export function exitFocusMode(mainSpec: Spec, focusSpec: Spec, originalGroupId: string, offset: Vec3): Spec {
    const originalGroup = (mainSpec.groups ?? []).find((g) => g.id === originalGroupId);
    if (!originalGroup) return mainSpec;

    const originalPartIds = new Set(originalGroup.partIds);

    // Apply offset back to focus parts
    const updatedParts = focusSpec.parts.map((p) => ({
        ...p,
        transform: {
            ...p.transform,
            pos: [
                p.transform.pos[0] + offset[0],
                p.transform.pos[1] + offset[1],
                p.transform.pos[2] + offset[2],
            ] as [number, number, number],
        },
    }));

    // Merge parts: remove original parts, add updated parts
    const mainParts = mainSpec.parts.filter((p) => !originalPartIds.has(p.id));
    const usedPartIds = new Set(mainParts.map((p) => p.id));
    const idMap = new Map<string, string>();

    const remappedFocusParts = updatedParts.map((part) => {
        let id = part.id;
        if (!originalPartIds.has(id) && usedPartIds.has(id)) {
            id = uniquePartIdFrom(usedPartIds, id);
            idMap.set(part.id, id);
        } else {
            usedPartIds.add(id);
        }
        return id === part.id ? part : { ...part, id };
    });

    const finalParts = [...mainParts, ...remappedFocusParts];
    const remapId = (id: string) => idMap.get(id) ?? id;

    // Merge groups: replace original group with the focus group
    const mainGroups = (mainSpec.groups ?? []).filter((g) => g.id !== originalGroupId);
    const updatedFocusGroups = (focusSpec.groups ?? []).map((g) => ({
        ...g,
        partIds: g.partIds.map(remapId),
    }));
    const finalGroups = [...mainGroups, ...updatedFocusGroups];

    // Joints: remove joints that were strictly internal to the old group, and add the new internal joints.
    const finalPartIds = new Set(finalParts.map((p) => p.id));
    const mainJoints = (mainSpec.joints ?? []).filter(
        (j) =>
            finalPartIds.has(j.hostPartId) &&
            finalPartIds.has(j.insertPartId) &&
            !(originalPartIds.has(j.hostPartId) && originalPartIds.has(j.insertPartId)),
    );
    const updatedFocusJoints = (focusSpec.joints ?? []).map((j) => ({
        ...j,
        hostPartId: remapId(j.hostPartId),
        insertPartId: remapId(j.insertPartId),
    }));
    const finalJoints = [...mainJoints, ...updatedFocusJoints];

    // Movables: similar logic
    const mainMovables = (mainSpec.movables ?? []).filter(
        (m) =>
            m.partIds.every((id: string) => finalPartIds.has(id)) &&
            !m.partIds.every((id: string) => originalPartIds.has(id)),
    );
    const updatedFocusMovables = (focusSpec.movables ?? []).map((m) => {
        if (m.kind === 'door') {
            return {
                ...m,
                partIds: m.partIds.map(remapId),
                panelPartId: remapId(m.panelPartId),
            };
        }
        return {
            ...m,
            partIds: m.partIds.map(remapId),
            frontPartId: remapId(m.frontPartId),
            boxPartIds: m.boxPartIds.map(remapId),
        };
    });
    const finalMovables = [...mainMovables, ...updatedFocusMovables];

    // Materials: user might have added a new material in focus mode.
    const mainMaterialIds = new Set(mainSpec.materials.map((m) => m.id));
    const newMaterials = focusSpec.materials.filter((m) => !mainMaterialIds.has(m.id));
    const finalMaterials = [...mainSpec.materials, ...newMaterials];

    return {
        ...mainSpec,
        parts: finalParts,
        materials: finalMaterials,
        joints: finalJoints,
        groups: finalGroups,
        movables: finalMovables,
    };
}
