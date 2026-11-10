import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { openedPoses, doorHinge, hingeLineLocal } from '@/engine/open';
import { DEFAULT_OPEN_CONFIG } from '@/engine/config';
import { parseSpec } from '@/spec';
import type { Spec, Part } from '@/spec/types';

const THICKNESS = 0.75;

/**
 * A carcase with a door on its left edge and a two-part drawer, both facing +Z. The door panel
 * is 12 × 24 at x −6, hinged on w0 (its left edge).
 */
function cabinet(overrides: Partial<Record<string, unknown>> = {}): Spec {
    return parseSpec({
        specVersion: '1.14',
        units: 'in',
        name: 'Cabinet',
        materials: [
            { id: 'mat', type: 'sheet', name: 'Ply', thickness: THICKNESS, sheetSize: { l: 96, w: 48 } },
        ],
        parts: [
            {
                id: 'p_carcase',
                name: 'Carcase',
                materialId: 'mat',
                size: { l: 24, w: 24 },
                transform: { pos: [0, 12, -8] },
            },
            {
                id: 'p_door',
                name: 'Door',
                materialId: 'mat',
                size: { l: 12, w: 24 },
                transform: { pos: [-6, 12, 0.4] },
            },
            {
                id: 'p_front',
                name: 'Drawer Front',
                materialId: 'mat',
                size: { l: 12, w: 6 },
                transform: { pos: [6, 21, 0.4] },
            },
            {
                id: 'p_bottom',
                name: 'Drawer Bottom',
                materialId: 'mat',
                size: { l: 11, w: 10 },
                transform: { pos: [6, 18, -4.6], rot: [90, 0, 0] },
            },
        ],
        movables: [
            {
                id: 'mv_door',
                kind: 'door',
                partIds: ['p_door'],
                panelPartId: 'p_door',
                hingeEdge: 'w0',
                style: 'overlay',
            },
            {
                id: 'mv_drawer',
                kind: 'drawer',
                partIds: ['p_front', 'p_bottom'],
                frontPartId: 'p_front',
                style: 'overlay',
            },
        ],
        ...overrides,
    });
}

const partOf = (spec: Spec, id: string): Part => spec.parts.find((p) => p.id === id)!;

describe('hingeLineLocal — the front arris of the named edge (§3.3)', () => {
    const panel = partOf(cabinet(), 'p_door'); // 12 × 24

    it('puts the line on the +Z face, not the panel centreline', () => {
        // A door hinged on its centreline sweeps its own thickness through the carcase.
        for (const edge of ['l0', 'l1', 'w0', 'w1'] as const) {
            expect(hingeLineLocal(panel, THICKNESS, edge).point[2]).toBeCloseTo(THICKNESS / 2, 9);
        }
    });

    it('places each edge where §3.1 says it is, running the right way', () => {
        expect(hingeLineLocal(panel, THICKNESS, 'w0').point.slice(0, 2)).toEqual([-6, 0]);
        expect(hingeLineLocal(panel, THICKNESS, 'w1').point.slice(0, 2)).toEqual([6, 0]);
        expect(hingeLineLocal(panel, THICKNESS, 'l0').point.slice(0, 2)).toEqual([0, -12]);
        expect(hingeLineLocal(panel, THICKNESS, 'l1').point.slice(0, 2)).toEqual([0, 12]);
        // l-edges run along the length, w-edges along the width.
        expect(hingeLineLocal(panel, THICKNESS, 'l0').direction).toEqual([1, 0, 0]);
        expect(hingeLineLocal(panel, THICKNESS, 'w0').direction).toEqual([0, 1, 0]);
    });
});

describe('doorHinge — world pivot, axis, and swing sense', () => {
    it('carries the hinge line into world space through the panel transform', () => {
        const spec = cabinet();
        const { pivot, axis } = doorHinge(partOf(spec, 'p_door'), THICKNESS, 'w0');
        // Panel centre x −6, half-length 6 → left edge at −12; front arris at z 0.4 + 0.375.
        expect(pivot.x).toBeCloseTo(-12, 6);
        expect(pivot.z).toBeCloseTo(0.775, 6);
        expect(Math.abs(axis.y)).toBeCloseTo(1, 6);
    });

    it('opens toward the show face from either hand', () => {
        const spec = cabinet();
        const panel = partOf(spec, 'p_door');
        const normal = new THREE.Vector3(0, 0, 1); // this panel faces +Z

        for (const edge of ['w0', 'w1'] as const) {
            const { pivot, axis, sign } = doorHinge(panel, THICKNESS, edge);
            const free = new THREE.Vector3(edge === 'w0' ? 0 : -12, 12, 0.4); // opposite edge, world
            const velocity = new THREE.Vector3().crossVectors(
                axis.clone().multiplyScalar(sign),
                free.sub(pivot),
            );
            expect(velocity.dot(normal)).toBeGreaterThan(0);
        }
    });
});

