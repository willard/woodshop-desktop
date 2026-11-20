/**
 * Sizes on the model (Phase 7.3): every part labelled with the size it is cut to, each different
 * size once, on whichever part of that size is nearest the camera, and an angled end with the
 * angle to set the saw to. Pure: the engine projects the anchors each frame and calls `place`.
 */
import type { Spec } from '@/spec';
import type { Vec3 } from './snapping';
import { len } from '@/lib/display';

/** One cut size, and every part cut to it (where its label may go). */
export interface SizeGroup {
    text: string;
    anchors: { partId: string; pos: Vec3 }[];
}

/** A label projected to the canvas: pixels, and how far from the camera (smaller is nearer). */
export interface SizeCandidate {
    text: string;
    x: number;
    y: number;
    depth: number;
}

export type PlacedSize = Omit<SizeCandidate, 'depth'>;

/** "30 1/2 × 11 1/4", plus "· ends 30°" (or "· ends 41° and 49°") where ends are cut at an angle. */
export function sizeGroups(spec: Spec, format: (inches: number) => string = len): SizeGroup[] {
    const groups = new Map<string, SizeGroup>();
    for (const part of spec.parts) {
        const angles = (part.ops ?? [])
            .filter((op) => op.type === 'curve' && op.kind === 'taper' && op.edge.startsWith('w'))
            .map((op) => {
                const taper = op as { height: number };
                return Math.round((Math.atan(taper.height / part.size.w) * 180) / Math.PI);
            });
        // Both ends at the same angle read once; different angles each get said.
        const unique = [...new Set(angles)].sort((a, b) => a - b);
        const angle =
            angles.length === 0
                ? ''
                : ` · ${angles.length > 1 ? 'ends' : 'end'} ${unique.map((a) => `${a}°`).join(' and ')}`;
        const text = `${format(part.size.l)} × ${format(part.size.w)}${angle}`;
        const key = `${part.materialId}|${text}`;
        const group = groups.get(key) ?? { text, anchors: [] };
        group.anchors.push({ partId: part.id, pos: part.transform.pos as Vec3 });
        groups.set(key, group);
    }
    return [...groups.values()];
}

/** Roughly how much room a label takes on screen, in pixels (12 px type). */
function box(c: { text: string; x: number; y: number }) {
    const w = c.text.length * 6.6 + 14;
    return { left: c.x - w / 2, right: c.x + w / 2, top: c.y - 11, bottom: c.y + 11 };
}

/** Nearest first; a label that would cover one already placed is left out. */
export function place(candidates: readonly SizeCandidate[]): PlacedSize[] {
    const placed: PlacedSize[] = [];
    const boxes: ReturnType<typeof box>[] = [];
    for (const c of [...candidates].sort((a, b) => a.depth - b.depth)) {
        const b = box(c);
        if (boxes.some((o) => b.left < o.right && o.left < b.right && b.top < o.bottom && o.top < b.bottom))
            continue;
        boxes.push(b);
        placed.push({ text: c.text, x: c.x, y: c.y });
    }
    return placed;
}
