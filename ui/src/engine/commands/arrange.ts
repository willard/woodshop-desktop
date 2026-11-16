/**
 * Repeating and spacing parts: a run of copies (slats, shelves, legs) and spreading a selection
 * out evenly. The maths is pure (`copyStep`, `evenPositions`) so it is tested on its own; the
 * commands apply it as one undo step.
 */
import type { Spec, Part, HardwareMount, Vec3 } from '../../spec/types';
import type { Command } from './Command';
import { aabbFromPart } from '../snapping';
import { cloneHardware } from './hardware';

export type Axis = 0 | 1 | 2;
type Point = [number, number, number];

function thicknessOf(spec: Spec, part: Part): number {
    return spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;
}

/** A part's world extent along `axis`. */
export function extentAlong(spec: Spec, part: Part, axis: Axis): { min: number; max: number } {
    const box = aabbFromPart(part, thicknessOf(spec, part));
    return { min: box.min[axis], max: box.max[axis] };
}

/** The move from one copy to the next: the part's own extent along `axis` plus the `gap` between. */
export function copyStep(spec: Spec, part: Part, axis: Axis, gap: number): Point {
    const { min, max } = extentAlong(spec, part, axis);
    const step: Point = [0, 0, 0];
    step[axis] = max - min + gap;
    return step;
}

/** "Slat" → "Slat 2", "Slat 3"…; "Slat 1" → "Slat 2"…, so a run counts on from the original. */
export function copyNames(name: string, count: number): string[] {
    const m = /^(.*?)\s*(\d+)$/.exec(name);
    const base = m ? m[1] : name;
    const first = m ? Number(m[2]) : 1;
    return Array.from({ length: count }, (_, i) => `${base} ${first + i + 1}`);
}

/**
 * New positions that spread `parts` out evenly along `axis`: the two outermost stay put and the
 * rest move so every gap between neighbours is the same. Parts are taken in their current order
 * along the axis. Fewer than three parts: nothing to spread.
 */
export function evenPositions(spec: Spec, parts: readonly Part[], axis: Axis): Map<string, Point> {
    const out = new Map<string, Point>();
    if (parts.length < 3) return out;
    const spans = parts
        .map((part) => ({ part, ...extentAlong(spec, part, axis) }))
        .sort((a, b) => a.min + a.max - (b.min + b.max));
    const start = spans[0].max;
    const end = spans[spans.length - 1].min;
    const inner = spans.slice(1, -1);
    const filled = inner.reduce((sum, s) => sum + (s.max - s.min), 0);
    const gap = (end - start - filled) / (inner.length + 1);
    let cursor = start + gap;
    for (const s of inner) {
        const [x, y, z] = s.part.transform.pos;
        const pos: Point = [x, y, z];
        // Keep the part's own offset between its centre and its extent (it need not be centred).
        pos[axis] += cursor - s.min;
        out.set(s.part.id, pos);
        cursor += s.max - s.min + gap;
    }
    return out;
}

/** `count` copies of a part, each one `step` on from the last, with copies of its hardware. */
export class CopyPart implements Command {
    readonly label: string;
    private hardware: HardwareMount[] = [];

    constructor(
        private readonly sourceId: string,
        private readonly newIds: readonly string[],
        private readonly step: Vec3,
    ) {
        this.label = newIds.length === 1 ? 'Copy part' : `Make ${newIds.length} copies`;
    }

    do(spec: Spec): Spec {
        const source = spec.parts.find((p) => p.id === this.sourceId);
        if (source === undefined) return spec;
        const names = copyNames(source.name, this.newIds.length);
        const copies: Part[] = this.newIds.map((id, i) => ({
            ...source,
            id,
            name: names[i],
            transform: {
                ...source.transform,
                pos: source.transform.pos.map((v, a) => v + this.step[a] * (i + 1)),
            },
        }));
        this.hardware = this.newIds.flatMap((id) => cloneHardware(spec, new Map([[this.sourceId, id]])));
        // Each clone gets its own ids; cloneHardware numbers them against the spec it is given, so
        // make them unique across the batch.
        const seen = new Set((spec.hardware ?? []).map((h) => h.id));
        this.hardware = this.hardware.map((h) => {
            let id = h.id;
            for (let n = 2; seen.has(id); n++) id = `${h.id}_${n}`;
            seen.add(id);
            return { ...h, id };
        });
        return {
            ...spec,
            parts: [...spec.parts, ...copies],
            hardware: [...(spec.hardware ?? []), ...this.hardware],
        };
    }

    undo(spec: Spec): Spec {
        const ids = new Set(this.newIds);
        const cloned = new Set(this.hardware.map((h) => h.id));
        return {
            ...spec,
            parts: spec.parts.filter((p) => !ids.has(p.id)),
            hardware: (spec.hardware ?? []).filter((h) => !cloned.has(h.id)),
        };
    }
}

/** Moves several parts to new positions at once (one undo step). */
export class SetPositions implements Command {
    readonly label: string;
    private before = new Map<string, number[]>();

    constructor(
        private readonly positions: ReadonlyMap<string, readonly number[]>,
        label = 'Space evenly',
    ) {
        this.label = label;
    }

    do(spec: Spec): Spec {
        this.before = new Map();
        return {
            ...spec,
            parts: spec.parts.map((p) => {
                const pos = this.positions.get(p.id);
                if (pos === undefined) return p;
                this.before.set(p.id, p.transform.pos);
                return { ...p, transform: { ...p.transform, pos: [...pos] } };
            }),
        };
    }

    undo(spec: Spec): Spec {
        return {
            ...spec,
            parts: spec.parts.map((p) => {
                const pos = this.before.get(p.id);
                return pos === undefined ? p : { ...p, transform: { ...p.transform, pos } };
            }),
        };
    }
}
