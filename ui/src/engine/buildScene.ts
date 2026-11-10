/**
 * Pure spec → Three.js scene-graph mapping. No WebGL, no canvas, no Vue — safe to run
 * under Vitest/jsdom. The renderer is a pure function of the spec (CLAUDE.md hard rule 1).
 *
 * Local part frame (build-plan §3.1, LOCKED): length = +X, width = +Y, thickness = +Z,
 * origin at the part centre. transform.pos places that centre in world inches (y-up);
 * transform.rot is intrinsic XYZ Euler degrees applied about the centre before translation.
 */
import * as THREE from 'three';
import type { Spec, Part, Material, Vec3 } from '../spec/types';
import { createFlatWoodMaterial, type MaterialProvider } from './materials';
import { buildPartGeometry } from './geometry/partGeometry';
import {
    pocketScrewGeometry,
    woodScrewGeometry,
    pocketMouthGeometry,
    countersinkGeometry,
    createScrewMaterial,
    createBoreMaterial,
    POCKET_BORE_RADIUS,
} from './geometry/screwGeometry';
import { fastenerSegments, type FastenerOp } from './fastenerPlacement';
import { hardwarePlacements } from './movablePlacement';
import { buildHardwareGeometry } from './geometry/hardwareModels';
import { findItem, mountFrame } from '@/hardware/catalog';
import {
    hingeGeometry,
    knobGeometry,
    slideRailGeometry,
    createHardwareMaterial,
} from './geometry/movableHardware';
import { POCKET_ANGLE } from '../spec/fasteners';

const DEG2RAD = Math.PI / 180;

/** Builds a single part mesh in world space. Thickness comes from the material (§3.1); dado /
 *  groove / rabbet ops are cut procedurally into the geometry (no CSG). */
export function buildPartMesh(
    part: Part,
    material: Material,
    materialProvider: MaterialProvider,
): THREE.Mesh {
    const geometry = buildPartGeometry(part, material.thickness, material.type === 'round');
    const mesh = new THREE.Mesh(geometry, materialProvider(material, part));

    const [px, py, pz] = part.transform.pos;
    mesh.position.set(px, py, pz);

    const [rx, ry, rz] = part.transform.rot ?? [0, 0, 0];
    mesh.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, 'XYZ');

    mesh.name = part.id;
    mesh.userData = { partId: part.id, materialId: part.materialId, grainAxis: part.grainAxis };
    addFasteners(mesh, part, material.thickness);
    return mesh;
}

/** Screw geometry is modelled head-at-origin running down local −Y (screwGeometry.ts). */
const SCREW_AXIS = new THREE.Vector3(0, -1, 0);

/** How far a head or a hole's mouth stands off the surface so it never z-fights the wood. */
const SURFACE_LIFT = 0.006;

/**
 * The mouth of the pocket hole this screw came out of — the long dark oval on the face, which on a
 * real piece is the only outward sign of a pocket screw (the head is down the hole). Marker-only
 * ops cut no geometry, so it is drawn as a disc lying on the surface, stretched the way a 15° bore
 * really opens up: as long as it is wide, divided by the sine of that angle.
 *
 * Returns null when the head has no wood behind it to bore through (a screw longer than the board).
 */
function pocketMouth(
    segment: { head: THREE.Vector3; direction: THREE.Vector3 },
    op: Extract<FastenerOp, { type: 'pocketHoles' }>,
    thickness: number,
    material: THREE.Material,
): THREE.Mesh | null {
    // Walk back down the screw's axis to the face it was drilled from (spec 1.9: `front` or the
    // default `back`); the screw climbs away from that face, so its z travel points at it.
    const fromFront = op.face === 'front';
    const facePlane = fromFront ? thickness / 2 : -thickness / 2;
    const toFace = (segment.head.z - facePlane) / segment.direction.z;
    if (!Number.isFinite(toFace) || toFace <= 0) {
        return null;
    }
    const centre = segment.head.clone().addScaledVector(segment.direction, -toFace);

    const mouth = new THREE.Mesh(pocketMouthGeometry(POCKET_BORE_RADIUS), material);
    mouth.userData = { fastener: 'pocketMouth' };
    mouth.position.set(centre.x, centre.y, facePlane + (fromFront ? SURFACE_LIFT : -SURFACE_LIFT));
    // Stretched along the direction the bore runs across the face.
    const stretch = 1 / Math.sin(POCKET_ANGLE);
    if (op.edge === 'l0' || op.edge === 'l1') {
        mouth.scale.y = stretch;
    } else {
        mouth.scale.x = stretch;
    }
    return mouth;
}

