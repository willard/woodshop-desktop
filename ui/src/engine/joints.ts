/**
 * Joint detection (build-plan §3.2). Joints are annotations, not constraints — this finds
 * where one part is geometrically seated in another's dado/groove so a drag-drop can record a
 * `joint`. Pure TS; the linter separately validates recorded joints (dado width == mate
 * thickness, mate seated). Conservative on purpose: a mate must be a thin board sitting edgewise
 * in the channel (matching the dado width), so a full-width neighbour that merely overlaps the
 * channel region is not mistaken for a joint.
 */
import * as THREE from 'three';
import type { Spec, Part, Joint, Op } from '../spec/types';
import { aabbFromPart, type AABB } from './snapping';

const DEG2RAD = Math.PI / 180;
const WIDTH_TOL = 0.03; // inches — thickness/width match tolerance

type DadoOp = Extract<Op, { type: 'dado' | 'groove' }>;

/** Extent of an AABB per axis. */
function extents(box: AABB): [number, number, number] {
    return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

function intersects(a: AABB, b: AABB, tol = 1e-3): boolean {
    for (let i = 0; i < 3; i += 1) {
        if (a.min[i] > b.max[i] + tol || b.min[i] > a.max[i] + tol) {
            return false;
        }
    }
    return true;
}

/** Transforms a local-frame box on `part` into a world-space AABB. */
function toWorld(part: Part, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): AABB {
    const box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    const [rx, ry, rz] = part.transform.rot;
    const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ'),
    );
    const [px, py, pz] = part.transform.pos;
    box.applyMatrix4(
        new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), quat, new THREE.Vector3(1, 1, 1)),
    );
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/** World-space AABB of a dado/groove channel on `host` (§3.1 offsets/faces/run extent). */
function channelAABB(host: Part, thickness: number, op: DadoOp): AABB {
    const { l, w } = host.size;
    const t = thickness;

    let x0 = -l / 2;
    let x1 = l / 2;
    let y0 = -w / 2;
    let y1 = w / 2;
    if (op.axis === 'l') {
        const cy = -w / 2 + op.offset;
        y0 = cy - op.width / 2;
        y1 = cy + op.width / 2;
        // Stopped channel: from/to trim the run (measured from the low run edge, w0).
        x0 = op.from !== undefined ? -l / 2 + op.from : x0;
        x1 = op.to !== undefined ? -l / 2 + op.to : x1;
    } else {
        const cx = -l / 2 + op.offset;
        x0 = cx - op.width / 2;
        x1 = cx + op.width / 2;
        y0 = op.from !== undefined ? -w / 2 + op.from : y0;
        y1 = op.to !== undefined ? -w / 2 + op.to : y1;
    }
    const z0 = op.face === 'front' ? t / 2 - op.depth : -t / 2;
    const z1 = op.face === 'front' ? t / 2 : -t / 2 + op.depth;

    return toWorld(host, x0, x1, y0, y1, z0, z1);
}

/**
 * Every dado/groove joint currently seated in the spec. A mate seats in a host's channel when
 * its thickness matches the dado width and it sits thin-edge-in across the channel width.
 */
export function detectDadoJoints(spec: Spec): Joint[] {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const thickness = (part: Part): number => thicknessOf.get(part.materialId) ?? 0;

    const joints: Joint[] = [];
    for (const host of spec.parts) {
        (host.ops ?? []).forEach((op, opRef) => {
            if (op.type !== 'dado' && op.type !== 'groove') {
                return;
            }
            const channel = channelAABB(host, thickness(host), op);
            const channelExtents = extents(channel);
            // The channel width maps to whichever world axis is ~op.width thick.
            const widthAxis = channelExtents
                .map((e, i) => [Math.abs(e - op.width), i] as const)
                .sort((a, b) => a[0] - b[0])[0][1];

            for (const insert of spec.parts) {
                if (insert.id === host.id || Math.abs(thickness(insert) - op.width) > WIDTH_TOL) {
                    continue;
                }
                const insertBox = aabbFromPart(insert, thickness(insert));
                // Seated = overlaps the channel AND is thin (≈ width) across the channel's width axis.
                if (
                    intersects(channel, insertBox) &&
                    Math.abs(extents(insertBox)[widthAxis] - op.width) <= WIDTH_TOL
                ) {
                    joints.push({ type: 'dado', hostPartId: host.id, insertPartId: insert.id, opRef });
                }
            }
        });
    }
    return joints;
}

/** Slab reach past the edge — catches abutting mates (TOUCH_TOL abutment is 0.02"). */
const POCKET_PAD = 0.05;

/** The slab's run is shrunk so a perpendicular neighbour at the corner isn't read as a mate. */
const POCKET_RUN_INSET = 0.5;

