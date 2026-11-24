/**
 * Importing a 3D model to show with a piece (spec 1.22): choose a GLB or STL file, check its real
 * size (files get the scale wrong more often than not) and which way is up, say where it came
 * from, and import it. It is kept as one GLB in inches, standing on its bottom; see
 * `engine/importedModels.ts`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ImportedModel } from '@/spec';
import { len, parseLen, unitSuffix } from '@/lib/display';
import {
    HEAVY_TRIANGLES,
    MODEL_MAX_BYTES,
    ModelImportError,
    UNITS,
    defaultOrientation,
    measured,
    normalised,
    readModelFile,
    toGlb,
    type FileUnit,
    type Orientation,
    type ReadModel,
} from '@/engine/importedModels';
import { Field, PrimaryButton, SecondaryButton, Select, TextInput } from './form';

export interface ImportedResult {
    /** The model's entry for the spec, without its id (the caller picks one). */
    model: Omit<ImportedModel, 'id'>;
    /** The stood-up model, to draw without fetching it back. */
    object: THREE.Object3D;
}

export function ModelImport(props: {
    /** Keeps the GLB in the library; resolves to its hash. */
    keep(glb: Uint8Array): Promise<string>;
    onImported(result: ImportedResult): void;
    onCancel(): void;
}) {
    const [file, setFile] = useState<{ name: string; read: ReadModel } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [unit, setUnit] = useState<FileUnit>('m');
    const [orientation, setOrientation] = useState<Orientation>({ tilt: 0, turn: 0 });
    const [lengthInput, setLengthInput] = useState('');
    const [name, setName] = useState('');
    const [source, setSource] = useState('');
    const [license, setLicense] = useState('');
    const [colour, setColour] = useState('#9a9a9a');

    const choose = async (chosen: File) => {
        setError(null);
        setBusy(true);
        try {
            const read = await readModelFile(chosen.name, await chosen.arrayBuffer(), colour);
            setFile({ name: chosen.name, read });
            setUnit(read.format === 'glb' ? 'm' : 'mm');
            setOrientation(defaultOrientation(read.format));
            setLengthInput('');
            setName(chosen.name.replace(/\.(glb|stl)$/i, '').slice(0, 80));
        } catch (e) {
            setFile(null);
            setError(e instanceof ModelImportError ? e.message : `This file could not be read: ${String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    // STL has no colours of its own: the one chosen here is the model's.
    useEffect(() => {
        if (file?.read.format !== 'stl') return;
        file.read.object.traverse((child) => {
            const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (material?.vertexColors === false) material.color.set(colour);
        });
    }, [colour, file]);

    // As the file's units and orientation say, then scaled to a length typed in, if any.
    const stood = useMemo(() => {
        if (file === null) return null;
        const base = normalised(file.read.object, UNITS[unit].inches, orientation);
        const target = lengthInput.trim() === '' ? null : parseLen(lengthInput);
        const size = measured(base);
        if (target === null || target <= 0 || size.l <= 0) return { object: base, size };
        const object = normalised(file.read.object, (UNITS[unit].inches * target) / size.l, orientation);
        return { object, size: measured(object) };
    }, [file, unit, orientation, lengthInput]);

    const importIt = async () => {
        if (file === null || stood === null) return;
        setBusy(true);
        setError(null);
        try {
            const glb = await toGlb(stood.object);
            if (glb.byteLength > MODEL_MAX_BYTES) {
                throw new ModelImportError(
                    `This model comes to ${Math.ceil(glb.byteLength / 1_000_000)} MB; a model can be 12 MB at most. Import a simpler one (fewer triangles, smaller textures).`,
                );
            }
            const hash = await props.keep(glb);
            const tidy = (s: string) => s.trim();
            const model: Omit<ImportedModel, 'id'> = {
                name: tidy(name) === '' ? 'Imported model' : tidy(name).slice(0, 80),
                hash,
                size: stood.size,
                bytes: glb.byteLength,
            };
            if (tidy(source) !== '') model.source = tidy(source).slice(0, 300);
            if (tidy(license) !== '') model.license = tidy(license).slice(0, 120);
            props.onImported({ model, object: stood.object });
        } catch (e) {
            setError(
                e instanceof ModelImportError
                    ? e.message
                    : `It could not be kept: ${(e as { message?: string }).message ?? String(e)}`,
            );
        } finally {
            setBusy(false);
        }
    };

    const quarter = (key: keyof Orientation) =>
        setOrientation({ ...orientation, [key]: (orientation[key] + 1) % 4 });

    return (
        <div data-testid="model-import">
            <div className="mb-2.5 flex items-center gap-2">
                <label className="border-fg/12 hover:bg-surface-2 inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs">
                    {file === null ? 'Choose a GLB or STL file…' : 'Choose another file…'}
                    <input
                        type="file"
                        accept=".glb,.stl,model/gltf-binary,model/stl"
                        className="hidden"
                        data-testid="model-file"
                        onChange={(e) => {
                            const chosen = e.target.files?.[0];
                            e.target.value = '';
                            if (chosen !== undefined) void choose(chosen);
                        }}
                    />
                </label>
                {file !== null && (
                    <span className="text-muted truncate text-xs" data-testid="model-file-name">
                        {file.name} · {file.read.triangles.toLocaleString()} triangles
                    </span>
                )}
            </div>
            {error !== null && (
                <p className="text-danger-fg mb-2 text-xs" data-testid="model-error">
                    {error}
                </p>
            )}
            {file === null ? (
                <p className="text-muted text-xs">
                    A GLB (glTF) file from the maker or a model site, or an STL. It must hold everything in
                    one file. The 3D plan you send carries it, so use one you may share.
                </p>
            ) : (
                stood !== null && (
                    <>
                        <div className="mb-2.5 flex gap-3">
                            {/* Keyed by colour: an STL's colour is set on its material, so draw it again. */}
                            <ModelPreview
                                key={colour}
                                object={stood.object}
                                className="h-36 w-48 flex-none"
                            />
                            <div className="min-w-0 flex-1 text-xs">
                                <p
                                    className="text-fg-strong mb-1 text-[13px] font-semibold"
                                    data-testid="model-size"
                                >
                                    {len(stood.size.l)} long × {len(stood.size.w)} deep × {len(stood.size.h)}{' '}
                                    tall
                                </p>
                                <p className="text-muted mb-2">
                                    Check this against the real thing: a file often has the wrong scale.
                                </p>
                                {file.read.triangles > HEAVY_TRIANGLES && (
                                    <p className="text-warn-fg mb-2">
                                        It has a lot of triangles: the view and the video will be slow with
                                        it.
                                    </p>
                                )}
                                <div className="flex gap-2">
                                    <SecondaryButton
                                        className="px-2.5"
                                        data-testid="model-tilt"
                                        onClick={() => quarter('tilt')}
                                    >
                                        Stand it up
                                    </SecondaryButton>
                                    <SecondaryButton
                                        className="px-2.5"
                                        data-testid="model-turn"
                                        onClick={() => quarter('turn')}
                                    >
                                        Turn
                                    </SecondaryButton>
                                </div>
                            </div>
                        </div>
                        <div className="mb-2.5 grid grid-cols-2 gap-2">
                            <Field label="The file is in">
                                <Select
                                    value={unit}
                                    data-testid="model-unit"
                                    onChange={(e) => setUnit(e.target.value as FileUnit)}
                                >
                                    {(Object.keys(UNITS) as FileUnit[]).map((u) => (
                                        <option key={u} value={u}>
                                            {UNITS[u].label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={`Or make it this long (${unitSuffix()})`}>
                                <TextInput
                                    value={lengthInput}
                                    inputMode="decimal"
                                    placeholder="as the file says"
                                    data-testid="model-length"
                                    onChange={(e) => setLengthInput(e.target.value)}
                                />
                            </Field>
                        </div>
                        <div className="mb-2.5 grid grid-cols-2 gap-2">
                            <Field label="Name">
                                <TextInput
                                    value={name}
                                    data-testid="model-name"
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </Field>
                            {file.read.format === 'stl' && (
                                <Field label="Colour">
                                    <input
                                        type="color"
                                        value={colour}
                                        data-testid="model-colour"
                                        className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                                        onChange={(e) => setColour(e.target.value)}
                                    />
                                </Field>
                            )}
                            <Field label="Where it's from (optional)">
                                <TextInput
                                    value={source}
                                    placeholder="The maker's or model site's page"
                                    data-testid="model-source"
                                    onChange={(e) => setSource(e.target.value)}
                                />
                            </Field>
                            <Field label="Licence (optional)">
                                <TextInput
                                    value={license}
                                    placeholder="e.g. CC BY 4.0"
                                    data-testid="model-license"
                                    onChange={(e) => setLicense(e.target.value)}
                                />
                            </Field>
                        </div>
                    </>
                )
            )}
            <div className="mt-3 flex justify-end gap-2">
                <SecondaryButton className="h-9 px-4 text-sm" onClick={props.onCancel}>
                    Cancel
                </SecondaryButton>
                <PrimaryButton
                    className="h-9 px-4 text-sm"
                    disabled={file === null || busy}
                    data-testid="model-import-go"
                    onClick={() => void importIt()}
                >
                    {busy ? 'Working…' : 'Import'}
                </PrimaryButton>
            </div>
        </div>
    );
}

/** A still view of the model as it will stand, on a floor, from the front-right. */
function ModelPreview({ object, className = '' }: { object: THREE.Object3D; className?: string }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const el = canvas.current;
        if (el === null) return;
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
        } catch {
            return; // no WebGL (a test runner): the sizes still show
        }
        const width = el.clientWidth || 192;
        const height = el.clientHeight || 144;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height, false);
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.8));
        const key = new THREE.DirectionalLight(0xffffff, 2);
        key.position.set(3, 5, 4);
        scene.add(key);
        const shown = object.clone(true);
        scene.add(shown);
        const box = new THREE.Box3().setFromObject(shown);
        const centre = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(radius * 1.4, 40).rotateX(-Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.95 }),
        );
        scene.add(floor);
        const camera = new THREE.PerspectiveCamera(32, width / height, radius / 100, radius * 100);
        const distance = radius / Math.sin((camera.fov * Math.PI) / 360) + radius * 0.2;
        camera.position
            .copy(centre)
            .add(new THREE.Vector3(0.6, 0.45, 0.75).normalize().multiplyScalar(distance));
        camera.lookAt(centre);
        renderer.render(scene, camera);
        return () => {
            floor.geometry.dispose();
            (floor.material as THREE.Material).dispose();
            renderer.dispose();
        };
    }, [object]);
    return (
        <canvas
            ref={canvas}
            className={`bg-surface-0 border-fg/8 rounded-lg border ${className}`}
            data-testid="model-preview"
            aria-label="Preview of the model as it will stand"
        />
    );
}
