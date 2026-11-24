/**
 * Geometry for props (spec 1.22): things shown with a piece but not built, such as the totes on a
 * tote rack. Like the hardware models they are built from the catalog item's dimensions, so there
 * are no mesh files to ship. Each is drawn standing on its bottom, centred on the origin, its
 * length along +X and its height along +Z; the scene stands it up (+Z to world +Y).
 *
 * A prop has two colours: its body (`color`) and its accent (`accent`), a tote's base and lid.
 */
import * as THREE from 'three';
import type { HardwareModel } from '@/hardware/catalog';

export interface PropGeometry {
    body: THREE.BufferGeometry[];
    accent: THREE.BufferGeometry[];
}

function num(m: HardwareModel, key: string, fallback: number): number {
    const v = m[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** A box `sx × sy × sz` sitting with its bottom at `z`. */
function slab(sx: number, sy: number, sz: number, z: number): THREE.BufferGeometry {
    return new THREE.BoxGeometry(sx, sy, sz).translate(0, 0, z + sz / 2);
}

/** A box whose bottom is `bl × bw` at `z` and whose top is `tl × tw`, `h` higher: tapered sides. */
function frustum(bl: number, bw: number, tl: number, tw: number, h: number, z: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(1, 1, h);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const top = pos.getZ(i) > 0;
        pos.setX(i, pos.getX(i) * (top ? tl : bl));
        pos.setY(i, pos.getY(i) * (top ? tw : bw));
        pos.setZ(i, pos.getZ(i) + z + h / 2);
    }
    g.computeVertexNormals();
    return g;
}

/**
 * A storage tote with its lid on: sides tapering out from the bottom to a rim band all round the
 * top (what it hangs on, on a rack's runners), and a snap-on lid with a raised panel.
 */
function tote(m: HardwareModel): PropGeometry {
    const length = num(m, 'length', 28.5);
    const width = num(m, 'width', 19.6);
    const height = num(m, 'height', 15.2);
    const rim = Math.min(num(m, 'rim', 1.5), height / 4);
    const lid = Math.min(num(m, 'lid', 1.25), height / 4);
    const baseLength = Math.min(num(m, 'baseLength', length * 0.85), length);
    const baseWidth = Math.min(num(m, 'baseWidth', width * 0.8), width);
    const rimTop = height - lid;
    const rimBottom = rimTop - rim;
    // Under the rim the sides stand in from its outside by the lip.
    const lip = Math.min(num(m, 'lip', 1), (length - baseLength) / 2, (width - baseWidth) / 2);
    const sides = frustum(baseLength, baseWidth, length - 2 * lip, width - 2 * lip, rimBottom, 0);
    const band = slab(length, width, rim, rimBottom);
    const skirt = slab(length, width, lid * 0.45, rimTop);
    const panel = slab(length * 0.8, width * 0.72, lid * 0.55, rimTop + lid * 0.45);
    return { body: [sides, band], accent: [skirt, panel] };
}

const BUILDERS: Record<string, (m: HardwareModel) => PropGeometry> = { tote };

export function knowsPropShape(shape: string | undefined): boolean {
    return shape !== undefined && shape in BUILDERS;
}

/** The prop's geometry, or a plain 12" box for a shape this version does not know. */
export function buildPropGeometry(model: HardwareModel | undefined): PropGeometry {
    const build = model === undefined ? undefined : BUILDERS[String(model.shape)];
    return build === undefined ? { body: [slab(12, 12, 12, 0)], accent: [] } : build(model!);
}
