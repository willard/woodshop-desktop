/**
 * Concrete editor commands (Phase 1b). Each records its own inverse on do() so undo() is
 * exact. Hand-editing a part's geometry sets `locked: true` (CLAUDE.md hard rule 10) so the
 * AI later returns it byte-identical.
 */
import type { Spec, Part, Joint, Group, HardwareMount, Material, Op, Species } from '../../spec/types';
import { type Command, mapPart, mapMaterial, uniqueMaterialId } from './Command';
import { lumberSizeOf, dowelSizeOf, METRIC_STOCK_LENGTHS } from '../../lib/lumberSizes';
import { aabbFromPart } from '../snapping';

export {
    mapPart,
    mapMaterial,
    uniquePartId,
    uniquePartIdFrom,
    uniqueMaterialId,
    uniqueGroupId,
    uniqueMovableId,
    makePart,
} from './Command';
export type { Command, NewPartOptions } from './Command';
export {
    GroupParts,
    UngroupParts,
    MoveParts,
    RotateParts,
    RemoveParts,
    RenameGroup,
    DuplicateGroup,
    groupOf,
    cascadeMovables,
    ApplyFocusEdits,
    restoreMovables,
} from './groups';
export type { MovableCascade } from './groups';
export { MakeMovable, DissolveMovable, UpdateMovable, AddMovable, movableOf } from './movables';
export {
    AddHardware,
    UpdateHardware,
    RemoveHardware,
    uniqueHardwareId,
    type HardwarePatch,
} from './hardware';
import { cloneHardware, detachHardware, reattachHardware, type DetachedHardware } from './hardware';
export type { MovableAddition } from './movables';

import { cascadeMovables, restoreMovables, type MovableCascade } from './groups';

/** Adds a new part. */
export class AddPart implements Command {
    readonly label = 'Add part';
    constructor(private readonly part: Part) {}

    do(spec: Spec): Spec {
        return { ...spec, parts: [...spec.parts, this.part] };
    }

    undo(spec: Spec): Spec {
        return { ...spec, parts: spec.parts.filter((p) => p.id !== this.part.id) };
    }
}

/**
 * Adds several parts at once — a set of legs, say — plus the one move that seats them: putting
 * legs under a design resting on the ground raises the design onto them. One command, so it takes
 * one undo. That move is explicit and authored here, not inferred from joints (hard rule 7), and
 * it leaves `locked` alone because it is a placement, not a hand-edit of anyone's geometry.
 */
export class AddParts implements Command {
    readonly label: string;

    constructor(
        private readonly parts: Part[],
        private readonly lift: { partIds: string[]; dy: number } | null = null,
        /** Stock the parts need that the design lacks — a dowel preset brings its own (D60). */
        private readonly material: Material | null = null,
    ) {
        this.label = parts.length > 1 ? `Add ${parts.length} parts` : 'Add part';
    }

    get partIds(): string[] {
        return this.parts.map((p) => p.id);
    }

    do(spec: Spec): Spec {
        return {
            ...spec,
            materials: this.material === null ? spec.materials : [...spec.materials, this.material],
            parts: [...this.shifted(spec.parts, 1), ...this.parts],
        };
    }

    undo(spec: Spec): Spec {
        const added = new Set(this.parts.map((p) => p.id));
        const material = this.material;
        return {
            ...spec,
            materials:
                material === null ? spec.materials : spec.materials.filter((m) => m.id !== material.id),
            parts: this.shifted(
                spec.parts.filter((p) => !added.has(p.id)),
                -1,
            ),
        };
    }

    private shifted(parts: Part[], direction: 1 | -1): Part[] {
        const lift = this.lift;
        if (lift === null) {
            return parts;
        }
        const ids = new Set(lift.partIds);
        return parts.map((part) =>
            ids.has(part.id)
                ? {
                      ...part,
                      transform: {
                          ...part.transform,
                          pos: [
                              part.transform.pos[0],
                              part.transform.pos[1] + direction * lift.dy,
                              part.transform.pos[2],
                          ],
                      },
                  }
                : part,
        );
    }
}

/**
 * Removes a part and any joints that referenced it, remembering both for undo. Group
 * memberships are pruned too (1.6): a group left with fewer than two members dissolves
 * (the schema forbids singletons), and undo restores the exact prior membership.
 */