/**
 * Fasteners are annotations, not geometry (build-plan §3.1: pocketHoles and screws are marker-only
 * ops that cut nothing) — but they are drawn where the metal actually goes, because "is this
 * pocket-screwed or screwed through the face?" is a question you answer by looking. Where that is
 * comes from `fastenerSegments`, the same answer the planners check their work against.
 *
 * What you see from outside is what you would see in the shop: a wood screw shows its head, sitting
 * proud of the surface by a hair so it reads at a glance; a pocket screw shows the oval mouth of
 * its hole, because the head is buried at the bottom of it.
 */
function addFasteners(mesh: THREE.Mesh, part: Part, thickness: number): void {
    const fasteners = (part.ops ?? []).filter(
        (op): op is FastenerOp => op.type === 'pocketHoles' || op.type === 'screws',
    );
    if (fasteners.length === 0) {
        return;
    }
    const material = createScrewMaterial();
    let boreMaterial: THREE.Material | null = null;

    for (const op of fasteners) {
        const segments = fastenerSegments(part, thickness, op);
        const geometry =
            op.type === 'pocketHoles'
                ? pocketScrewGeometry(segments[0]?.length ?? 0)
                : woodScrewGeometry(segments[0]?.length ?? 0, op.gauge);

        for (const segment of segments) {
            const screw = new THREE.Mesh(geometry, material);
            // Heads sit a hair proud of the face rather than exactly in it: coplanar surfaces
            // z-fight, and a head that flickers in and out is worse than no head at all.
            screw.position.copy(segment.head).addScaledVector(segment.direction, -SURFACE_LIFT);
            screw.quaternion.setFromUnitVectors(SCREW_AXIS, segment.direction);
            screw.userData = { fastener: op.type === 'screws' ? 'screw' : 'pocketScrew' };
            mesh.add(screw);

            boreMaterial = boreMaterial ?? createBoreMaterial();
            if (op.type === 'pocketHoles') {
                const mouth = pocketMouth(segment, op, thickness, boreMaterial);
                if (mouth !== null) {
                    mesh.add(mouth);
                }
                continue;
            }
            // The countersink the head sits in: it is what makes a screwed face read as screwed
            // at model zoom, where 1/3" of steel is a couple of pixels.
            const sink = new THREE.Mesh(countersinkGeometry(op.gauge), boreMaterial);
            sink.position.copy(segment.head).addScaledVector(segment.direction, -SURFACE_LIFT / 2);
            sink.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 0, 1),
                segment.direction.clone().negate(),
            );
            sink.userData = { fastener: 'countersink' };
            mesh.add(sink);
        }
    }
}

/**
 * Builds a Group containing one mesh per part entry. Throws if a part references a
 * material the spec doesn't declare (a structural error the linter also catches in 1b).
 */
export function buildSpecGroup(
    spec: Spec,
    materialProvider: MaterialProvider = (material) => createFlatWoodMaterial(material),
): THREE.Group {
    const materialsById = new Map<string, Material>(spec.materials.map((m) => [m.id, m]));
    const group = new THREE.Group();
    group.name = 'spec-parts';

    const meshesById = new Map<string, THREE.Mesh>();
    for (const part of spec.parts) {
        const material = materialsById.get(part.materialId);
        if (material === undefined) {
            throw new Error(`Part "${part.id}" references unknown material "${part.materialId}".`);
        }
        const mesh = buildPartMesh(part, material, materialProvider);
        meshesById.set(part.id, mesh);
        group.add(mesh);
    }

    addMovableHardware(spec, meshesById);
    addMountedHardware(spec, meshesById, materialsById);

    return group;
}

