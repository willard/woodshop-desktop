/**
 * Catalog hardware as geometry (spec 1.15). Every item in the hardware catalog carries a `model`:
 * a shape name plus that shape's real dimensions in inches. The geometry is generated here from
 * those numbers, so there are no mesh files to ship or license and a new size is one catalog row.
 *
 * Convention for every shape: the origin sits on the mounting surface, +Z points away from it,
 * and the piece's long axis runs along +X. Placement is the caller's job (buildScene.ts).
 *
 * These are meant to be recognised at furniture zoom — the right overall size and silhouette (a
 * caster has a plate, a fork and a wheel) — not to reproduce a manufacturer's casting.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HardwareModel } from '@/hardware/catalog';

type Axis = 'x' | 'y' | 'z';

/** A box of the given size centred at (x, y, z). */
function box(sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
    return new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
}

/** A cylinder of radius `r` and length `len` along `axis`, centred at (x, y, z). */
function cyl(r: number, len: number, axis: Axis, x = 0, y = 0, z = 0, segments = 16): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r, r, len, segments);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    return g.translate(x, y, z);
}

/** Half a torus standing on the surface: feet at x = ±radius, crown at z = `height`. */
function arch(radius: number, tube: number, height: number): THREE.BufferGeometry {
    const g = new THREE.TorusGeometry(radius, tube, 8, 20, Math.PI);
    g.rotateX(Math.PI / 2); // the arc now rises along +Z
    g.scale(1, 1, height / (radius + tube));
    return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    // Primitives differ in whether they are indexed; merging needs them alike.
    const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const merged = mergeGeometries(flat, false) ?? new THREE.BoxGeometry(0.5, 0.5, 0.5);
    for (const p of parts) p.dispose();
    for (const f of flat) f.dispose();
    return merged;
}

