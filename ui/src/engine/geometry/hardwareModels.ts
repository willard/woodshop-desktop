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

/** A flat outline as sheet metal: extruded PLATE thick, from the surface out (+Z). */
function plate(shape: THREE.Shape): THREE.BufferGeometry {
    return new THREE.ExtrudeGeometry(shape, { depth: PLATE, bevelEnabled: false, curveSegments: 8 });
}

/** A rectangle from (x0, y0) to (x1, y1) with its corners rounded by `r`. */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
    const s = new THREE.Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x1, y1 - r);
    s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
    s.lineTo(x0 + r, y1);
    s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x0, y0 + r);
    s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
}

/** A pan screw head sitting on a plate at (x, y). */
function screwHead(x: number, y: number): THREE.BufferGeometry {
    return new THREE.SphereGeometry(0.09, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2)
        .rotateX(Math.PI / 2)
        .scale(1, 1, 0.45)
        .translate(x, y, PLATE);
}

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
        // The crossbar of the T is a leaf on the frame (−X); the strap runs out across the door
        // (+X), tapering to a rounded tip. Both are plate, joined by a knuckle along Y.
        const leafW = Math.max(0.8, h * 0.34);
        const leaf = plate(roundedRect(-leafW, -h / 2, 0, h / 2, 0.08));
        const root = h * 0.32;
        const tip = Math.max(h * 0.15, 0.3);
        const strap = new THREE.Shape();
        strap.moveTo(0, -root / 2);
        strap.lineTo(l - tip / 2, -tip / 2);
        strap.absarc(l - tip / 2, 0, tip / 2, -Math.PI / 2, Math.PI / 2, false);
        strap.lineTo(0, root / 2);
        strap.closePath();
        // Three barrels with a hairline between, and the pin's head and foot.
        const gap = 0.03;
        const barrel = (h * 0.9 - 2 * gap) / 3;
        const knuckle = [-1, 0, 1].map((i) => cyl(k / 2, barrel, 'y', 0, i * (barrel + gap), k / 2));
        const pinEnd = (y: number) => cyl(k * 0.3, 0.06, 'y', 0, y, k / 2, 10);
        const screws = [
            screwHead(-leafW / 2, h * 0.32),
            screwHead(-leafW / 2, -h * 0.32),
            ...[0.3, 0.6].map((f) => screwHead(l * f, 0)),
            screwHead(l - tip / 2, 0),
        ];
        return [leaf, plate(strap), ...knuckle, pinEnd(h * 0.45 + 0.03), pinEnd(-h * 0.45 - 0.03), ...screws];
    },

    euroHinge: (m) => {
        const cup = num(m, 'cup', 1.378);
        const boring = num(m, 'boring', 0.886);
        // Local +X runs from the cup toward the hinge edge, +Z back into the cabinet. The cabinet
        // side's inside face sits `boring - overlay` from the cup: past the door edge on an inset
        // door, under it on an overlay one. The arm crosses to that face and runs back along it
        // to the mounting plate, so nothing pokes out through the side.
        const wall = boring - num(m, 'overlay', 0.5);
        const back = Math.min(num(m, 'arm', 2.4), 1.6);
        return [
            cyl(cup / 2 + 0.1, 0.1, 'z', 0, 0, 0.05, 24),
            box(Math.max(wall, 0.2), 0.55, 0.3, wall / 2, 0, 0.25),
            box(0.4, 0.55, back, wall - 0.32, 0, 0.1 + back / 2),
            box(0.12, 1.5, 1.4, wall - 0.06, 0, 0.3 + 0.7),
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

    foldingBracket: (m) => {
        // Locked out: the leg flat on the post (along X, its top at +X), the arm standing out from
        // the top of it (+Z), and the folding brace from the foot of the leg up to the arm.
        const arm = num(m, 'arm', 12);
        const leg = num(m, 'leg', 9);
        const w = num(m, 'width', 1.5);
        const t = num(m, 'thickness', 0.12);
        const run = leg - t;
        const rise = arm * 0.6;
        const brace = box(Math.hypot(run, rise), w * 0.6, t)
            .rotateY(-Math.atan2(rise, run))
            .translate(0, 0, rise / 2 + t);
        return [box(leg, w, t, 0, 0, t / 2), box(t, w, arm, leg / 2 - t / 2, 0, arm / 2), brace];
    },

    flatPlate: (m) => {
        const t = num(m, 'thickness', PLATE);
        return [box(num(m, 'length', 2), num(m, 'width', 0.75), t, 0, 0, t / 2)];
    },

    shelfPin: (m) => {
        const d = num(m, 'diameter', 0.25);
        // The shank is in its hole; what shows is a collar against the wood and the spoon the
        // shelf rests on, flat on top (+Y), reaching out about as far as the shank goes in.
        const reach = num(m, 'length', 0.6) * 0.6;
        const collar = 0.04;
        const w = d * 1.4;
        const spoon = new THREE.Shape();
        spoon.moveTo(-w / 2, 0);
        spoon.lineTo(w / 2, 0);
        spoon.lineTo(w / 2, reach - w / 2);
        spoon.absarc(0, reach - w / 2, w / 2, 0, Math.PI, false);
        spoon.closePath();
        const t = d * 0.28;
        // Drawn in X/out, extruded down: rotateX(90°) turns the shape's y into +Z (out of the wall).
        const pad = new THREE.ExtrudeGeometry(spoon, { depth: t, bevelEnabled: false })
            .rotateX(Math.PI / 2)
            .translate(0, d * 0.2, 0);
        return [
            cyl(d * 0.8, collar, 'z', 0, 0, collar / 2, 16),
            cyl(d / 2, d * 0.5, 'z', 0, 0, d * 0.25, 12),
            pad,
        ];
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
