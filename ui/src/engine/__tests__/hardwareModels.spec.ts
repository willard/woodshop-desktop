import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { catalog, findItem } from '@/hardware/catalog';
import { buildHardwareGeometry, knowsShape } from '@/engine/geometry/hardwareModels';
import { knowsPropShape } from '@/engine/geometry/propModels';
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
            if (item.prop === true) {
                // Shown, not mounted: drawn by the props' own models.
                expect(knowsPropShape(item.model.shape), `${item.id}: prop shape`).toBe(true);
                continue;
            }
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

    it('draws a folding bracket locked out: the leg on the post, the arm standing out from its top', () => {
        const b = boundsOf(buildHardwareGeometry(findItem('bracket.folding-16in')!.model));
        expect(b.max.x - b.min.x).toBeCloseTo(12, 1); // the leg
        expect(b.max.z).toBeCloseTo(16, 1); // the arm's reach
        expect(b.max.y - b.min.y).toBeCloseTo(1.5, 2);
    });

    it('draws a toggle latch closed: its full length, the keeper in the last quarter', () => {
        const b = boundsOf(buildHardwareGeometry(findItem('latch.toggle-3in')!.model));
        expect(b.min.x).toBeCloseTo(-1.5, 2);
        expect(b.max.x).toBeCloseTo(1.5, 2);
        expect(b.max.z).toBeCloseTo(0.54, 2); // the folded lever, inside the projection
        expect(b.max.y - b.min.y).toBeCloseTo(1.25, 2);
    });

    it('draws a T-hinge as a leaf, a knuckle and a strap tapering across the door', () => {
        const model = findItem('hinge.tee-6in')!.model;
        const b = boundsOf(buildHardwareGeometry(model));
        expect(b.max.x).toBeCloseTo(6, 2); // the strap's tip
        expect(b.min.x).toBeLessThan(-0.8); // the leaf on the frame
        expect(b.max.y - b.min.y).toBeCloseTo(3.25, 1);
        // The strap is about an inch wide at the knuckle and half that out along the door.
        const position = buildHardwareGeometry(model).getAttribute('position');
        let outAlong = 0;
        for (let v = 0; v < position.count; v += 1) {
            if (position.getX(v) > 1) outAlong = Math.max(outAlong, Math.abs(position.getY(v)));
        }
        expect(outAlong).toBeLessThan(0.3);
        expect(outAlong).toBeGreaterThan(0.2);
    });

    it('shows a shelf pin as a collar and a spoon flat on top', () => {
        const b = boundsOf(buildHardwareGeometry(findItem('shelf.pin-1-4in')!.model));
        expect(b.max.z).toBeCloseTo(0.36, 2); // reaches out about as far as it goes in
        expect(b.max.y).toBeCloseTo(0.2, 2); // the collar's rim is the top; the spoon is just under
        expect(b.min.z).toBeGreaterThanOrEqual(-1e-6);
    });

    it('keeps a concealed hinge inside the cabinet, whatever its overlay', () => {
        // +X runs from the cup toward the hinge edge, +Z back into the cabinet; the side's inside
        // face is at x = boring − overlay. The cup's flange lies on the door's back face, but the
        // arm and plate behind it must stay inside that face, or the plate shows through the side.
        for (const id of ['hinge.euro-inset', 'hinge.euro-half-overlay', 'hinge.euro-full-overlay']) {
            const model = findItem(id)!.model;
            const wall = (model.boring as number) - (model.overlay as number);
            const position = buildHardwareGeometry(model).getAttribute('position');
            let reach = -Infinity;
            for (let v = 0; v < position.count; v += 1) {
                if (position.getZ(v) > 0.15) reach = Math.max(reach, position.getX(v));
            }
            expect(reach, id).toBeLessThanOrEqual(wall + 1e-5); // float32 vertices
            expect(reach, `${id}: plate on the side`).toBeGreaterThan(wall - 0.01);
        }
    });

    it('falls back to a placeholder for a shape this version does not know', () => {
        const g = buildHardwareGeometry({ shape: 'flux-capacitor' });
        expect(g.getAttribute('position').count).toBeGreaterThan(0);
    });
});

function specWith(extra: Partial<Spec>): Spec {
    return parseSpec({
        specVersion: '1.22',
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