describe('openedPoses', () => {
    it('is the identity at factor 0 — closing is exact, not approximate', () => {
        const spec = cabinet();
        for (const [id, pose] of openedPoses(spec, 0)) {
            const part = partOf(spec, id);
            expect(pose.pos[0]).toBeCloseTo(part.transform.pos[0], 9);
            expect(pose.pos[1]).toBeCloseTo(part.transform.pos[1], 9);
            expect(pose.pos[2]).toBeCloseTo(part.transform.pos[2], 9);
        }
    });

    it('leaves parts that belong to no movable out of the map', () => {
        expect(openedPoses(cabinet(), 1).has('p_carcase')).toBe(false);
    });

    it('swings the door about the hinge line — the hinged edge barely moves', () => {
        const spec = cabinet();
        const open = openedPoses(spec, 1).get('p_door')!;
        const closed = partOf(spec, 'p_door');

        // The panel centre swings well clear of where it started…
        const centreTravel = Math.hypot(
            open.pos[0] - closed.transform.pos[0],
            open.pos[2] - closed.transform.pos[2],
        );
        expect(centreTravel).toBeGreaterThan(5);

        // …while the point on the hinge line stays put (that is what makes it a hinge).
        const quat = new THREE.Quaternion(...open.quat);
        const hingeCorner = new THREE.Vector3(-6, 0, THICKNESS / 2)
            .applyQuaternion(quat)
            .add(new THREE.Vector3(...open.pos));
        expect(hingeCorner.x).toBeCloseTo(-12, 6);
        expect(hingeCorner.z).toBeCloseTo(0.775, 6);
    });

    it('turns the door by the configured angle', () => {
        const spec = cabinet();
        const open = openedPoses(spec, 1).get('p_door')!;
        const quat = new THREE.Quaternion(...open.quat);
        const swung = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
        const angle = swung.angleTo(new THREE.Vector3(0, 0, 1)) * (180 / Math.PI);
        expect(angle).toBeCloseTo(DEFAULT_OPEN_CONFIG.doorSwingDeg, 4);
    });

    it('opens half way at half the factor', () => {
        const spec = cabinet();
        const half = openedPoses(spec, 0.5).get('p_door')!;
        const quat = new THREE.Quaternion(...half.quat);
        const angle =
            new THREE.Vector3(0, 0, 1).applyQuaternion(quat).angleTo(new THREE.Vector3(0, 0, 1)) *
            (180 / Math.PI);
        expect(angle).toBeCloseTo(DEFAULT_OPEN_CONFIG.doorSwingDeg / 2, 4);
    });

    it('slides the whole drawer along the front normal, rotation untouched', () => {
        const spec = cabinet();
        const poses = openedPoses(spec, 1);
        const front = poses.get('p_front')!;
        const bottom = poses.get('p_bottom')!;

        // Box spans z −9.6..0.775 → 10.375" deep, travelling 0.8 of that.
        const travel = DEFAULT_OPEN_CONFIG.drawerTravelFraction * 10.375;
        expect(front.pos[2] - 0.4).toBeCloseTo(travel, 4);
        // Every member moves together, and only along z.
        expect(bottom.pos[2] - -4.6).toBeCloseTo(travel, 4);
        expect(front.pos[0]).toBeCloseTo(6, 9);
        expect(front.pos[1]).toBeCloseTo(21, 9);

        // A drawer does not rotate: the front keeps its authored orientation.
        expect(front.quat).toEqual([0, 0, 0, 1]);
    });

    it('follows the front when the drawer faces another way', () => {
        const spec = cabinet();
        const turned = parseSpec({
            ...spec,
            parts: spec.parts.map((p) =>
                p.id === 'p_front' ? { ...p, transform: { ...p.transform, rot: [0, 90, 0] } } : p,
            ),
        } as unknown as Spec);
        const front = openedPoses(turned, 1).get('p_front')!;
        // Local +Z now points along world +X, so the drawer pulls out sideways.
        expect(front.pos[0]).toBeGreaterThan(6);
        expect(front.pos[2]).toBeCloseTo(0.4, 6);
    });

    it('leaves a movable closed when its anchor is missing instead of throwing', () => {
        const spec = cabinet();
        const broken = { ...spec, parts: spec.parts.filter((p) => p.id !== 'p_door') } as Spec;
        const poses = openedPoses(broken, 1);
        expect(poses.has('p_door')).toBe(false);
        expect(poses.has('p_front')).toBe(true);
    });

    it('clamps a factor past the ends instead of over-swinging', () => {
        const spec = cabinet();
        const past = openedPoses(spec, 4).get('p_door')!;
        const full = openedPoses(spec, 1).get('p_door')!;
        expect(past.pos).toEqual(full.pos);
        expect(openedPoses(spec, -1).get('p_door')!.pos[0]).toBeCloseTo(-6, 9);
    });
});