const num = (model: HardwareModel, key: string, fallback: number): number => {
    const v = model[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** Sheet-metal thickness for leaves, plates and brackets. */
const PLATE = 0.08;

type Builder = (m: HardwareModel, length?: number) => THREE.BufferGeometry[];

const BUILDERS: Record<string, Builder> = {
    knob: (m) => {
        const d = num(m, 'diameter', 1.25);
        const p = num(m, 'projection', 1.1);
        const post = cyl(d * 0.18, p * 0.55, 'z', 0, 0, p * 0.275);
        if (m.square === true) {
            return [post, box(d, d, p * 0.45, 0, 0, p * 0.775)];
        }
        const head = new THREE.SphereGeometry(d / 2, 16, 12)
            .scale(1, 1, (p * 0.5) / d)
            .translate(0, 0, p * 0.75);
        return [post, head];
    },

    barPull: (m) => {
        const c = num(m, 'centers', 3);
        const l = num(m, 'length', c + 0.75);
        const d = num(m, 'diameter', 0.47);
        const p = num(m, 'projection', 1.3);
        const post = (x: number) => cyl(d * 0.38, p - d / 2, 'z', x, 0, (p - d / 2) / 2);
        return [cyl(d / 2, l, 'x', 0, 0, p - d / 2), post(-c / 2), post(c / 2)];
    },

    archPull: (m) => {
        const c = num(m, 'centers', 3);
        const d = num(m, 'diameter', 0.4);
        return [arch(c / 2, d / 2, num(m, 'projection', 1.2))];
    },

    cupPull: (m) => {
        const w = num(m, 'width', 3.75);
        const h = num(m, 'height', 1.4);
        const p = num(m, 'projection', 0.9);
        // A quarter-sphere hood: domed at the top and front, open underneath for fingers and
        // at the back where it meets the wood. (theta 0..90° keeps y >= 0; phi 0..180° keeps z >= 0.)
        const hood = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI, 0, Math.PI / 2).scale(w / 2, h, p);
        return [hood.translate(0, -h / 2, 0), box(w + 0.3, 0.22, PLATE, 0, h / 2, PLATE / 2)];
    },

    buttHinge: (m, length) => {
        const h = length ?? num(m, 'height', 2.5);
        const w = num(m, 'width', 1.75);
        const k = num(m, 'knuckle', 0.22);
        return [
            cyl(k / 2, h, 'x', 0, 0, k / 2),
            box(h, w / 2, PLATE, 0, w / 4, PLATE / 2),
            box(h, w / 2, PLATE, 0, -w / 4, PLATE / 2),
        ];
    },

    pianoHinge: (m, length) => BUILDERS.buttHinge(m, length ?? num(m, 'length', 12)),

    teeHinge: (m) => {
        const l = num(m, 'length', 6);
        const h = num(m, 'height', 3.25);
        const k = num(m, 'knuckle', 0.25);
        const strap = new THREE.CylinderGeometry(h * 0.12, h * 0.32, l, 4, 1).rotateZ(-Math.PI / 2);
        strap.scale(1, 1, PLATE / (h * 0.45)).translate(l / 2, 0, PLATE / 2);
        return [cyl(k / 2, h * 0.9, 'y', 0, 0, k / 2), box(1.1, h, PLATE, -0.55, 0, PLATE / 2), strap];
    },

    euroHinge: (m) => {
        const cup = num(m, 'cup', 1.378);
        const arm = num(m, 'arm', 2.4);
        // Seen from inside the cabinet: the cup's flange on the door, the arm reaching to the side.
        return [
            cyl(cup / 2 + 0.1, 0.1, 'z', 0, 0, 0.05, 24),
            box(arm, 0.55, 0.5, arm / 2, 0, 0.3),
            box(0.9, 1.5, 0.12, arm - 0.2, 0, 0.6),
        ];
    },

    slide: (m, length) => {
        const l = length ?? 12;
        return [box(l, num(m, 'height', 1.77), num(m, 'thickness', 0.5), 0, 0, num(m, 'thickness', 0.5) / 2)];
    },

    caster: (m) => {
        const wheel = num(m, 'wheel', 2);
        const height = num(m, 'height', wheel * 1.3);
        const plate = num(m, 'plate', wheel * 1.25);
        const tread = wheel * 0.3;
        const axleZ = height - wheel / 2;
        // A swivel caster trails its wheel behind the kingpin.
        const offset = m.swivel === true ? wheel * 0.28 : 0;
        const cheek = (y: number) =>
            box(wheel * 0.5, PLATE, axleZ + wheel * 0.12, offset, y, (axleZ + wheel * 0.12) / 2);
        const parts = [
            box(plate, plate * 0.8, 0.12, 0, 0, 0.06),
            cheek(tread / 2 + PLATE),
            cheek(-tread / 2 - PLATE),
            cyl(wheel / 2, tread, 'y', offset, 0, axleZ, 24),
        ];
        if (m.swivel === true) parts.push(cyl(plate * 0.3, 0.3, 'z', 0, 0, 0.27, 20));
        if (m.brake === true)
            parts.push(box(wheel * 0.45, tread * 0.9, 0.12, offset + wheel * 0.55, 0, axleZ - wheel * 0.25));
        return parts;
    },

    leveler: (m) => {
        const base = num(m, 'base', 1.5);
        const height = num(m, 'height', 1);
        const stem = num(m, 'stem', 0.3125);
        const pad = Math.min(0.3, height);
        const parts = [cyl(base / 2, pad, 'z', 0, 0, height - pad / 2, 24)];
        if (stem > 0 && height > pad) parts.push(cyl(stem / 2, height - pad, 'z', 0, 0, (height - pad) / 2));
        return parts;
    },

    cornerBracket: (m) => {
        const leg = num(m, 'leg', 2);
        const w = num(m, 'width', 0.75);
        const t = num(m, 'thickness', PLATE);
        return [box(leg, w, t, leg / 2, 0, t / 2), box(t, w, leg, t / 2, 0, leg / 2)];
    },

    flatPlate: (m) => {
        const t = num(m, 'thickness', PLATE);
        return [box(num(m, 'length', 2), num(m, 'width', 0.75), t, 0, 0, t / 2)];
    },

    shelfPin: (m) => {
        const d = num(m, 'diameter', 0.25);
        const l = num(m, 'length', 0.6);
        // The pin stands out of its hole; the flat on top is what the shelf rests on.
        return [cyl(d / 2, l, 'z', 0, 0, l / 2, 12), box(d * 1.6, d * 0.5, l * 0.6, 0, d * 0.75, l * 0.7)];
    },

    barrelBolt: (m) => {
        const l = num(m, 'length', 3);
        const w = num(m, 'width', 1.1);
        const p = num(m, 'projection', 0.55);
        return [
            box(l, w, PLATE, 0, 0, PLATE / 2),
            cyl(p * 0.32, l * 1.15, 'x', l * 0.1, 0, p * 0.6),
            cyl(p * 0.22, p * 0.9, 'z', -l * 0.15, 0, p * 0.75, 10),
        ];
    },

    hasp: (m) => {
        const l = num(m, 'length', 3);
        const w = num(m, 'width', 1.25);
        const p = num(m, 'projection', 0.35);
        const staple = arch(w * 0.22, 0.06, p + 0.25)
            .rotateZ(Math.PI / 2)
            .translate(l * 0.3, 0, 0);
        return [
            box(l * 0.4, w, PLATE, -l * 0.3, 0, PLATE / 2),
            box(l * 0.62, w * 0.62, PLATE, l * 0.16, 0, PLATE * 1.5),
            cyl(0.1, w, 'y', -l * 0.1, 0, 0.1, 10),
            staple,
        ];
    },

    block: (m) => {
        const p = num(m, 'projection', 0.55);
        return [box(num(m, 'length', 1.8), num(m, 'width', 0.6), p, 0, 0, p / 2)];
    },

    lidStay: (m) => {
        const l = num(m, 'length', 9);
        const w = num(m, 'width', 0.9);
        const p = num(m, 'projection', 0.7);
        const end = (x: number) => box(w, w, p, x, 0, p / 2);
        return [end(-l / 2 + w / 2), end(l / 2 - w / 2), box(l - w, w * 0.35, p * 0.4, 0, 0, p * 0.7)];
    },

    chestHandle: (m) => {
        const w = num(m, 'width', 4);
        const h = num(m, 'height', 2.2);
        const p = num(m, 'projection', 1);
        // A drop bail hanging below its pivots.
        const bail = new THREE.TorusGeometry(w * 0.36, 0.11, 8, 20, Math.PI).rotateZ(Math.PI);
        bail.scale(1, (h * 0.55) / (w * 0.36), 1).translate(0, h * 0.2, p * 0.55);
        const lug = (x: number) => box(0.3, 0.3, p * 0.6, x, h * 0.2, p * 0.3);
        return [box(w, h, PLATE, 0, 0, PLATE / 2), bail, lug(-w * 0.36), lug(w * 0.36)];
    },

    hook: (m) => {
        const h = num(m, 'height', 3.2);
        const w = num(m, 'width', 0.9);
        const p = num(m, 'projection', 1.9);
        const r = Math.min(w, 0.5) * 0.3;
        const prong = (x: number, reach: number, lip: number) => [
            cyl(r, reach, 'z', x, 0, reach / 2, 10),
            cyl(r, lip, 'x', x + lip / 2, 0, reach, 10),
        ];
        const parts = [box(h, w, 0.12, 0, 0, 0.06), ...prong(-h * 0.3, p, h * 0.3)];
        if (m.double === true) parts.push(...prong(h * 0.1, p * 0.55, h * 0.18));
        return parts;
    },
};

/** Something to show for an item this version does not know: a small plain block. */
function placeholder(): THREE.BufferGeometry {
    return box(1, 1, 0.5, 0, 0, 0.25);
}

/**
 * The geometry for a catalog model. `length` overrides the model's own for pieces cut or chosen
 * to fit (a slide as deep as its drawer, a piano hinge as long as its lid). A new geometry each
 * call: the caller owns it and disposes of it with the scene.
 */
export function buildHardwareGeometry(
    model: HardwareModel | undefined,
    length?: number,
): THREE.BufferGeometry {
    const build = model === undefined ? undefined : BUILDERS[model.shape];
    if (model === undefined || build === undefined) {
        return placeholder();
    }
    return merge(build(model, length));
}

/** Whether this version can draw the shape (else it is drawn as a placeholder block). */
export function knowsShape(shape: string): boolean {
    return shape in BUILDERS;
}
