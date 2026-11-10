import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { catalog, findItem } from '@/hardware/catalog';
import { buildHardwareGeometry, knowsShape } from '@/engine/geometry/hardwareModels';
import { buildSpecGroup } from '@/engine/buildScene';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec';

function boundsOf(g: THREE.BufferGeometry): THREE.Box3 {
    g.computeBoundingBox();
    return g.boundingBox!;
}

describe('catalog hardware geometry', () => {
    it('draws every item: a real shape, sitting on its mounting surface', () => {
        for (const item of catalog().items) {
            expect(knowsShape(item.model.shape), `${item.id}: shape ${item.model.shape}`).toBe(true);
            const g = buildHardwareGeometry(item.model);
            const b = boundsOf(g);
            const size = b.getSize(new THREE.Vector3());
            expect(g.getAttribute('position').count, item.id).toBeGreaterThan(8);
            expect(Number.isFinite(size.x + size.y + size.z), item.id).toBe(true);
            // Nothing sinks into the wood (a cup pull's hood and a hinge knuckle start at 0).
            expect(b.min.z, `${item.id}: min z`).toBeGreaterThan(-0.02);
            expect(b.max.z, `${item.id}: stands proud`).toBeGreaterThan(0.05);
            // No catalog item is bigger than a piano hinge or smaller than a shelf pin.
            expect(Math.max(size.x, size.y, size.z), item.id).toBeLessThan(50);
            expect(Math.max(size.x, size.y, size.z), item.id).toBeGreaterThan(0.2);
            g.dispose();
        }
    });

    it('builds to the catalog dimensions', () => {
        const bar = boundsOf(buildHardwareGeometry(findItem('pull.bar-96mm')!.model));
        expect(bar.max.x - bar.min.x).toBeCloseTo(4.5, 1);
        expect(bar.max.z).toBeCloseTo(1.3, 1);

        const caster = boundsOf(buildHardwareGeometry(findItem('caster.locking-3in')!.model));
        expect(caster.max.z).toBeCloseTo(3.9, 1); // the height it adds under the piece

        const piano = boundsOf(buildHardwareGeometry(findItem('hinge.piano-24in')!.model, 30));
        expect(piano.max.x - piano.min.x).toBeCloseTo(30, 1); // cut to the lid, not the stock length
    });

    it('falls back to a placeholder for a shape this version does not know', () => {
        const g = buildHardwareGeometry({ shape: 'flux-capacitor' });
        expect(g.getAttribute('position').count).toBeGreaterThan(0);
    });
});

function specWith(extra: Partial<Spec>): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'T',
        materials: [
            { id: 'm_ply', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
        ],
        parts: [
            {
                id: 'p_door',
                name: 'Door',
                materialId: 'm_ply',
                size: { l: 12, w: 20 },
                transform: { pos: [0, 10, 0] },
            },
            {
                id: 'p_side',
                name: 'Side',
                materialId: 'm_ply',
                size: { l: 12, w: 20 },
                transform: { pos: [7, 10, -6], rot: [0, 90, 0] },
            },
        ],
        ...extra,
    });
}

const hardwareOn = (spec: Spec, partId: string) =>
    (buildSpecGroup(spec).getObjectByName(partId)?.children ?? []).filter(
        (c) => c.userData.hardware !== undefined,
    );

describe('hardware in the scene', () => {
    it('hangs a mounted piece on its part, on the named side, pointing out', () => {
        for (const [side, normal] of [
            ['front', [0, 0, 1]],
            ['back', [0, 0, -1]],
            ['l0', [0, -1, 0]],
            ['l1', [0, 1, 0]],
            ['w0', [-1, 0, 0]],
            ['w1', [1, 0, 0]],
        ] as const) {
            const spec = specWith({
                hardware: [
                    { id: 'hw_1', item: 'knob.round-1-1-4', partId: 'p_door', side, x: 0.3, y: 0.3, rot: 0 },
                ],
            });
            const [piece] = hardwareOn(spec, 'p_door');
            expect(piece.userData).toMatchObject({ hardware: 'mount', hardwareId: 'hw_1' });
            const out = new THREE.Vector3(0, 0, 1).applyQuaternion(piece.quaternion);
            expect(
                out.toArray().map((v) => Math.round(v)),
                side,
            ).toEqual([...normal]);
            // On the surface: the point lies on the part's boundary along the normal.
            const half = [6, 10, 0.375];
            const axis = normal.findIndex((v) => v !== 0);
            expect(Math.abs(piece.position.toArray()[axis]), side).toBeCloseTo(half[axis], 5);
        }
    });

    it('turns a mount a quarter turn about its normal', () => {
        const mount = {
            id: 'hw_1',
            item: 'pull.bar-96mm',
            partId: 'p_door',
            side: 'front',
            x: 6,
            y: 10,
        } as const;
        const along = (rot: 0 | 90) => {
            const [piece] = hardwareOn(specWith({ hardware: [{ ...mount, rot }] }), 'p_door');
            return new THREE.Vector3(1, 0, 0)
                .applyQuaternion(piece.quaternion)
                .toArray()
                .map((v) => Math.round(v));
        };
        expect(along(0)).toEqual([1, 0, 0]);
        expect(along(90)).toEqual([0, 1, 0]);
    });

    const door = {
        id: 'mv_door',
        kind: 'door',
        partIds: ['p_door'],
        panelPartId: 'p_door',
        hingeEdge: 'w1',
        style: 'overlay',
    } as const;

    it("draws a door's chosen hinge and pull, and nothing for pull: none", () => {
        const chosen = hardwareOn(
            specWith({ movables: [{ ...door, hinge: 'hinge.euro-full-overlay', pull: 'pull.bar-96mm' }] }),
            'p_door',
        );
        expect(chosen.map((h) => h.userData.itemId).sort()).toEqual([
            'hinge.euro-full-overlay',
            'hinge.euro-full-overlay',
            'pull.bar-96mm',
        ]);
        // Concealed hinges sit on the inside face; the pull stands on the show face, upright.
        for (const hinge of chosen.filter((h) => h.userData.hardware === 'hinge')) {
            expect(hinge.position.z).toBeCloseTo(-0.375, 5);
            expect(hinge.position.x).toBeLessThan(6);
        }
        const pull = chosen.find((h) => h.userData.hardware === 'knob')!;
        expect(pull.position.z).toBeCloseTo(0.375, 5);
        expect(new THREE.Vector3(1, 0, 0).applyQuaternion(pull.quaternion).y).toBeCloseTo(1, 5);

        const bare = hardwareOn(specWith({ movables: [{ ...door, pull: 'none' }] }), 'p_door');
        expect(bare.map((h) => h.userData.hardware)).toEqual(['hinge', 'hinge']);
    });

    it('fits one piano hinge to the whole edge', () => {
        const pieces = hardwareOn(specWith({ movables: [{ ...door, hinge: 'hinge.piano-24in' }] }), 'p_door');
        const hinges = pieces.filter((h) => h.userData.hardware === 'hinge') as THREE.Mesh[];
        expect(hinges).toHaveLength(1);
        hinges[0].geometry.computeBoundingBox();
        const b = hinges[0].geometry.boundingBox!;
        expect(b.max.x - b.min.x).toBeCloseTo(19, 1); // the 20" edge, less a half inch each end
    });
});
