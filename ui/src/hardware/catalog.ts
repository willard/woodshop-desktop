/**
 * The hardware catalog (spec 1.15), read from the Rust core so the editor, the cut list, exports
 * and MCP agents all see one list. Items carry true dimensions in inches and a parametric `model`
 * the 3D view builds its geometry from (`engine/geometry/hardwareModels.ts`).
 */
import { wasm } from '@/domain';
import type { HardwareMount, Part, Vec3 } from '@/spec/types';

export type HardwareRole = 'hinge' | 'slide' | 'pull';

/** `shape` plus that shape's dimensions, in inches. */
export type HardwareModel = { shape: string } & Record<string, number | boolean | string>;

export interface HardwareItem {
    id: string;
    category: string;
    /** One of them, for a picker: `Bar pull, 96 mm centers`. */
    name: string;
    /** Several of them, for the hardware list. */
    list: string;
    role?: HardwareRole;
    /** `false` for items that only belong to a door or drawer (drawer slides). */
    placeable?: boolean;
    description?: string;
    model: HardwareModel;
}

export interface HardwareCatalog {
    categories: { id: string; name: string }[];
    items: HardwareItem[];
}

let cached: HardwareCatalog | null = null;
let byId: Map<string, HardwareItem> | null = null;

export function catalog(): HardwareCatalog {
    cached ??= wasm.hardwareCatalog() as HardwareCatalog;
    return cached;
}

export function findItem(id: string | undefined | null): HardwareItem | undefined {
    if (id === undefined || id === null) return undefined;
    byId ??= new Map(catalog().items.map((item) => [item.id, item]));
    return byId.get(id);
}

/** Items a door or drawer can use in the given role. */
export function itemsForRole(role: HardwareRole): HardwareItem[] {
    return catalog().items.filter((item) => item.role === role);
}

/** What a movable uses when it names nothing — what the app always drew. */
export const DEFAULT_PULL = 'knob.round-1-1-4';
export const DEFAULT_SLIDE = 'slide.side-mount';
export const DEFAULT_HINGE = { overlay: 'hinge.euro-full-overlay', inset: 'hinge.butt-2-5in' } as const;

export interface MountFrame {
    /** The point on the part's surface, in its local frame. */
    point: Vec3;
    /** The outward normal of the side it sits on. */
    normal: Vec3;
    /** Where the piece's long axis runs at `rot: 0`. */
    along: Vec3;
}

/** The size of a part's side: the range a mount's `(x, y)` may take. */
export function sideExtent(part: Part, thickness: number, side: HardwareMount['side']): [number, number] {
    if (side === 'front' || side === 'back') return [part.size.l, part.size.w];
    return side === 'l0' || side === 'l1' ? [part.size.l, thickness] : [part.size.w, thickness];
}

/**
 * Where a mount sits in its part's local frame. Mirrors `hardware::mount_frame` in the core (a
 * test holds the two together): faces and l-edges measure `x` along the length from the w0 end;
 * ends measure it along the width from l0. `y` runs along the width on a face, and across the
 * thickness from the back on an edge.
 */
export function mountFrame(
    part: Part,
    thickness: number,
    mount: Pick<HardwareMount, 'side' | 'x' | 'y'>,
): MountFrame {
    const hl = part.size.l / 2;
    const hw = part.size.w / 2;
    const ht = thickness / 2;
    const { x, y } = mount;
    switch (mount.side) {
        case 'front':
            return { point: [-hl + x, -hw + y, ht], normal: [0, 0, 1], along: [1, 0, 0] };
        case 'back':
            return { point: [-hl + x, -hw + y, -ht], normal: [0, 0, -1], along: [1, 0, 0] };
        case 'l0':
            return { point: [-hl + x, -hw, -ht + y], normal: [0, -1, 0], along: [1, 0, 0] };
        case 'l1':
            return { point: [-hl + x, hw, -ht + y], normal: [0, 1, 0], along: [1, 0, 0] };
        case 'w0':
            return { point: [-hl, -hw + x, -ht + y], normal: [-1, 0, 0], along: [0, 1, 0] };
        case 'w1':
            return { point: [hl, -hw + x, -ht + y], normal: [1, 0, 0], along: [0, 1, 0] };
    }
}
