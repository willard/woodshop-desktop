import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { MirrorCopy } from '@/engine/commands';
import {
    flipFor,
    flipOp,
    mirrorIdBase,
    mirrorMount,
    mirrorName,
    mirrorPart,
    mirrorPlane,
    type MirrorAxis,
} from '@/engine/mirror';
import { mountFrame } from '@/hardware/catalog';
import { parseSpec, type HardwareMount, type Op, type Part, type Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

const spec = () => parseSpec(recordStand) as Spec;
const part = (s: Spec, id: string) => s.parts.find((p) => p.id === id)!;
const T = 0.709; // the record stand's birch ply

/** Without its right side: the left side is mirrored to make it. */
function leftOnly(): Spec {
    const s = spec();
    return {
        ...s,
        parts: s.parts.filter((p) => p.id !== 'p_side_r'),
        joints: (s.joints ?? []).filter((j) => j.hostPartId !== 'p_side_r' && j.insertPartId !== 'p_side_r'),
    };
}

/** A local point of `p` in world coordinates. */
function world(p: Part, local: readonly number[]): THREE.Vector3 {
    const [rx, ry, rz] = p.transform.rot.map((d) => (d * Math.PI) / 180);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
    return new THREE.Vector3(local[0], local[1], local[2])
        .applyQuaternion(q)
        .add(new THREE.Vector3(...p.transform.pos));
}

function reflect(v: THREE.Vector3, axis: MirrorAxis, plane: number): THREE.Vector3 {
    const out = v.clone();
    out.setComponent(axis, 2 * plane - v.getComponent(axis));
    return out;
}

const hole = (p: Part, h: Extract<Op, { type: 'hole' }>) =>
    world(p, [-p.size.l / 2 + h.x, -p.size.w / 2 + h.y, h.face === 'front' ? T / 2 : -T / 2]);

const ROTATIONS: [number, number, number][] = [
    [0, 0, 0],
    [0, 90, 0],
    [90, 0, 0],
    [0, 0, 90],
    [30, -45, 10],
    [-90, 0, 27.3],
];

describe('mirror', () => {
    it("turns the record stand's left side into its right side, exactly as it was drawn", () => {
        const s = leftOnly();
        const left = part(s, 'p_side_l');
        const plane = mirrorPlane(s, [left], 0);
        expect(plane).toBe(0);
        const right = mirrorPart(left, 0, plane);
        const drawn = part(spec(), 'p_side_r');
        expect(right.transform.pos).toEqual(drawn.transform.pos);
        expect(right.transform.rot).toEqual(drawn.transform.rot);
        expect(right.ops).toEqual(drawn.ops);
    });

    it('puts every hole at the mirror image of the original, at any angle and along any axis', () => {
        const holes: Op[] = [
            { type: 'hole', face: 'front', x: 2, y: 5, diameter: 0.25, purpose: 'other' },
            { type: 'hole', face: 'back', x: 15, y: 1, diameter: 0.25, purpose: 'other' },
        ];
        for (const rot of ROTATIONS) {
            for (const axis of [0, 1, 2] as const) {
                const src: Part = {
                    ...part(spec(), 'p_side_l'),
                    ops: holes,
                    transform: { pos: [3, 4, 5], rot },
                };
                const copy = mirrorPart(src, axis, -2);
                holes.forEach((h, i) => {
                    const want = reflect(hole(src, h as never), axis, -2);
                    const got = hole(copy, copy.ops![i] as never);
                    expect(got.distanceTo(want), `rot ${rot} axis ${axis}`).toBeLessThan(1e-6);
                });
            }
        }
    });

    it('keeps cuts on their face and moves edges, runs and offsets with the reflection', () => {
        const size = { l: 20, w: 10 };
        const dado: Op = {
            type: 'dado',
            face: 'front',
            axis: 'w',
            offset: 4,
            width: 0.75,
            depth: 0.25,
            from: 1,
            to: 6,
        };
        expect(flipOp(dado, 'l', size)).toEqual({ ...dado, offset: 16 });
        expect(flipOp(dado, 'w', size)).toEqual({ ...dado, from: 4, to: 9 });
        const rabbet: Op = { type: 'rabbet', edge: 'w0', width: 0.75, depth: 0.375 };
        expect(flipOp(rabbet, 'l', size)).toEqual({ ...rabbet, edge: 'w1' });
        expect(flipOp(rabbet, 'w', size)).toEqual(rabbet);
        const notch: Op = { type: 'notch', edge: 'l0', from: 0, to: 3, depth: 1 };
        expect(flipOp(notch, 'l', size)).toEqual({ ...notch, from: 17, to: 20 });
        expect(flipOp(notch, 'w', size)).toEqual({ ...notch, edge: 'l1' });
        const ramp: Op = { type: 'curve', edge: 'l1', kind: 'ramp', height: 2, low: 'w1' };
        expect(flipOp(ramp, 'l', size)).toEqual({ ...ramp, low: 'w0' });
        const ease: Op = {
            type: 'ease',
            edge: 'l0',
            profile: 'chamfer',
            width: 0.125,
            face: 'front',
            from: 2,
        };
        expect(flipOp(ease, 'l', size)).toEqual({
            type: 'ease',
            edge: 'l0',
            profile: 'chamfer',
            width: 0.125,
            face: 'front',
            to: 18,
        });
    });

    it('moves hardware to the mirror-image spot and lines it up the mirror-image way', () => {
        const sides: HardwareMount['side'][] = ['front', 'back', 'l0', 'l1', 'w0', 'w1'];
        for (const rot of ROTATIONS) {
            for (const axis of [0, 1, 2] as const) {
                for (const side of sides) {
                    for (const turn of [0, 90] as const) {
                        const src: Part = { ...part(spec(), 'p_side_l'), transform: { pos: [1, 2, 3], rot } };
                        const mount: HardwareMount = {
                            id: 'h1',
                            item: 'pull-bar-128',
                            partId: src.id,
                            side,
                            x: 3,
                            y: 0.2,
                            rot: turn,
                        };
                        const copy = mirrorPart(src, axis, 7);
                        const moved = mirrorMount(mount, src, T, flipFor(src, axis));
                        const before = mountFrame(src, T, mount);
                        const after = mountFrame(copy, T, moved);
                        const want = reflect(world(src, before.point), axis, 7);
                        expect(
                            world(copy, after.point).distanceTo(want),
                            `${side} rot ${rot} axis ${axis}`,
                        ).toBeLessThan(1e-6);
                        // Same outward direction, mirrored.
                        const n0 = world(src, before.normal).sub(world(src, [0, 0, 0]));
                        const n1 = world(copy, after.normal).sub(world(copy, [0, 0, 0]));
                        n0.setComponent(axis, -n0.getComponent(axis));
                        expect(n1.distanceTo(n0)).toBeLessThan(1e-6);
                        // And its long axis runs the mirror-image way.
                        const long = (p: Part, m: HardwareMount) => {
                            const f = mountFrame(p, T, m);
                            const a = new THREE.Vector3(...f.along);
                            const t = ((m.rot ?? 0) * Math.PI) / 180;
                            const d = a
                                .clone()
                                .multiplyScalar(Math.cos(t))
                                .add(new THREE.Vector3(...f.normal).cross(a).multiplyScalar(Math.sin(t)));
                            return world(p, [d.x, d.y, d.z]).sub(world(p, [0, 0, 0]));
                        };
                        const d0 = long(src, mount);
                        d0.setComponent(axis, -d0.getComponent(axis));
                        expect(long(copy, moved).distanceTo(d0)).toBeLessThan(1e-6);
                    }
                }
            }
        }
    });

    it('names the copy for the other side', () => {
        expect(mirrorName('Left Side', 0)).toBe('Right Side');
        expect(mirrorName('front leg', 2)).toBe('back leg');
        expect(mirrorName('Top rail', 1)).toBe('Bottom rail');
        expect(mirrorName('Side', 0)).toBe('Side (mirrored)');
        expect(mirrorIdBase('p_side_l', 0)).toBe('p_side_r');
        expect(mirrorIdBase('p_left_door', 0)).toBe('p_right_door');
        expect(mirrorIdBase('p_leg', 2)).toBe('p_leg_mirror');
    });

    it('stands the mirror beside a part that is the whole design, not on top of it', () => {
        const s = spec();
        const lone = { ...s, parts: [part(s, 'p_top')], joints: [] };
        const top = part(s, 'p_top');
        expect(mirrorPlane(lone, [top], 0)).toBeCloseTo(36.582 / 2 + 1, 6);
    });

    it('copies the side with its joints, as one undo step', () => {
        const doc = new EditorDocument(leftOnly());
        const command = new MirrorCopy(['p_side_l'], 0);
        doc.execute(command);
        expect(command.resultIds).toEqual(['p_side_r']);
        const copy = part(doc.spec, 'p_side_r');
        expect(copy.name).toBe('Right Side');
        const joints = (doc.spec.joints ?? []).filter(
            (j) => j.hostPartId === 'p_side_r' || j.insertPartId === 'p_side_r',
        );
        // The shelf seats in its dado (the shelf is centred, so it is its own mirror image). The top,
        // bottom and back hold the left side with cuts of their own, which the right side has no
        // share in until they are added.
        expect(joints).toEqual([
            { type: 'dado', hostPartId: 'p_side_r', insertPartId: 'p_shelf_1', opRef: 0 },
        ]);
        doc.undo();
        expect(doc.spec.parts.some((p) => p.id === 'p_side_r')).toBe(false);
        expect(doc.spec.joints).toEqual(leftOnly().joints);
    });

    it('hangs a mirrored door from the other edge', () => {
        const s = leftOnly();
        s.movables = [
            {
                id: 'mv_door',
                kind: 'door',
                name: 'Left door',
                partIds: ['p_side_l'],
                panelPartId: 'p_side_l',
                hingeEdge: 'w0',
                style: 'overlay',
            },
        ];
        const doc = new EditorDocument(s);
        doc.execute(new MirrorCopy(['p_side_l'], 0));
        const door = (doc.spec.movables ?? []).find((m) => m.id !== 'mv_door')!;
        expect(door).toMatchObject({
            kind: 'door',
            name: 'Right door',
            partIds: ['p_side_r'],
            hingeEdge: 'w1',
        });
    });
});
