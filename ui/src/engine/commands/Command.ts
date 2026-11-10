/**
 * Command pattern (CLAUDE.md hard rule 4): every editor mutation is a Command with
 * do()/undo(). UI components never write the spec directly — they dispatch commands
 * through the EditorDocument, which validates and lints the result (hard rule 9).
 *
 * Commands are stateful objects: do() computes the next spec and records whatever undo()
 * needs to reverse it. They return NEW spec objects (no in-place mutation) so the renderer
 * can stay a pure function of the spec.
 */
import type { Spec, Part, Material } from '../../spec/types';

export interface Command {
    /** Human-readable label for history UI (Phase 1d). */
    readonly label: string;
    do(spec: Spec): Spec;
    undo(spec: Spec): Spec;
}

/** Returns a new spec with the matching part replaced by `fn(part)`. */
export function mapPart(spec: Spec, partId: string, fn: (part: Part) => Part): Spec {
    return { ...spec, parts: spec.parts.map((p) => (p.id === partId ? fn(p) : p)) };
}

/** Returns a new spec with the matching material replaced by `fn(material)`. */
export function mapMaterial(spec: Spec, materialId: string, fn: (material: Material) => Material): Spec {
    return { ...spec, materials: spec.materials.map((m) => (m.id === materialId ? fn(m) : m)) };
}

/**
 * Generates a part id absent from `used`, based on `base`, and ADDS it to `used` — so a
 * caller cloning several parts against one unchanged spec never allocates the same id twice.
 */
export function uniquePartIdFrom(used: Set<string>, base: string): string {
    const slug = base
        .toLowerCase()
        .replace(/^p_/, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    // Schema id cap is 40 chars; leave room for a collision suffix.
    let candidate = `p_${slug || 'part'}`.slice(0, 36);
    const stem = candidate;
    let n = 1;
    while (used.has(candidate)) {
        n += 1;
        candidate = `${stem}_${n}`;
    }
    used.add(candidate);
    return candidate;
}

/** Generates a part id not already used in the spec, based on `base`. */
export function uniquePartId(spec: Spec, base: string): string {
    return uniquePartIdFrom(new Set(spec.parts.map((p) => p.id)), base);
}

/** Generates a movable id not already used in the spec, based on `base` (mv_ prefix). */
export function uniqueMovableId(spec: Spec, base = 'movable'): string {
    const used = new Set((spec.movables ?? []).map((m) => m.id));
    const slug = base
        .toLowerCase()
        .replace(/^mv_/, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    let candidate = `mv_${slug || 'movable'}`.slice(0, 36);
    const stem = candidate;
    let n = 1;
    while (used.has(candidate)) {
        n += 1;
        candidate = `${stem}_${n}`;
    }
    return candidate;
}

/** Generates a group id not already used in the spec, based on `base` (g_ prefix). */
export function uniqueGroupId(spec: Spec, base = 'group'): string {
    const used = new Set((spec.groups ?? []).map((g) => g.id));
    const slug = base
        .toLowerCase()
        .replace(/^g_/, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    let candidate = `g_${slug || 'group'}`.slice(0, 36);
    const stem = candidate;
    let n = 1;
    while (used.has(candidate)) {
        n += 1;
        candidate = `${stem}_${n}`;
    }
    return candidate;
}

/** Generates a material id not already used in the spec, based on `base` (mat_ prefix). */
export function uniqueMaterialId(spec: Spec, base: string): string {
    const used = new Set(spec.materials.map((m) => m.id));
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^mat_/, '')
        .replace(/^_+|_+$/g, '');
    // Schema id cap is 40 chars; leave room for a collision suffix.
    let candidate = `mat_${slug || 'stock'}`.slice(0, 36);
    const stem = candidate;
    let n = 1;
    while (used.has(candidate)) {
        n += 1;
        candidate = `${stem}_${n}`;
    }
    return candidate;
}

export interface NewPartOptions {
    id: string;
    name: string;
    materialId: string;
    size: { l: number; w: number };
    grainAxis?: Part['grainAxis'];
    pos?: readonly [number, number, number];
    /** Euler XYZ degrees (§3.1). Defaults to unrotated: length along +X, so the part lies down. */
    rot?: readonly [number, number, number];
}

/** Builds a fully-defaulted part so the command output is spec-shaped and type-safe. */
export function makePart(opts: NewPartOptions): Part {
    return {
        id: opts.id,
        name: opts.name,
        materialId: opts.materialId,
        size: { l: opts.size.l, w: opts.size.w },
        grainAxis: opts.grainAxis ?? 'l',
        transform: {
            pos: [...(opts.pos ?? [0, opts.size.w / 2, 0])],
            rot: [...(opts.rot ?? [0, 0, 0])],
        },
        ops: [],
        qty: 1,
        locked: false,
    };
}