export class RemovePart implements Command {
    readonly label = 'Delete part';
    private removed?: {
        part: Part;
        index: number;
        joints: { joint: Joint; index: number }[];
        dissolved: { group: Group; index: number }[];
        shrunk: { groupId: string; partIds: string[] }[];
        movables: MovableCascade;
        hardware: DetachedHardware;
    };

    constructor(private readonly partId: string) {}

    do(spec: Spec): Spec {
        const index = spec.parts.findIndex((p) => p.id === this.partId);
        if (index === -1) {
            return spec;
        }
        const joints = spec.joints ?? [];
        const dissolved: { group: Group; index: number }[] = [];
        const shrunk: { groupId: string; partIds: string[] }[] = [];
        const groups: Group[] = [];
        (spec.groups ?? []).forEach((group, groupIndex) => {
            if (!group.partIds.includes(this.partId)) {
                groups.push(group);
                return;
            }
            const remaining = group.partIds.filter((id) => id !== this.partId);
            if (remaining.length < 2) {
                dissolved.push({ group, index: groupIndex });
            } else {
                shrunk.push({ groupId: group.id, partIds: [...group.partIds] });
                groups.push({ ...group, partIds: remaining });
            }
        });
        const movables = cascadeMovables(spec, new Set([this.partId]));
        const hardware = detachHardware(spec, new Set([this.partId]));
        this.removed = {
            hardware: hardware.detached,
            part: spec.parts[index],
            index,
            joints: joints
                .map((joint, i) => ({ joint, index: i }))
                .filter(
                    ({ joint }) => joint.hostPartId === this.partId || joint.insertPartId === this.partId,
                ),
            dissolved,
            shrunk,
            movables,
        };
        return {
            ...spec,
            parts: spec.parts.filter((p) => p.id !== this.partId),
            joints: joints.filter((j) => j.hostPartId !== this.partId && j.insertPartId !== this.partId),
            groups,
            movables: movables.next,
            hardware: hardware.next,
        };
    }

    undo(spec: Spec): Spec {
        const removed = this.removed;
        if (removed === undefined) {
            return spec;
        }
        const parts = [...spec.parts];
        parts.splice(removed.index, 0, removed.part);
        const joints = [...(spec.joints ?? [])];
        for (const { joint, index } of removed.joints) {
            joints.splice(index, 0, joint);
        }
        const groups = (spec.groups ?? []).map((g) => {
            const prior = removed.shrunk.find((s) => s.groupId === g.id);
            return prior === undefined ? g : { ...g, partIds: [...prior.partIds] };
        });
        for (const { group, index } of removed.dissolved) {
            groups.splice(index, 0, group);
        }
        return {
            ...spec,
            parts,
            joints,
            groups,
            movables: restoreMovables(spec, removed.movables),
            hardware: reattachHardware(spec, removed.hardware),
        };
    }
}

/** Clones a part with a fresh id, offset so it's visible. */
export class DuplicatePart implements Command {
    readonly label = 'Duplicate part';
    private hardware: HardwareMount[] = [];
    constructor(
        private readonly sourceId: string,
        private readonly newId: string,
        /** Edge-to-edge spacing for the copy; 0/omitted keeps the default 2" offset. */
        private readonly gap = 0,
    ) {}

    do(spec: Spec): Spec {
        const source = spec.parts.find((p) => p.id === this.sourceId);
        if (source === undefined) {
            return spec;
        }
        const [x, y, z] = source.transform.pos;
        // A set gap lands the copy one width + gap away (an evenly-spaced run); else the 2" nicety.
        const offset = source.size.l + (this.gap > 0 ? this.gap : 2);
        const clone: Part = {
            ...source,
            id: this.newId,
            name: `${source.name} copy`,
            transform: { ...source.transform, pos: [x + offset, y, z] },
        };
        // The copy carries copies of the hardware screwed to the original.
        this.hardware = cloneHardware(spec, new Map([[this.sourceId, this.newId]]));
        return {
            ...spec,
            parts: [...spec.parts, clone],
            hardware: [...(spec.hardware ?? []), ...this.hardware],
        };
    }

