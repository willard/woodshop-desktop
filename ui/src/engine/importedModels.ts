/**
 * Imported 3D models (spec 1.22): a GLB or STL file someone brings in to show with a piece, such
 * as a client's own tool box on a shelf. On import the file is read, sized and stood upright, then
 * kept as one GLB in Woodshop's own frame: inches, +Y up, standing on y = 0, centred on its
 * footprint, its length along X. Props then place that GLB like any other prop.
 *
 * A model must be self-contained: a GLB that points at other files (textures beside it, a web
 * address) is refused, so the design and the 3D plan never reach outside themselves.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type ModelFormat = 'glb' | 'stl';

/** The unit a file's numbers are in, as inches per unit. glTF is metres; STL has no unit. */
export const UNITS = {
    m: { label: 'metres', inches: 1 / 0.0254 },
    cm: { label: 'centimetres', inches: 1 / 2.54 },
    mm: { label: 'millimetres', inches: 1 / 25.4 },
    in: { label: 'inches', inches: 1 },
} as const;
export type FileUnit = keyof typeof UNITS;

/** The most an imported model may be once converted, as the library keeps it. */
export const MODEL_MAX_BYTES = 12_000_000;
/** Above this a model slows the view and the video: the import says so. */
export const HEAVY_TRIANGLES = 400_000;

export class ModelImportError extends Error {}

export interface ReadModel {
    format: ModelFormat;
    object: THREE.Object3D;
    triangles: number;
}

/** What a model file is, from its first bytes and its name. */
export function formatOf(name: string, bytes: ArrayBuffer): ModelFormat | null {
    const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
    if (String.fromCharCode(...head) === 'glTF') return 'glb';
    if (/\.stl$/i.test(name)) return 'stl';
    return null;
}

/**
 * Why a GLB can't be imported as it is, or null. It must be glTF 2.0, carry all its data inside
 * (no `uri` but a data URL), and not need Draco, whose decoder Woodshop does not ship.
 */
export function glbProblem(bytes: ArrayBuffer): string | null {
    const view = new DataView(bytes);
    if (bytes.byteLength < 20 || view.getUint32(4, true) !== 2) {
        return 'This is not a glTF 2.0 GLB file.';
    }
    const chunkLength = view.getUint32(12, true);
    const chunkType = view.getUint32(16, true);
    if (chunkType !== 0x4e4f534a || 20 + chunkLength > bytes.byteLength) {
        return 'This GLB file is damaged: it has no glTF description.';
    }
    let json: {
        buffers?: { uri?: string }[];
        images?: { uri?: string }[];
        extensionsRequired?: string[];
    };
    try {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
    } catch {
        return 'This GLB file is damaged: its glTF description is not JSON.';
    }
    const outside = [...(json.buffers ?? []), ...(json.images ?? [])].some(
        (entry) => entry.uri !== undefined && !entry.uri.startsWith('data:'),
    );
    if (outside) {
        return 'This model points to other files (textures or data beside it). Export it again as one GLB with everything embedded.';
    }
    if ((json.extensionsRequired ?? []).includes('KHR_draco_mesh_compression')) {
        return 'This model is compressed with Draco, which Woodshop cannot read. Export it again without Draco compression.';
    }
    return null;
}

function countTriangles(object: THREE.Object3D): number {
    let triangles = 0;
    object.traverse((child) => {
        const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if ((child as THREE.Mesh).isMesh !== true || geometry === undefined) return;
        const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
        triangles += Math.floor(count / 3);
    });
    return triangles;
}

async function parseGlb(bytes: ArrayBuffer): Promise<THREE.Group> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(bytes, '');
    return gltf.scene;
}

/** Reads a GLB or STL file the person chose. Throws `ModelImportError` saying what is wrong. */
export async function readModelFile(
    name: string,
    bytes: ArrayBuffer,
    colour = '#9a9a9a',
): Promise<ReadModel> {
    const format = formatOf(name, bytes);
    if (format === null) {
        throw new ModelImportError('Woodshop imports GLB and STL files.');
    }
    if (format === 'glb') {
        const problem = glbProblem(bytes);
        if (problem !== null) throw new ModelImportError(problem);
        let object: THREE.Object3D;
        try {
            object = await parseGlb(bytes);
        } catch (e) {
            throw new ModelImportError(`This GLB file could not be read: ${(e as Error).message}`);
        }
        const triangles = countTriangles(object);
        if (triangles === 0) throw new ModelImportError('This GLB file has nothing to draw in it.');
        return { format, object, triangles };
    }
    let geometry: THREE.BufferGeometry;
    try {
        geometry = new STLLoader().parse(bytes);
    } catch (e) {
        throw new ModelImportError(`This STL file could not be read: ${(e as Error).message}`);
    }
    const count = geometry.getAttribute('position')?.count ?? 0;
    if (count < 3) throw new ModelImportError('This STL file has nothing to draw in it.');
    if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals();
    const coloured = geometry.getAttribute('color') !== undefined;
    const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
            color: coloured ? '#ffffff' : colour,
            vertexColors: coloured,
            roughness: 0.6,
        }),
    );
    mesh.name = name.replace(/\.stl$/i, '');
    const object = new THREE.Group();
    object.add(mesh);
    return { format, object, triangles: Math.floor(count / 3) };
}

/** How to stand a model up: quarter turns about X (to bring its up to +Y), then about Y. */
export interface Orientation {
    tilt: number;
    turn: number;
}

/** Most GLB files are already +Y up; STL files are usually +Z up. */
export function defaultOrientation(format: ModelFormat): Orientation {
    return { tilt: format === 'stl' ? 3 : 0, turn: 0 };
}

/**
 * The model scaled to inches and stood up: a new group, standing on y = 0 and centred on its
 * footprint. The source is cloned, not moved, so the import step can try another scale.
 */
export function normalised(
    source: THREE.Object3D,
    inchesPerUnit: number,
    orientation: Orientation,
): THREE.Group {
    const inner = source.clone(true);
    const turned = new THREE.Group();
    turned.add(inner);
    turned.scale.setScalar(inchesPerUnit);
    turned.quaternion.setFromEuler(
        new THREE.Euler((orientation.tilt * Math.PI) / 2, (orientation.turn * Math.PI) / 2, 0, 'YXZ'),
    );
    turned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(turned);
    const centre = box.getCenter(new THREE.Vector3());
    turned.position.set(-centre.x, -box.min.y, -centre.z);
    const root = new THREE.Group();
    root.add(turned);
    root.updateMatrixWorld(true);
    return root;
}

/** Length (X), width (Z) and height (Y) of a model as it stands, in inches. */
export function measured(object: THREE.Object3D): { l: number; w: number; h: number } {
    object.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return { l: round(size.x), w: round(size.z), h: round(size.y) };
}

/** The stood-up model as the GLB the library keeps. */
export async function toGlb(object: THREE.Object3D): Promise<Uint8Array> {
    const result = await new GLTFExporter().parseAsync(object, { binary: true });
    return new Uint8Array(result as ArrayBuffer);
}

/** A kept GLB back as a scene, ready to place: already in inches, standing on its bottom. */
export async function loadKeptModel(bytes: ArrayBuffer): Promise<THREE.Group> {
    const scene = await parseGlb(bytes);
    scene.traverse((child) => {
        child.castShadow = true;
        child.receiveShadow = true;
    });
    return scene;
}