/**
 * World-space slab just outside the named edge — where a pocket-screwed mate would sit.
 * Edges per §3.1: l0 = y −w/2, l1 = y +w/2, w0 = x −l/2, w1 = x +l/2.
 */
function edgeAABB(part: Part, thickness: number, edge: 'l0' | 'l1' | 'w0' | 'w1'): AABB {
    const { l, w } = part.size;
    const t = thickness;
    const inset = (dim: number): number => Math.min(POCKET_RUN_INSET, dim / 4);

    let x0 = -l / 2 + inset(l);
    let x1 = l / 2 - inset(l);
    let y0 = -w / 2 + inset(w);
    let y1 = w / 2 - inset(w);
    if (edge === 'l0') {
        y0 = -w / 2 - POCKET_PAD;
        y1 = -w / 2 + POCKET_PAD;
    } else if (edge === 'l1') {
        y0 = w / 2 - POCKET_PAD;
        y1 = w / 2 + POCKET_PAD;
    } else if (edge === 'w0') {
        x0 = -l / 2 - POCKET_PAD;
        x1 = -l / 2 + POCKET_PAD;
    } else {
        x0 = l / 2 - POCKET_PAD;
        x1 = l / 2 + POCKET_PAD;
    }
    return toWorld(part, x0, x1, y0, y1, -t / 2, t / 2);
}

/**
 * Every pocket-screw joint currently seated: a part with a pocketHoles op whose edge abuts
 * another part. Host = the op owner (the part the screws pass through), matching the dado
 * "host owns the op" convention so RemoveOp's joint bookkeeping and the linter's opRef
 * checks apply unchanged; insert = the part the screws bite into.
 */
export function detectPocketScrewJoints(spec: Spec): Joint[] {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const thickness = (part: Part): number => thicknessOf.get(part.materialId) ?? 0;

    const joints: Joint[] = [];
    for (const host of spec.parts) {
        (host.ops ?? []).forEach((op, opRef) => {
            if (op.type !== 'pocketHoles') {
                return;
            }
            const slab = edgeAABB(host, thickness(host), op.edge);
            for (const insert of spec.parts) {
                if (insert.id === host.id) {
                    continue;
                }
                if (intersects(slab, aabbFromPart(insert, thickness(insert)), 0.02)) {
                    joints.push({ type: 'pocketScrew', hostPartId: host.id, insertPartId: insert.id, opRef });
                }
            }
        });
    }
    return joints;
}

/**
 * Every wood-screw joint currently seated: a part with a `screws` op whose opposite face abuts
 * another part. Screw heads sit on the named face and the tips come out the other side, so the
 * mate is whatever the far face lands on. Host = the op owner (the part the screws pass through),
 * matching the pocket-screw and dado conventions.
 */
export function detectScrewJoints(spec: Spec): Joint[] {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const thickness = (part: Part): number => thicknessOf.get(part.materialId) ?? 0;

    const joints: Joint[] = [];
    for (const host of spec.parts) {
        (host.ops ?? []).forEach((op, opRef) => {
            if (op.type !== 'screws') {
                return;
            }
            const t = thickness(host);
            const { l, w } = host.size;
            // A slab just outside the far face, trimmed to the screw row so a part touching
            // some other corner of the same face isn't read as the mate.
            const run = op.axis === 'l' ? l : w;
            const from = op.from ?? 0;
            const to = op.to ?? run;
            const centre = (from + to) / 2;
            const half = Math.max((to - from) / 2, POCKET_PAD);
            const x = op.axis === 'l' ? [centre - half, centre + half] : [op.offset, op.offset];
            const y = op.axis === 'l' ? [op.offset, op.offset] : [centre - half, centre + half];
            const z = op.face === 'front' ? [-t / 2 - POCKET_PAD, -t / 2] : [t / 2, t / 2 + POCKET_PAD];
            const slab = toWorld(
                host,
                -l / 2 + x[0],
                -l / 2 + x[1],
                -w / 2 + y[0],
                -w / 2 + y[1],
                z[0],
                z[1],
            );
            for (const insert of spec.parts) {
                if (insert.id === host.id) {
                    continue;
                }
                if (intersects(slab, aabbFromPart(insert, thickness(insert)), 0.02)) {
                    joints.push({ type: 'screw', hostPartId: host.id, insertPartId: insert.id, opRef });
                }
            }
        });
    }
    return joints;
}

/** Merges freshly detected joints into the existing set, de-duplicated. Never removes joints. */
export function mergeJoints(existing: readonly Joint[], detected: readonly Joint[]): Joint[] {
    const key = (j: Joint): string => `${j.type}|${j.hostPartId}|${j.insertPartId}|${j.opRef ?? ''}`;
    const seen = new Set(existing.map(key));
    const merged = [...existing];
    for (const joint of detected) {
        if (!seen.has(key(joint))) {
            seen.add(key(joint));
            merged.push(joint);
        }
    }
    return merged;
}
