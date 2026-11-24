import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
    UNITS,
    defaultOrientation,
    formatOf,
    glbProblem,
    loadKeptModel,
    measured,
    normalised,
    readModelFile,
    toGlb,
} from '@/engine/importedModels';
import { buildPropsGroup } from '@/engine/buildScene';
import { AddProp, RemoveProp } from '@/engine';
import { parseSpec } from '@/spec';
import type { ImportedModel, Spec } from '@/spec';

/** An ASCII STL of one right triangle, `a` × `b` in X and Y, lying in Z = 0..`c`. */
function stl(a: number, b: number, c: number): ArrayBuffer {
    const text = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex ${a} 0 0
vertex 0 ${b} ${c}
endloop
endfacet
endsolid t
`;
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** A GLB whose JSON chunk is `json`, and nothing else. */
function glbWith(json: object): ArrayBuffer {
    let text = JSON.stringify(json);
    while (text.length % 4 !== 0) text += ' ';
    const body = new TextEncoder().encode(text);
    const out = new DataView(new ArrayBuffer(20 + body.length));
    out.setUint32(0, 0x46546c67, true); // glTF
    out.setUint32(4, 2, true);
    out.setUint32(8, 20 + body.length, true);
    out.setUint32(12, body.length, true);
    out.setUint32(16, 0x4e4f534a, true); // JSON
    new Uint8Array(out.buffer, 20).set(body);
    return out.buffer;
}

describe('importing a model', () => {
    it('knows a GLB by its bytes and an STL by its name', () => {
        expect(formatOf('box.bin', glbWith({ asset: { version: '2.0' } }))).toBe('glb');
        expect(formatOf('Box.STL', stl(1, 1, 1))).toBe('stl');
        expect(formatOf('box.obj', stl(1, 1, 1))).toBeNull();
    });

    it('refuses a GLB that reaches outside itself or needs Draco', () => {
        expect(glbProblem(glbWith({ asset: { version: '2.0' } }))).toBeNull();
        expect(glbProblem(glbWith({ asset: { version: '2.0' }, images: [{ uri: 'wood.png' }] }))).toMatch(
            /points to other files/,
        );
        expect(glbProblem(glbWith({ asset: { version: '2.0' }, buffers: [{ uri: 'data:,' }] }))).toBeNull();
        expect(
            glbProblem(
                glbWith({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }),
            ),
        ).toMatch(/Draco/);
    });

    it('reads an STL in millimetres, Z up, and stands it in inches on the floor', async () => {
        const read = await readModelFile('wedge.stl', stl(254, 127, 50.8), '#336699');
        expect(read.format).toBe('stl');
        expect(read.triangles).toBe(1);
        const stood = normalised(read.object, UNITS.mm.inches, defaultOrientation('stl'));
        const size = measured(stood);
        expect(size.l).toBeCloseTo(10, 3); // 254 mm along X
        expect(size.h).toBeCloseTo(2, 3); // its Z (50.8 mm) is now up
        expect(size.w).toBeCloseTo(5, 3); // its Y (127 mm) is now depth
        const box = new THREE.Box3().setFromObject(stood);
        expect(box.min.y).toBeCloseTo(0, 6);
        expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
        // Turning it a quarter swaps length and depth.
        const turned = measured(normalised(read.object, UNITS.mm.inches, { tilt: 3, turn: 1 }));
        expect(turned.l).toBeCloseTo(5, 3);
        expect(turned.w).toBeCloseTo(10, 3);
    });

    it('keeps the stood-up model as a GLB that loads back the same size', async () => {
        const read = await readModelFile('wedge.stl', stl(254, 127, 50.8));
        const stood = normalised(read.object, UNITS.mm.inches, defaultOrientation('stl'));
        const glb = await toGlb(stood);
        expect(String.fromCharCode(...glb.subarray(0, 4))).toBe('glTF');
        const back = await loadKeptModel(glb.slice().buffer);
        const size = measured(back);
        expect(size.l).toBeCloseTo(10, 2);
        expect(size.h).toBeCloseTo(2, 2);
        expect(new THREE.Box3().setFromObject(back).min.y).toBeCloseTo(0, 4);
    });
});

describe('a prop that shows an imported model', () => {
    const model: ImportedModel = {
        id: 'm_wedge',
        name: 'Wedge',
        hash: 'ab'.repeat(32),
        size: { l: 10, w: 5, h: 2 },
        bytes: 1234,
    };
    const base = (): Spec =>
        parseSpec({
            specVersion: '1.22',
            units: 'in',
            name: 'Shelf',
            materials: [
                { id: 'ply', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
            ],
            parts: [
                {
                    id: 'p_shelf',
                    name: 'Shelf',
                    materialId: 'ply',
                    size: { l: 30, w: 12 },
                    transform: { pos: [0, 0, 0] },
                },
            ],
        });

    it('is a box of its size until its file loads, then the model itself', () => {
        const spec: Spec = {
            ...base(),
            models: [model],
            props: [{ id: 'pr_wedge', model: 'm_wedge', pos: [3, 1, 2], rot: 0 }],
        };
        const waiting = buildPropsGroup(spec).getObjectByName('pr_wedge')!;
        expect(waiting.userData.placeholder).toBe(true);
        const box = new THREE.Box3().setFromObject(waiting);
        expect(box.max.x - box.min.x).toBeCloseTo(10, 5);
        expect(box.min.y).toBeCloseTo(1, 5);

        const loaded = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        const drawn = buildPropsGroup(spec, new Map([[model.hash, loaded]])).getObjectByName('pr_wedge')!;
        expect(drawn.userData.placeholder).toBeUndefined();
        expect(drawn.children[0]).not.toBe(loaded); // a copy, so the loaded one is shared
    });

    it('adds the model with its first prop, and drops it with its last', () => {
        let spec = base();
        const first = new AddProp({ id: 'pr_a', model: 'm_wedge', pos: [0, 0, 0], rot: 0 }, model);
        spec = first.do(spec);
        const second = new AddProp({ id: 'pr_b', model: 'm_wedge', pos: [12, 0, 0], rot: 0 }, model);
        spec = second.do(spec);
        expect(spec.models.map((m) => m.id)).toEqual(['m_wedge']); // listed once
        spec = new RemoveProp('pr_a').do(spec);
        expect(spec.models).toHaveLength(1); // pr_b still shows it
        const last = new RemoveProp('pr_b');
        spec = last.do(spec);
        expect(spec.models).toEqual([]);
        spec = last.undo(spec);
        expect(spec.models.map((m) => m.id)).toEqual(['m_wedge']);
        expect(spec.props.map((p) => p.id)).toEqual(['pr_b']);
        expect(second.undo(spec).models).toEqual([model]); // it didn't add the model, so keeps it
        expect(first.undo(base()).models).toEqual([]);
    });
});