    undo(spec: Spec): Spec {
        const cloned = new Set(this.hardware.map((h) => h.id));
        return {
            ...spec,
            parts: spec.parts.filter((p) => p.id !== this.newId),
            hardware: (spec.hardware ?? []).filter((h) => !cloned.has(h.id)),
        };
    }
}

/**
 * Renames a part. Deliberately does NOT set `locked`: a name is organisational metadata,
 * not a geometry hand-tune — locking here would freeze the part against AI restyling just
 * for tidying up "Leg copy copy" labels (hard rule 10 is about geometry intent).
 */
export class RenamePart implements Command {
    readonly label = 'Rename part';
    private before?: string;

    constructor(
        private readonly partId: string,
        private readonly name: string,
    ) {}

    do(spec: Spec): Spec {
        const trimmed = this.name.trim();
        const part = spec.parts.find((p) => p.id === this.partId);
        if (part === undefined || trimmed === '' || trimmed === part.name) {
            return spec;
        }
        this.before = part.name;
        return mapPart(spec, this.partId, (p) => ({ ...p, name: trimmed }));
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapPart(spec, this.partId, (p) => ({ ...p, name: before }));
    }
}

export class SetGrainAxis implements Command {
    readonly label = 'Set grain direction';
    private before?: 'l' | 'w' | 'none';

    constructor(
        private readonly partId: string,
        private readonly grainAxis: 'l' | 'w' | 'none',
    ) {}

    do(spec: Spec): Spec {
        const part = spec.parts.find((p) => p.id === this.partId);
        if (part === undefined || this.grainAxis === part.grainAxis) {
            return spec;
        }
        this.before = part.grainAxis ?? 'l'; // Default is 'l' in schema
        return mapPart(spec, this.partId, (p) => ({ ...p, grainAxis: this.grainAxis }));
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapPart(spec, this.partId, (p) => ({ ...p, grainAxis: before }));
    }
}

/** Resizes a part's face (L/W). Marks it locked (hand-tuned). */
export class ResizePart implements Command {
    readonly label = 'Resize part';
    private before?: { size: Part['size']; locked: boolean };

    constructor(
        private readonly partId: string,
        private readonly size: { l: number; w: number },
    ) {}

    do(spec: Spec): Spec {
        return mapPart(spec, this.partId, (part) => {
            this.before = { size: part.size, locked: part.locked };
            return { ...part, size: { l: this.size.l, w: this.size.w }, locked: true };
        });
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapPart(spec, this.partId, (part) => ({ ...part, size: before.size, locked: before.locked }));
    }
}

/** Replaces the spec's joints (used to record joints detected on a drag-drop, §3.2). */
export class SetJoints implements Command {
    readonly label = 'Record joints';
    private before?: Joint[];

    constructor(private readonly joints: Joint[]) {}

    do(spec: Spec): Spec {
        this.before = spec.joints ?? [];
        return { ...spec, joints: this.joints };
    }

    undo(spec: Spec): Spec {
        return this.before === undefined ? spec : { ...spec, joints: this.before };
    }
}

/** Edits a material's fields (e.g. sheet size, cost). Used by the cut-list editor. */
export class SetMaterial implements Command {
    readonly label = 'Edit material';
    private before?: Material;

    constructor(
        private readonly materialId: string,
        private readonly patch: Partial<Material>,
    ) {}

    do(spec: Spec): Spec {
        return mapMaterial(spec, this.materialId, (material) => {
            this.before = material;
            return { ...material, ...this.patch };
        });
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapMaterial(spec, this.materialId, () => before);
    }
}

/**
 * Removes a material nothing is using. Undo has to put it back where it was, not on the end: the
 * cut list sections follow material order, so a restored material appearing in a different place
 * would make undo visibly not-an-undo.
 *
 * Refuses while any part still references it — orphaning parts to clear a stray row is a far worse
 * trade than the row — and refuses the last one, since the schema requires at least one.
 */
export class DeleteMaterial implements Command {
    readonly label = 'Delete material';
    private removed?: { material: Material; index: number };

    constructor(private readonly materialId: string) {}

