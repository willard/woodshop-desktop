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

/** A prop shape sized by hand (spec 1.22). */
export interface PropShape {
    kind: 'box' | 'round' | 'tote';
    l?: number;
    w?: number;
    h: number;
    d?: number;
    top?: number;
    open?: boolean;
}

/** What a hand-sized shape starts out coloured, body and accent, until it is given its own. */
export const SHAPE_COLOURS: Record<PropShape['kind'], { color: string; accent: string }> = {
    box: { color: '#b08d57', accent: '#8f7045' },
    round: { color: '#e4e4e1', accent: '#c9c9c4' },
    tote: { color: '#3a3f45', accent: '#2f6fb3' },
};

/** A tote of any size, as a catalog tote's model: the rim, lip and lid in proportion. */
export function toteModelOf(shape: PropShape): HardwareModel {
    const l = shape.l ?? 24;
    const w = shape.w ?? 16;
    const h = shape.h;
    return {
        shape: 'tote',
        length: l,
        width: w,
        height: h,
        baseLength: l * 0.86,
        baseWidth: w * 0.8,
        rim: Math.min(1.5, h * 0.1),
        lip: Math.min(1.5, w * 0.075),
        lid: Math.min(1.25, h * 0.08),
    };
}

/** A box or crate, closed with a lid, or (open) a bin with walls a little thick. */
function box(shape: PropShape): PropGeometry {
    const l = shape.l ?? 12;
    const w = shape.w ?? 12;
    const h = shape.h;
    if (shape.open !== true) {
        const lid = Math.min(0.5, h * 0.08);
        return { body: [slab(l, w, h - lid, 0)], accent: [slab(l + 0.1, w + 0.1, lid, h - lid)] };
    }
    const t = Math.min(0.25, Math.min(l, w) / 20, h / 4);
    return {
        body: [
            slab(l, w, t, 0),
            slab(l, t, h, 0).translate(0, (w - t) / 2, 0),
            slab(l, t, h, 0).translate(0, -(w - t) / 2, 0),
            slab(t, w - 2 * t, h, 0).translate((l - t) / 2, 0, 0),
            slab(t, w - 2 * t, h, 0).translate(-(l - t) / 2, 0, 0),
        ],
        accent: [],
    };
}

/** A can or pail: straight, or wider at the top; closed with a lid, or open. Drawn two-sided. */
function round(shape: PropShape): PropGeometry {
    const bottom = (shape.d ?? 10) / 2;
    const top = (shape.top ?? shape.d ?? 10) / 2;
    const h = shape.h;
    const cylinder = (rTop: number, rBottom: number, height: number, z: number, open: boolean) =>
        new THREE.CylinderGeometry(rTop, rBottom, height, 40, 1, open)
            .rotateX(Math.PI / 2)
            .translate(0, 0, z + height / 2);
    if (shape.open === true) {
        return {
            body: [
                cylinder(top, bottom, h, 0, true),
                new THREE.CircleGeometry(bottom, 40).translate(0, 0, 0.01),
                // The rolled rim round the top.
                new THREE.TorusGeometry(top, Math.min(0.15, top / 20), 8, 40).translate(0, 0, h),
            ],
            accent: [],
        };
    }
    const lid = Math.min(0.6, h * 0.06);
    const under = bottom + ((top - bottom) * (h - lid)) / h;
    return {
        body: [cylinder(under, bottom, h - lid, 0, false)],
        accent: [cylinder(top * 1.02, top * 1.02, lid, h - lid, false)],
    };
}

/** The geometry of a hand-sized shape, standing on its bottom like a catalog prop. */
export function buildShapeGeometry(shape: PropShape): PropGeometry {
    if (shape.kind === 'tote') return tote(toteModelOf(shape));
    return shape.kind === 'round' ? round(shape) : box(shape);
}

export function knowsPropShape(shape: string | undefined): boolean {
    return shape !== undefined && shape in BUILDERS;
}

/** The prop's geometry, or a plain 12" box for a shape this version does not know. */
export function buildPropGeometry(model: HardwareModel | undefined): PropGeometry {
    const build = model === undefined ? undefined : BUILDERS[String(model.shape)];
    return build === undefined ? { body: [slab(12, 12, 12, 0)], accent: [] } : build(model!);
}
