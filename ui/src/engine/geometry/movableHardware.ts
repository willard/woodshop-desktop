/**
 * The hardware a door or drawer hangs on, as geometry (§3.3, spec 1.12) — hinges, knobs, and
 * slide rails. Small deliberately: at furniture zoom a hinge is a few pixels, so these read as
 * "there is metal here" rather than modelling a particular manufacturer's leaf pattern.
 *
 * Placement is the caller's job (movablePlacement.ts); everything here is centred on its own
 * origin, oriented for a mount whose outward direction is +Z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A butt hinge's barrel length — the visible bit down the edge of a door. */
export const HINGE_LENGTH = 2;

const BARREL_RADIUS = 0.15;
const LEAF_THICKNESS = 0.08;
const LEAF_REACH = 0.75;

/**
 * A hinge: the barrel plus one leaf. Built with the barrel on the origin running along local Y
 * (the hinge line) and the leaf reaching along −Z, so the caller only has to place and aim it.
 */
export function hingeGeometry(): THREE.BufferGeometry {
    const barrel = new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, HINGE_LENGTH, 12);
    const leaf = new THREE.BoxGeometry(LEAF_THICKNESS, HINGE_LENGTH * 0.9, LEAF_REACH);
    leaf.translate(0, 0, -LEAF_REACH / 2 - BARREL_RADIUS / 2);

    const merged = mergeGeometries([barrel, leaf], false);
    barrel.dispose();
    leaf.dispose();
    return merged ?? new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, HINGE_LENGTH, 12);
}

/** A knob: a short post with a round head, standing along +Z from the face it mounts on. */
export function knobGeometry(): THREE.BufferGeometry {
    const post = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12);
    post.rotateX(Math.PI / 2);
    post.translate(0, 0, 0.25);
    const head = new THREE.SphereGeometry(0.35, 14, 10);
    head.translate(0, 0, 0.6);

    const merged = mergeGeometries([post, head], false);
    post.dispose();
    head.dispose();
    return merged ?? new THREE.SphereGeometry(0.35, 14, 10);
}

/** A slide rail: a thin bar running the length of the drawer box along local Z. */
export function slideRailGeometry(length: number): THREE.BufferGeometry {
    return new THREE.BoxGeometry(0.1, 0.75, Math.max(length, 0.5));
}

/**
 * Brushed nickel. Kept light and only slightly metallic: the scene has no environment to reflect,
 * so a truly metallic surface renders near black and disappears against wood.
 */
export function createHardwareMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.25, roughness: 0.42 });
}