    do(spec: Spec): Spec {
        const index = spec.materials.findIndex((m) => m.id === this.materialId);
        const inUse = spec.parts.some((p) => p.materialId === this.materialId);
        if (index === -1 || inUse || spec.materials.length <= 1) {
            return spec;
        }
        this.removed = { material: spec.materials[index], index };

        return { ...spec, materials: spec.materials.filter((m) => m.id !== this.materialId) };
    }

    undo(spec: Spec): Spec {
        const removed = this.removed;
        if (removed === undefined) {
            return spec;
        }
        const materials = [...spec.materials];
        materials.splice(removed.index, 0, removed.material);

        return { ...spec, materials };
    }
}

const SPECIES_LABEL: Record<Species, string> = {
    pine: 'Pine',
    oak: 'Oak',
    maple: 'Maple',
    walnut: 'Walnut',
    cherry: 'Cherry',
};

const SPECIES_NAME_PREFIX = /^(Pine|Oak|Maple|Walnut|Cherry) — /;

/** True when two materials describe the same physical stock, species aside. */
function sameStock(a: Material, b: Material): boolean {
    return (
        a.type === b.type &&
        a.thickness === b.thickness &&
        (a.grain ?? true) === (b.grain ?? true) &&
        JSON.stringify(a.sheetSize ?? null) === JSON.stringify(b.sheetSize ?? null) &&
        (a.stockWidth ?? null) === (b.stockWidth ?? null) &&
        JSON.stringify(a.stockLengths ?? null) === JSON.stringify(b.stockLengths ?? null)
    );
}

/**
 * Points a part at a material of the given species (spec 1.3), reusing a material with the
 * same stock if one exists, else cloning the part's current material (costs copied as-is).
 * The find-or-create plan is computed once and replayed on redo so redo is deterministic.
 */
export class SetPartSpecies implements Command {
    readonly label = 'Set wood species';
    private plan?: {
        prevMaterialId: string;
        prevLocked: boolean;
        targetId: string;
        created: Material | null;
    };

    constructor(
        private readonly partId: string,
        private readonly species: Species,
    ) {}

    do(spec: Spec): Spec {
        const part = spec.parts.find((p) => p.id === this.partId);
        const current = part && spec.materials.find((m) => m.id === part.materialId);
        if (part === undefined || current === undefined || current.species === this.species) {
            return spec;
        }
        if (this.plan === undefined) {
            const match = spec.materials.find((m) => m.species === this.species && sameStock(m, current));
            if (match !== undefined) {
                this.plan = {
                    prevMaterialId: part.materialId,
                    prevLocked: part.locked,
                    targetId: match.id,
                    created: null,
                };
            } else {
                const label = SPECIES_LABEL[this.species];
                const baseName = current.name.replace(SPECIES_NAME_PREFIX, '');
                const created: Material = {
                    ...current,
                    id: uniqueMaterialId(spec, `${current.id}_${this.species}`),
                    species: this.species,
                    name: `${label} — ${baseName}`.slice(0, 80),
                };
                this.plan = {
                    prevMaterialId: part.materialId,
                    prevLocked: part.locked,
                    targetId: created.id,
                    created,
                };
            }
        }
        const plan = this.plan;
        const materials = plan.created === null ? spec.materials : [...spec.materials, plan.created];
        return mapPart({ ...spec, materials }, this.partId, (p) => ({
            ...p,
            materialId: plan.targetId,
            locked: true,
        }));
    }

    undo(spec: Spec): Spec {
        const plan = this.plan;
        if (plan === undefined) {
            return spec;
        }
        const restored = mapPart(spec, this.partId, (p) => ({
            ...p,
            materialId: plan.prevMaterialId,
            locked: plan.prevLocked,
        }));
        return plan.created === null
            ? restored
            : { ...restored, materials: restored.materials.filter((m) => m.id !== plan.created?.id) };
    }
}

/**
 * Points a part at nominal dimensional lumber ("2x4" → 1.5×3.5 actual), reusing a lumber
 * material with those dims + the part's current species if one exists, else creating one
 * (costs and species carried over from the current material). Also sets the part's width to
 * the stock width — a 2x4 part IS 3.5" wide — keeping its length. Same find-or-create /
 * recorded-plan shape as SetPartSpecies so redo is deterministic.
 */
