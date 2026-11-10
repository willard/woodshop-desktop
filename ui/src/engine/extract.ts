/**
 * Lift a set of parts out of a design as a design of its own — "make this drawer box its own
 * project". The parts come over untouched (ops, grain, qty), along with exactly the annotations
 * that still make sense among them: the materials they use, joints between two of them, and
 * groups and movables whose every member came along. The result is recentred like a fresh
 * design: centred on X/Z, resting on the floor.
 */
import type { Spec } from '../spec/types';
import { RecenterAssembly } from './commands';

export function extractParts(spec: Spec, partIds: readonly string[], name: string): Spec {
    const ids = new Set(partIds);
    const parts = spec.parts.filter((p) => ids.has(p.id));
    if (parts.length === 0) {
        throw new Error('Pick at least one part to make a project from.');
    }
    const inside = (members: readonly string[]) => members.every((id) => ids.has(id));

    const materialIds = new Set(parts.map((p) => p.materialId));
    const joints = (spec.joints ?? []).filter((j) => ids.has(j.hostPartId) && ids.has(j.insertPartId));
    // A group that holds every extracted part would just wrap the whole new design.
    const groups = (spec.groups ?? []).filter((g) => inside(g.partIds) && g.partIds.length < parts.length);
    const movables = (spec.movables ?? []).filter((m) => inside(m.partIds));

    // `meta` (difficulty, notes, tags) describes the source design, not this piece of it.
    const { meta: _meta, ...rest } = spec;
    const extracted: Spec = {
        ...rest,
        name: name.trim().slice(0, 120) || spec.name,
        materials: spec.materials.filter((m) => materialIds.has(m.id)),
        parts: structuredClone(parts),
        joints: structuredClone(joints),
        groups: structuredClone(groups),
        movables: structuredClone(movables),
    };
    return new RecenterAssembly().do(extracted);
}
