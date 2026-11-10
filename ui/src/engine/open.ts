/**
 * Open/close math for doors and drawers (§3.3, spec 1.12) — the sibling of `explode.ts`.
 *
 * Like the exploded view this is a *presentation* transform (hard rule 1 / §3.2): the spec stores
 * the CLOSED state, these poses are handed straight to the meshes, and a factor of 0 restores
 * every part to its authored transform exactly. Nothing here writes to the document.
 *
 * A door swings about the front arris of its hinge edge; a drawer slides along its front's face
 * normal. Both come from the annotation plus the parts' own transforms — no extra geometry is
 * stored, so a door that is dragged or resized keeps hinging correctly.
 */
import * as THREE from 'three';
import type { Spec, Part, Movable } from '../spec/types';
import type { Vec3 } from './snapping';
import { extentAlong, frontNormal, movableAnchorId } from '../spec/movables';
import { DEFAULT_OPEN_CONFIG, type OpenConfig } from './config';

/** Where a part sits while the assembly is open. `quat` is [x, y, z, w]. */
export interface OpenPose {
    pos: Vec3;
    quat: [number, number, number, number];
}

const DEG2RAD = Math.PI / 180;

/** The hinge line in the panel's LOCAL frame: a point on it and its direction (§3.3 table). */
export function hingeLineLocal(
    panel: Part,
    thickness: number,
    hingeEdge: 'l0' | 'l1' | 'w0' | 'w1',
): { point: Vec3; direction: Vec3 } {
    const halfL = panel.size.l / 2;
    const halfW = panel.size.w / 2;
    const front = thickness / 2; // the +Z arris — where a hinge barrel actually sits
    switch (hingeEdge) {
        case 'l0':
            return { point: [0, -halfW, front], direction: [1, 0, 0] };
        case 'l1':
            return { point: [0, halfW, front], direction: [1, 0, 0] };
        case 'w0':
            return { point: [-halfL, 0, front], direction: [0, 1, 0] };
        case 'w1':
            return { point: [halfL, 0, front], direction: [0, 1, 0] };
    }
}

/** The midpoint of the edge opposite the hinge, in the panel's local frame (the free edge). */
function freeEdgeLocal(panel: Part, hingeEdge: 'l0' | 'l1' | 'w0' | 'w1'): Vec3 {
    const halfL = panel.size.l / 2;
    const halfW = panel.size.w / 2;
    switch (hingeEdge) {
        case 'l0':
            return [0, halfW, 0];
        case 'l1':
            return [0, -halfW, 0];
        case 'w0':
            return [halfL, 0, 0];
        case 'w1':
            return [-halfL, 0, 0];
    }
}

function quatOf(part: Part): THREE.Quaternion {
    const [rx, ry, rz] = part.transform.rot ?? [0, 0, 0];
    return new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ'),
    );
}

function posOf(part: Part): THREE.Vector3 {
    const [x, y, z] = part.transform.pos;
    return new THREE.Vector3(x, y, z);
}

/**
 * The world hinge axis and pivot for a door, plus the direction its free edge travels when the
 * door opens. Exported for the renderer, which mounts the hinges on this same line.
 */
export function doorHinge(
    panel: Part,
    thickness: number,
    hingeEdge: 'l0' | 'l1' | 'w0' | 'w1',
): { pivot: THREE.Vector3; axis: THREE.Vector3; sign: number } {
    const quat = quatOf(panel);
    const local = hingeLineLocal(panel, thickness, hingeEdge);
    const pivot = new THREE.Vector3(...local.point).applyQuaternion(quat).add(posOf(panel));
    const axis = new THREE.Vector3(...local.direction).applyQuaternion(quat).normalize();

    // The door opens toward its show face: take the sign that sends the free edge that way.
    const normal = new THREE.Vector3(...frontNormal(panel));
    const free = new THREE.Vector3(...freeEdgeLocal(panel, hingeEdge))
        .applyQuaternion(quat)
        .add(posOf(panel));
    const velocity = new THREE.Vector3().crossVectors(axis, free.clone().sub(pivot));

    return { pivot, axis, sign: velocity.dot(normal) >= 0 ? 1 : -1 };
}

/**
 * Where every movable part sits at `factor` open (0 = closed, 1 = fully open). Parts that belong
 * to no movable are absent from the map — the caller leaves them at their authored transform.
 */
export function openedPoses(
    spec: Spec,
    factor: number,
    config: OpenConfig = DEFAULT_OPEN_CONFIG,
): Map<string, OpenPose> {
    const poses = new Map<string, OpenPose>();
    const clamped = Math.min(1, Math.max(0, factor));
    const partsById = new Map<string, Part>(spec.parts.map((p) => [p.id, p]));
    const thicknessOf = (part: Part): number =>
        spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;

    for (const movable of spec.movables ?? []) {
        const anchor = partsById.get(movableAnchorId(movable));
        if (anchor === undefined) {
            continue; // the linter reports the dangling ref; the view just leaves it closed
        }
        const members = movable.partIds
            .map((id: string) => partsById.get(id))
            .filter((part: Part | undefined): part is Part => part !== undefined);

        if (movable.kind === 'door') {
            applyDoor(movable, anchor, members, thicknessOf(anchor), clamped, config, poses);
        } else {
            applyDrawer(anchor, members, thicknessOf, clamped, config, poses);
        }
    }

    return poses;
}

function applyDoor(
    movable: Extract<Movable, { kind: 'door' }>,
    panel: Part,
    members: readonly Part[],
    thickness: number,
    factor: number,
    config: OpenConfig,
    poses: Map<string, OpenPose>,
): void {
    const { pivot, axis, sign } = doorHinge(panel, thickness, movable.hingeEdge);
    const angle = sign * factor * config.doorSwingDeg * DEG2RAD;
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);

    for (const member of members) {
        // Rigid: swing the member's centre about the hinge line and turn it by the same amount.
        const centre = posOf(member).sub(pivot).applyQuaternion(rotation).add(pivot);
        const quat = rotation.clone().multiply(quatOf(member));
        poses.set(member.id, {
            pos: [centre.x, centre.y, centre.z],
            quat: [quat.x, quat.y, quat.z, quat.w],
        });
    }
}

function applyDrawer(
    front: Part,
    members: readonly Part[],
    thicknessOf: (part: Part) => number,
    factor: number,
    config: OpenConfig,
    poses: Map<string, OpenPose>,
): void {
    const normal = frontNormal(front);
    // Travel a fraction of the box's own depth, so a full-open drawer stays engaged in its
    // slides the way a real stop holds it.
    const depth = extentAlong(members, thicknessOf, normal);
    const travel = factor * config.drawerTravelFraction * depth;

    for (const member of members) {
        const quat = quatOf(member);
        poses.set(member.id, {
            pos: [
                member.transform.pos[0] + normal[0] * travel,
                member.transform.pos[1] + normal[1] * travel,
                member.transform.pos[2] + normal[2] * travel,
            ],
            quat: [quat.x, quat.y, quat.z, quat.w],
        });
    }
}