export class SetPartStock implements Command {
    readonly label = 'Set lumber stock';
    private plan?: {
        prevMaterialId: string;
        prevSize: Part['size'];
        prevLocked: boolean;
        targetId: string;
        created: Material | null;
    };

    constructor(
        private readonly partId: string,
        private readonly nominal: string,
    ) {}

    do(spec: Spec): Spec {
        const size = lumberSizeOf(this.nominal);
        const part = spec.parts.find((p) => p.id === this.partId);
        const current = part && spec.materials.find((m) => m.id === part.materialId);
        if (size === undefined || part === undefined || current === undefined) {
            return spec;
        }
        const alreadyThatStock =
            current.type === 'lumber' &&
            current.thickness === size.thickness &&
            current.stockWidth === size.width;
        if (alreadyThatStock && part.size.w === size.width) {
            return spec;
        }
        if (this.plan === undefined) {
            const match = spec.materials.find(
                (m) =>
                    m.type === 'lumber' &&
                    m.thickness === size.thickness &&
                    m.stockWidth === size.width &&
                    (m.species ?? null) === (current.species ?? null),
            );
            if (match !== undefined) {
                this.plan = {
                    prevMaterialId: part.materialId,
                    prevSize: part.size,
                    prevLocked: part.locked,
                    targetId: match.id,
                    created: null,
                };
            } else {
                const speciesLabel =
                    current.species === undefined
                        ? ''
                        : ` ${current.species[0].toUpperCase()}${current.species.slice(1)}`;
                const created: Material = {
                    id: uniqueMaterialId(spec, `mat_${this.nominal}`),
                    type: 'lumber',
                    name: `${this.nominal}${speciesLabel}`.slice(0, 80),
                    thickness: size.thickness,
                    stockWidth: size.width,
                    stockLengths:
                        current.type === 'lumber' && current.stockLengths !== undefined
                            ? current.stockLengths
                            : size.metric
                              ? METRIC_STOCK_LENGTHS
                              : [96],
                    grain: current.grain ?? true,
                    ...(current.species === undefined ? {} : { species: current.species }),
                    ...(current.costPerBoardFoot === undefined
                        ? {}
                        : { costPerBoardFoot: current.costPerBoardFoot }),
                };
                this.plan = {
                    prevMaterialId: part.materialId,
                    prevSize: part.size,
                    prevLocked: part.locked,
                    targetId: created.id,
                    created,
                };
            }
        }
        const plan = this.plan;
        const materials = plan.created === null ? spec.materials : [...spec.materials, plan.created];
        return mapPart({ ...spec, materials }, this.partId, (p) => ({
            ...p,
            materialId: plan.targetId,
            size: { l: p.size.l, w: size.width },
            locked: true,
        }));
    }

    undo(spec: Spec): Spec {
        const plan = this.plan;
        if (plan === undefined) {
            return spec;
        }
        const restored = mapPart(spec, this.partId, (p) => ({
            ...p,
            materialId: plan.prevMaterialId,
            size: plan.prevSize,
            locked: plan.prevLocked,
        }));
        return plan.created === null
            ? restored
            : { ...restored, materials: restored.materials.filter((m) => m.id !== plan.created?.id) };
    }
}

/**
 * Points a part at round stock — dowel rod (spec 1.13 / D60) — reusing a round material of that
 * diameter if one exists, else creating it. The part's width becomes the diameter, because a
 * dowel's blank is d x d x length and the linter says so (`part.round-width`).
 *
 * Refuses a part that carries ops: §3.1 faces and edges do not exist on a cylinder
 * (`part.round-ops`), and quietly dropping someone's joinery to change its stock would be a much
 * worse trade than declining. The inspector hides the option for exactly this case.
 */
export class SetPartRoundStock implements Command {
    readonly label = 'Set round stock';
    private plan?: {
        prevMaterialId: string;
        prevSize: Part['size'];
        prevLocked: boolean;
        targetId: string;
        created: Material | null;
    };

    constructor(
        private readonly partId: string,
        private readonly label_: string,
    ) {}