/** Places `piece` at `pos` with its long axis along `x` and its outward direction along `z`. */
function orient(piece: THREE.Object3D, pos: Vec3, x: Vec3, z: Vec3): void {
    const vx = new THREE.Vector3(...x).normalize();
    const vz = new THREE.Vector3(...z).normalize();
    const vy = new THREE.Vector3().crossVectors(vz, vx);
    piece.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vx, vy, vz));
    piece.position.set(pos[0], pos[1], pos[2]);
}

/**
 * Catalog hardware mounted on parts (spec 1.15): pulls, casters, brackets, latches. Children of
 * the part's mesh, like the fasteners and a movable's hardware, so each piece rides a drag, the
 * exploded view and a door swing with the part it is screwed to.
 */
function addMountedHardware(
    spec: Spec,
    meshesById: Map<string, THREE.Mesh>,
    materialsById: Map<string, Material>,
): void {
    const mounts = spec.hardware ?? [];
    if (mounts.length === 0) {
        return;
    }
    const material = createHardwareMaterial();
    const partsById = new Map(spec.parts.map((p) => [p.id, p]));

    for (const mount of mounts) {
        const part = partsById.get(mount.partId);
        const mesh = meshesById.get(mount.partId);
        if (part === undefined || mesh === undefined) {
            continue; // the linter reports the dangling reference
        }
        const thickness = materialsById.get(part.materialId)?.thickness ?? 0.75;
        const frame = mountFrame(part, thickness, mount);
        const piece = new THREE.Mesh(buildHardwareGeometry(findItem(mount.item)?.model), material);
        orient(piece, frame.point, frame.along, frame.normal);
        // Quarter turns about the outward normal, which is the piece's own +Z.
        piece.rotateZ(((mount.rot ?? 0) * Math.PI) / 180);
        piece.userData = { hardware: 'mount', hardwareId: mount.id, itemId: mount.item };
        mesh.add(piece);
    }
}

/**
 * Hangs each movable's hardware off the part it mounts on (§3.3). Children in the part's local
 * frame, like the fasteners above: the metal then rides every view transform — a drag, the
 * exploded view, and the door swing itself — without anyone having to move it.
 */
function addMovableHardware(spec: Spec, meshesById: Map<string, THREE.Mesh>): void {
    const movables = spec.movables ?? [];
    if (movables.length === 0) {
        return;
    }
    const material = createHardwareMaterial();
    const hinge = hingeGeometry();

    for (const movable of movables) {
        for (const placement of hardwarePlacements(spec, movable)) {
            const mesh = meshesById.get(placement.partId);
            if (mesh === undefined) {
                continue;
            }
            const item = findItem(placement.itemId);
            let piece: THREE.Mesh;
            if (item !== undefined && placement.kind === 'slideRail') {
                // A rail keeps its place down the side of the box; the item sets its section.
                const t = typeof item.model.thickness === 'number' ? item.model.thickness : 0.5;
                const h = typeof item.model.height === 'number' ? item.model.height : 1.77;
                piece = new THREE.Mesh(
                    new THREE.BoxGeometry(t, h, Math.max(placement.length ?? 1, 0.5)),
                    material,
                );
                piece.position.set(placement.pos[0], placement.pos[1], placement.pos[2]);
            } else if (item !== undefined && placement.basis !== undefined) {
                piece = new THREE.Mesh(buildHardwareGeometry(item.model, placement.length), material);
                orient(piece, placement.pos, placement.basis.x, placement.basis.z);
            } else {
                const geometry =
                    placement.kind === 'hinge'
                        ? hinge
                        : placement.kind === 'knob'
                          ? knobGeometry()
                          : slideRailGeometry(placement.length ?? 1);
                piece = new THREE.Mesh(geometry, material);
                piece.position.set(placement.pos[0], placement.pos[1], placement.pos[2]);
                piece.rotation.z = placement.spinZ;
            }
            piece.userData = { hardware: placement.kind, movableId: movable.id, itemId: placement.itemId };
            mesh.add(piece);
        }
    }
}
