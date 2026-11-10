/**
 * Wood materials for the renderer. Pure with respect to the spec: colour is a
 * deterministic function of the material id so a given design always looks the same.
 *
 * Grain is honoured via a procedural streak texture rotated to the part's grainAxis
 * (build-plan §3.1: grainAxis "l" runs along local +X). Texture generation needs a 2D
 * canvas context; when none is available (e.g. jsdom under Vitest) we fall back to a
 * flat colour, so the scene-graph builder stays testable without WebGL.
 */
import * as THREE from 'three';
import type { Material, Part, Species } from '../spec/types';

/** Warm shop-friendly wood tones (linear-ish sRGB hex). */
const WOOD_TONES = [0xb98a55, 0xc9a06a, 0xa9743f, 0xd8b483, 0x8a5a34, 0xcaa472] as const;

/** Species tints (spec 1.3): pale pine → dark walnut, reddish cherry. */
/** Per-species base tone. Exported so theming can assert wood stays legible (D74). */
export const SPECIES_TONES: Record<Species, number> = {
    pine: 0xd8b483,
    oak: 0xc9a06a,
    maple: 0xe4cf9e,
    walnut: 0x6b4a2f,
    cherry: 0x9c5a3c,
};

/** A material factory the scene builder calls per part. */
export type MaterialProvider = (material: Material, part: Part) => THREE.Material;

function hashId(id: string): number {
    let h = 2166136261;
    for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Deterministic wood tone for a material: its species tint, else a stable id-hash tone. */
export function woodColorFor(material: Material): number {
    if (material.species !== undefined) {
        return SPECIES_TONES[material.species];
    }
    return WOOD_TONES[hashId(material.id) % WOOD_TONES.length];
}

/** Flat-colour wood material — no canvas needed, used by tests and as a fallback. */
export function createFlatWoodMaterial(material: Material): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: woodColorFor(material),
        roughness: 0.72,
        metalness: 0.02,
    });
}

/**
 * Builds a tiled procedural grain texture, or null when no 2D canvas context exists.
 * The texture runs vertically; callers rotate it per part to match grainAxis.
 */
export function createGrainTexture(): THREE.Texture | null {
    if (typeof document === 'undefined') {
        return null;
    }
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
        return null;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    // Subtle vertical streaks; multiplied against the base colour via .map.
    for (let x = 0; x < size; x += 1) {
        const n = (Math.sin(x * 0.7) + Math.sin(x * 0.13) + Math.sin(x * 2.3)) / 3;
        const shade = 200 + Math.round(n * 40);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x, 0, 1, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.center.set(0.5, 0.5);
    return texture;
}

/**
 * Returns a MaterialProvider that applies wood colour plus, when supplied, a grain
 * texture rotated to each part's grainAxis. Pass `grain: null` for the flat fallback.
 */
export function woodMaterialProvider(grain: THREE.Texture | null): MaterialProvider {
    return (material, part) => {
        if (grain === null) {
            return createFlatWoodMaterial(material);
        }
        const map = grain.clone();
        map.needsUpdate = true;
        // grainAxis "w" runs along local +Y → rotate the vertical streaks 90°.
        map.rotation = part.grainAxis === 'w' ? Math.PI / 2 : 0;
        const mat = createFlatWoodMaterial(material);
        mat.map = map;
        return mat;
    };
}