    do(spec: Spec): Spec {
        const size = dowelSizeOf(this.label_);
        const part = spec.parts.find((p) => p.id === this.partId);
        const current = part && spec.materials.find((m) => m.id === part.materialId);
        if (size === undefined || part === undefined || current === undefined) {
            return spec;
        }
        if ((part.ops ?? []).length > 0) {
            return spec; // ops and round stock cannot coexist; see the class comment
        }
        const alreadyThatStock = current.type === 'round' && current.thickness === size.diameter;
        if (alreadyThatStock && part.size.w === size.diameter) {
            return spec;
        }
        if (this.plan === undefined) {
            const match = spec.materials.find(
                (m) =>
                    m.type === 'round' &&
                    m.thickness === size.diameter &&
                    (m.species ?? null) === (current.species ?? null),
            );
            if (match !== undefined) {
                this.plan = {
                    prevMaterialId: part.materialId,
                    prevSize: part.size,
                    prevLocked: part.locked,
                    targetId: match.id,
                    created: null,
                };
            } else {
                const speciesLabel =
                    current.species === undefined
                        ? ''
                        : ` ${current.species[0].toUpperCase()}${current.species.slice(1)}`;
                const created: Material = {
                    id: uniqueMaterialId(spec, 'mat_dowel'),
                    type: 'round',
                    name: `${this.label_} Dowel${speciesLabel}`.slice(0, 80),
                    thickness: size.diameter,
                    // Dowel rod is sold in sticks; 36" and 48" are what sits in the rack.
                    stockLengths: [36, 48],
                    grain: current.grain ?? true,
                    ...(current.species === undefined ? {} : { species: current.species }),
                };
                this.plan = {
                    prevMaterialId: part.materialId,
                    prevSize: part.size,
                    prevLocked: part.locked,
                    targetId: created.id,
                    created,
                };
            }
        }
        const plan = this.plan;
        const materials = plan.created === null ? spec.materials : [...spec.materials, plan.created];
        return mapPart({ ...spec, materials }, this.partId, (p) => ({
            ...p,
            materialId: plan.targetId,
            size: { l: p.size.l, w: size.diameter },
            locked: true,
        }));
    }

    undo(spec: Spec): Spec {
        const plan = this.plan;
        if (plan === undefined) {
            return spec;
        }
        const restored = mapPart(spec, this.partId, (p) => ({
            ...p,
            materialId: plan.prevMaterialId,
            size: plan.prevSize,
            locked: plan.prevLocked,
        }));
        return plan.created === null
            ? restored
            : { ...restored, materials: restored.materials.filter((m) => m.id !== plan.created?.id) };
    }
}

/** Appends an op (dado, hole, …) to a part. Marks it locked (hand-tuned joinery). */
export class AddOp implements Command {
    readonly label = 'Add op';
    private before?: { locked: boolean };

    constructor(
        private readonly partId: string,
        private readonly op: Op,
    ) {}

    do(spec: Spec): Spec {
        return mapPart(spec, this.partId, (part) => {
            this.before = { locked: part.locked };
            return { ...part, ops: [...(part.ops ?? []), this.op], locked: true };
        });
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapPart(spec, this.partId, (part) => ({
            ...part,
            ops: (part.ops ?? []).slice(0, -1),
            locked: before.locked,
        }));
    }
}

/**
 * Applies a dowel plan atomically (one undo step): appends the planned `dowel` holes to the
 * face part (marking it locked, like AddOp) and records the `dowel` joint pointing at the
 * first added hole. Host = the hole owner, matching the opRef convention (§3.2 / D39).
 */
export class AddDowelJoint implements Command {
    readonly label = 'Add dowel joint';
    private before?: { locked: boolean; opCount: number; joints: Joint[] };

    constructor(
        private readonly partId: string,
        private readonly matePartId: string,
        private readonly holes: Op[],
    ) {}

    do(spec: Spec): Spec {
        const withHoles = mapPart(spec, this.partId, (part) => {
            const ops = part.ops ?? [];
            this.before = { locked: part.locked, opCount: ops.length, joints: spec.joints ?? [] };
            return { ...part, ops: [...ops, ...this.holes], locked: true };
        });
        if (this.before === undefined) {
            return spec; // part not found
        }
        const joint: Joint = {
            type: 'dowel',
            hostPartId: this.partId,
            insertPartId: this.matePartId,
            opRef: this.before.opCount,
        };
        return { ...withHoles, joints: [...(withHoles.joints ?? []), joint] };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        const restored = mapPart(spec, this.partId, (part) => ({
            ...part,
            ops: (part.ops ?? []).slice(0, before.opCount),
            locked: before.locked,
        }));
        return { ...restored, joints: before.joints };
    }
}

/**
 * Applies a screw plan atomically (one undo step): appends the planned fastener op to the part the
 * metal passes through (marking it locked, like AddOp) and records the matching joint pointing at
 * it. Host = the op owner, the same convention dados and dowels use, so RemoveOp's joint
 * bookkeeping and the linter's opRef checks apply unchanged. Covers both fasteners: a `screws` op
 * records a `screw` joint, a `pocketHoles` op records a `pocketScrew` joint.
 */
export class AddScrewJoint implements Command {
    readonly label: string;
    private before?: { locked: boolean; opCount: number; joints: Joint[] };

    constructor(
        private readonly partId: string,
        private readonly matePartId: string,
        private readonly op: Extract<Op, { type: 'screws' | 'pocketHoles' }>,
    ) {
        this.label = op.type === 'screws' ? 'Add screws' : 'Add pocket screws';
    }

    do(spec: Spec): Spec {
        const withOp = mapPart(spec, this.partId, (part) => {
            const ops = part.ops ?? [];
            this.before = { locked: part.locked, opCount: ops.length, joints: spec.joints ?? [] };
            return { ...part, ops: [...ops, this.op], locked: true };
        });
        if (this.before === undefined) {
            return spec; // part not found
        }
        const joint: Joint = {
            type: this.op.type === 'screws' ? 'screw' : 'pocketScrew',
            hostPartId: this.partId,
            insertPartId: this.matePartId,
            opRef: this.before.opCount,
        };
        return { ...withOp, joints: [...(withOp.joints ?? []), joint] };
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        const restored = mapPart(spec, this.partId, (part) => ({
            ...part,
            ops: (part.ops ?? []).slice(0, before.opCount),
            locked: before.locked,
        }));
        return { ...restored, joints: before.joints };
    }
}

/**
 * Removes a part's op by index. Joints reference host ops by index (`opRef`), so joints
 * pointing AT the removed op are dropped (remembered for undo) and refs pointing PAST it
 * are decremented — mirroring RemovePart's joint bookkeeping.
 */
export class RemoveOp implements Command {
    readonly label = 'Remove op';
    private removed?: {
        op: Op;
        locked: boolean;
        joints: { joint: Joint; index: number }[];
    };

    constructor(
        private readonly partId: string,
        private readonly opIndex: number,
    ) {}

    do(spec: Spec): Spec {
        const part = spec.parts.find((p) => p.id === this.partId);
        const ops = part?.ops ?? [];
        if (part === undefined || this.opIndex < 0 || this.opIndex >= ops.length) {
            return spec;
        }
        const joints = spec.joints ?? [];
        this.removed = {
            op: ops[this.opIndex],
            locked: part.locked,
            joints: joints
                .map((joint, index) => ({ joint, index }))
                .filter(({ joint }) => joint.hostPartId === this.partId && joint.opRef === this.opIndex),
        };
        const next = mapPart(spec, this.partId, (p) => ({
            ...p,
            ops: ops.filter((_, i) => i !== this.opIndex),
            locked: true,
        }));
        return {
            ...next,
            joints: joints
                .filter((j) => !(j.hostPartId === this.partId && j.opRef === this.opIndex))
                .map((j) =>
                    j.hostPartId === this.partId && j.opRef !== undefined && j.opRef > this.opIndex
                        ? { ...j, opRef: j.opRef - 1 }
                        : j,
                ),
        };
    }

    undo(spec: Spec): Spec {
        const removed = this.removed;
        if (removed === undefined) {
            return spec;
        }
        const restored = mapPart(spec, this.partId, (part) => {
            const ops = [...(part.ops ?? [])];
            ops.splice(this.opIndex, 0, removed.op);
            return { ...part, ops, locked: removed.locked };
        });
        const joints = (restored.joints ?? []).map((j) =>
            j.hostPartId === this.partId && j.opRef !== undefined && j.opRef >= this.opIndex
                ? { ...j, opRef: j.opRef + 1 }
                : j,
        );
        for (const { joint, index } of removed.joints) {
            joints.splice(index, 0, joint);
        }
        return { ...restored, joints };
    }
}

/** Moves a part's centre in world space (drag / snap). Marks it locked. */
export class MovePart implements Command {
    readonly label = 'Move part';
    private before?: { pos: number[]; locked: boolean };

    constructor(
        private readonly partId: string,
        private readonly pos: number[],
    ) {}

    do(spec: Spec): Spec {
        return mapPart(spec, this.partId, (part) => {
            this.before = { pos: [...part.transform.pos], locked: part.locked };
            return { ...part, transform: { ...part.transform, pos: [...this.pos] }, locked: true };
        });
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapPart(spec, this.partId, (part) => ({
            ...part,
            transform: { ...part.transform, pos: before.pos },
            locked: before.locked,
        }));
    }
}

/** Sets a part's rotation (degrees, any angle — the schema imposes no snap grid). Marks it locked. */
export class RotatePart implements Command {
    readonly label = 'Rotate part';
    private before?: { rot: number[]; locked: boolean };

    constructor(
        private readonly partId: string,
        private readonly rot: number[],
    ) {}

    do(spec: Spec): Spec {
        return mapPart(spec, this.partId, (part) => {
            this.before = { rot: [...part.transform.rot], locked: part.locked };
            return {
                ...part,
                transform: { ...part.transform, rot: [...this.rot] },
                locked: true,
            };
        });
    }

    undo(spec: Spec): Spec {
        const before = this.before;
        if (before === undefined) {
            return spec;
        }
        return mapPart(spec, this.partId, (part) => ({
            ...part,
            transform: { ...part.transform, rot: before.rot },
            locked: before.locked,
        }));
    }
}

/**
 * Rigidly translates the whole assembly so its footprint centres on the grid origin (X/Z)
 * and its lowest face rests on the ground plane (y = 0). One undo step.
 *
 * Deliberately does NOT set `locked`: a whole-assembly translation preserves every part's
 * relative geometry, so nothing has been hand-tuned — locking all parts here would freeze
 * the entire project against AI edits (hard rule 10).
 */
export class RecenterAssembly implements Command {
    readonly label = 'Recenter project';
    private delta?: [number, number, number];

    do(spec: Spec): Spec {
        this.delta ??= RecenterAssembly.deltaFor(spec);
        const [dx, dy, dz] = this.delta;
        if (dx === 0 && dy === 0 && dz === 0) {
            return spec;
        }
        return this.translate(spec, dx, dy, dz);
    }

    undo(spec: Spec): Spec {
        if (this.delta === undefined) {
            return spec;
        }
        const [dx, dy, dz] = this.delta;
        return this.translate(spec, -dx, -dy, -dz);
    }

    private translate(spec: Spec, dx: number, dy: number, dz: number): Spec {
        return {
            ...spec,
            parts: spec.parts.map((part) => ({
                ...part,
                transform: {
                    ...part.transform,
                    pos: [part.transform.pos[0] + dx, part.transform.pos[1] + dy, part.transform.pos[2] + dz],
                },
            })),
        };
    }

    /** The translation that centres the union world AABB on X/Z and rests min-Y on 0. */
    static deltaFor(spec: Spec): [number, number, number] {
        if (spec.parts.length === 0) {
            return [0, 0, 0];
        }
        const thickness = new Map(spec.materials.map((m) => [m.id, m.thickness]));
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const part of spec.parts) {
            const box = aabbFromPart(part, thickness.get(part.materialId) ?? 0.75);
            for (const axis of [0, 1, 2]) {
                min[axis] = Math.min(min[axis], box.min[axis]);
                max[axis] = Math.max(max[axis], box.max[axis]);
            }
        }
        const raw: [number, number, number] = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
        // Kill float dust so an already-centred assembly is an exact no-op (and creates
        // no undo entry via the delta === 0 guard above).
        return raw.map((v) => (Math.abs(v) < 1e-6 ? 0 : v)) as [number, number, number];
    }
}
