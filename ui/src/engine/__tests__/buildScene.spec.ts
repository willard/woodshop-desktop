import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildSpecGroup, buildPartMesh } from '@/engine/buildScene';
import { parseSpec } from '@/spec';
import type { Part, Material, Spec } from '@/spec/types';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';
import { goldenExpectations } from '@fixtures/specs/expected';
import { pocketScrewLength, woodScrewLength } from '@/spec/fasteners';

/** Every shipped template, keyed by file name — the corpus the parity tests use too. */
const templates: Record<string, unknown> = Object.fromEntries(
    Object.entries(import.meta.glob('../../../../resources/templates/*.json', { eager: true })).map(
        ([path, mod]) => [path.split('/').pop()!.replace('.json', ''), (mod as { default: unknown }).default],
    ),
);

describe('buildSpecGroup', () => {
    it('renders one mesh per part for each golden fixture', () => {
        const stand = buildSpecGroup(parseSpec(recordStand));
        expect(stand.children).toHaveLength(goldenExpectations['record-stand'].partCount);
        expect(stand.children.every((c) => c instanceof THREE.Mesh)).toBe(true);

        const shelf = buildSpecGroup(parseSpec(bookshelf));
        expect(shelf.children).toHaveLength(goldenExpectations.bookshelf.partCount);
    });

    it('names meshes by part id and tags userData', () => {
        const group = buildSpecGroup(parseSpec(recordStand));
        const back = group.getObjectByName('p_back');
        expect(back).toBeInstanceOf(THREE.Mesh);
        expect(back?.userData.materialId).toBe('mat_bb18');
    });

    it('throws when a part references an undeclared material', () => {
        const spec = parseSpec(recordStand);
        const broken = { ...spec, parts: [{ ...spec.parts[0], materialId: 'mat_missing' }] };
        expect(() => buildSpecGroup(broken)).toThrow(/unknown material/);
    });
});

describe('buildPartMesh geometry (§3.1 local frame)', () => {
    const material: Material = {
        id: 'mat_t',
        type: 'sheet',
        name: 'Test',
        thickness: 0.75,
        sheetSize: { l: 48, w: 48 },
        grain: true,
    };

    it('maps size l→X, w→Y and material thickness→Z', () => {
        const part = parseSpec(recordStand).parts.find((p) => p.id === 'p_top') as Part;
        const mesh = buildPartMesh(part, material, () => new THREE.MeshBasicMaterial({ color: 0 }));
        const geo = mesh.geometry as THREE.BoxGeometry;
        expect(geo.parameters.width).toBeCloseTo(part.size.l);
        expect(geo.parameters.height).toBeCloseTo(part.size.w);
        expect(geo.parameters.depth).toBeCloseTo(material.thickness);
    });

    it('applies transform.pos and rot (degrees→radians, XYZ)', () => {
        const part = parseSpec(recordStand).parts.find((p) => p.id === 'p_side_l') as Part;
        const mesh = buildPartMesh(part, material, () => new THREE.MeshBasicMaterial({ color: 0 }));
        expect(mesh.position.x).toBeCloseTo(-18.6455);
        expect(mesh.position.y).toBeCloseTo(17);
        expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
        expect(mesh.rotation.order).toBe('XYZ');
    });
});

describe('fastener meshes (spec 1.8)', () => {
    const material: Material = {
        id: 'mat_t',
        type: 'sheet',
        name: 'Test',
        thickness: 0.75,
        sheetSize: { l: 48, w: 48 },
        grain: true,
    };
    const basePart: Part = {
        id: 'p_x',
        name: 'X',
        materialId: 'mat_t',
        size: { l: 24, w: 12 },
        grainAxis: 'l',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        qty: 1,
        locked: false,
        ops: [],
    };
    const build = (ops: Part['ops']): THREE.Mesh =>
        buildPartMesh({ ...basePart, ops }, material, () => new THREE.MeshBasicMaterial({ color: 0 }));

    /** The screws themselves; a pocket screw also contributes the dark mouth of its hole. */
    const screwsOf = (mesh: THREE.Mesh): THREE.Mesh[] =>
        mesh.children.filter(
            (child) => child.userData.fastener === 'screw' || child.userData.fastener === 'pocketScrew',
        ) as THREE.Mesh[];
    const mouthsOf = (mesh: THREE.Mesh): THREE.Mesh[] =>
        mesh.children.filter((child) => child.userData.fastener === 'pocketMouth') as THREE.Mesh[];

    /**
     * Where the metal actually travels, in the part's local frame: the head is the mesh origin and
     * the screw runs down its local −Y, so this is the only assertion that catches an inverted
     * orientation — a rotation *number* looks plausible while pointing out of the wood.
     */
    const driveOf = (screw: THREE.Mesh): THREE.Vector3 =>
        new THREE.Vector3(0, -1, 0).applyQuaternion(screw.quaternion);

    const tipOf = (screw: THREE.Mesh, length: number): THREE.Vector3 =>
        screw.position.clone().addScaledVector(driveOf(screw), length);

    it('drives pocket screws out of the named edge and up to mid-thickness', () => {
        const mesh = build([{ type: 'pocketHoles', edge: 'w1', count: 3, length: 1.25 }]);
        expect(screwsOf(mesh)).toHaveLength(3);

        const screw = screwsOf(mesh)[0];
        const drive = driveOf(screw);
        // Out through w1 (+X) at 15° off the face, climbing toward mid-thickness (+Z).
        expect(drive.x).toBeCloseTo(Math.cos((15 * Math.PI) / 180), 6);
        expect(drive.z).toBeCloseTo(Math.sin((15 * Math.PI) / 180), 6);
        expect(drive.y).toBeCloseTo(0, 6);

        // Head buried in the board behind the edge; tip out past it, into the mate.
        expect(screw.position.x).toBeGreaterThan(11);
        expect(screw.position.x).toBeLessThan(12);
        expect(screw.position.z).toBeLessThan(0);
        expect(tipOf(screw, 1.25).x).toBeGreaterThan(12);
    });

    it('marks every pocket screw with the oval mouth of its hole on the back face', () => {
        const mesh = build([{ type: 'pocketHoles', edge: 'w1', count: 3, length: 1.25 }]);
        const mouths = mouthsOf(mesh);
        expect(mouths).toHaveLength(3);

        const mouth = mouths[0];
        // Lying on the back face (−Z), lifted clear of it, and stretched along the bore's run.
        expect(mouth.position.z).toBeCloseTo(-0.381, 3);
        expect(mouth.scale.x).toBeCloseTo(1 / Math.sin((15 * Math.PI) / 180), 6);
        expect(mouth.scale.y).toBeCloseTo(1);
        // It sits behind its screw's head, further from the edge the screw exits.
        expect(mouth.position.x).toBeLessThan(screwsOf(mesh)[0].position.x);
    });

    it('drills the pockets from the face the op names, and tilts the screw away from it', () => {
        const back = build([{ type: 'pocketHoles', edge: 'w1', count: 1, length: 1.25 }]);
        const front = build([{ type: 'pocketHoles', face: 'front', edge: 'w1', count: 1, length: 1.25 }]);

        // Default `back`: head down near the back face, climbing toward mid-thickness.
        expect(screwsOf(back)[0].position.z).toBeLessThan(0);
        expect(driveOf(screwsOf(back)[0]).z).toBeGreaterThan(0);
        expect(mouthsOf(back)[0].position.z).toBeCloseTo(-0.381, 3);

        // `front` is the mirror image: same edge, same exit, holes on the other side.
        expect(screwsOf(front)[0].position.z).toBeGreaterThan(0);
        expect(driveOf(screwsOf(front)[0]).z).toBeLessThan(0);
        expect(mouthsOf(front)[0].position.z).toBeCloseTo(0.381, 3);
        expect(screwsOf(front)[0].position.x).toBeCloseTo(screwsOf(back)[0].position.x, 6);
    });

    it('drives pocket screws out of every edge, never back into the board', () => {
        const outward: Record<string, [number, number]> = {
            l0: [0, -1],
            l1: [0, 1],
            w0: [-1, 0],
            w1: [1, 0],
        };
        for (const [edge, [ox, oy]] of Object.entries(outward)) {
            const mesh = build([
                { type: 'pocketHoles', edge: edge as 'l0' | 'l1' | 'w0' | 'w1', count: 1, length: 1.25 },
            ]);
            const screw = screwsOf(mesh)[0];
            const drive = driveOf(screw);
            expect(drive.x * ox + drive.y * oy).toBeGreaterThan(0.9); // out, not in
            expect(drive.z).toBeGreaterThan(0); // climbing out of the pocket, not deeper
        }
    });

    it('stands wood screws on the named face and drives them through to the other side', () => {
        const mesh = build([
            { type: 'screws', face: 'front', axis: 'l', offset: 6, count: 2, from: 4, to: 20 },
        ]);
        expect(screwsOf(mesh)).toHaveLength(2);

        const [first, second] = screwsOf(mesh);
        // Heads on the front face (+Z) — a hair proud of it so they don't z-fight the wood —
        // on the offset line (y = −w/2 + 6 = 0), at from/to.
        expect(first.position.z).toBeCloseTo(0.381, 3); // 0.375 face + 0.006 lift
        expect(first.position.y).toBeCloseTo(0);
        expect(first.position.x).toBeCloseTo(-8); // −l/2 + 4
        expect(second.position.x).toBeCloseTo(8); // −l/2 + 20
        // Heads on `front` means the metal travels toward `back` — out the far side into the mate.
        expect(driveOf(first).z).toBeCloseTo(-1, 6);
        expect(tipOf(first, 1.25).z).toBeLessThan(-0.375);
    });

    it('flips the drive when the heads sit on the back face', () => {
        const mesh = build([{ type: 'screws', face: 'back', axis: 'w', offset: 3, count: 1 }]);
        const screw = screwsOf(mesh)[0];
        expect(screw.position.z).toBeCloseTo(-0.381, 3); // 0.375 face + 0.006 lift, outward
        expect(driveOf(screw).z).toBeCloseTo(1, 6);
    });

    it('draws nothing extra for a part with no fasteners', () => {
        expect(build([{ type: 'miter', edge: 'l0', angle: 45 }]).children).toHaveLength(0);
    });
});

/**
 * The end-to-end version of the same question, on real designs: every screw the renderer draws
 * must point at the part the spec says it fastens. A sign error anywhere in the chain (op → local
 * frame → part transform) shows up here as a screw driving into open air.
 */
describe('fasteners point at their mate (golden fixtures + shipped templates)', () => {
    const specs: Record<string, unknown> = { 'record-stand': recordStand, bookshelf, ...templates };
    const TOUCH = 0.02;

    /** The modelled length of the fastener at `index` on `part` (the renderer's own defaults). */
    const lengthOf = (part: Part, spec: ReturnType<typeof parseSpec>, index: number): number => {
        const op = (part.ops ?? [])[index];
        const thickness = spec.materials.find((m) => m.id === part.materialId)?.thickness ?? 0;
        if (op.type === 'pocketHoles') {
            return op.length ?? pocketScrewLength(thickness);
        }
        if (op.type === 'screws') {
            return op.length ?? woodScrewLength(thickness, thickness);
        }
        return 0;
    };

    for (const [name, raw] of Object.entries(specs)) {
        it(name, () => {
            const spec = parseSpec(raw);
            const group = buildSpecGroup(spec);
            let checked = 0;

            for (const part of spec.parts) {
                const mesh = group.getObjectByName(part.id) as THREE.Mesh;
                const fastenerIndexes = (part.ops ?? [])
                    .map((op, index) => ({ op, index }))
                    .filter(({ op }) => op.type === 'pocketHoles' || op.type === 'screws');

                // Each op contributes `count` screws, in op order — walk the running offset.
                const screws = mesh.children.filter(
                    (c) => c.userData.fastener === 'screw' || c.userData.fastener === 'pocketScrew',
                ) as THREE.Mesh[];
                let child = 0;
                fastenerIndexes.forEach(({ op, index }) => {
                    const first = child;
                    child += op.type === 'pocketHoles' || op.type === 'screws' ? op.count : 0;
                    const joint = (spec.joints ?? []).find(
                        (j) => j.hostPartId === part.id && j.opRef === index,
                    );
                    if (joint === undefined) {
                        return; // an unrecorded fastener has no mate to aim at
                    }
                    const mate = group.getObjectByName(joint.insertPartId) as THREE.Mesh;
                    // The mate's *body*, not its centre: a leg screwed up into a wide tabletop
                    // drives nowhere near that top's centre, but it does end up inside its box.
                    const mateBox = new THREE.Box3().setFromObject(mate).expandByScalar(TOUCH);

                    // One screw per op is enough: they share an orientation.
                    const screw = screws[first];
                    const head = screw.getWorldPosition(new THREE.Vector3());
                    const drive = new THREE.Vector3(0, -1, 0)
                        .applyQuaternion(screw.getWorldQuaternion(new THREE.Quaternion()))
                        .normalize();
                    const tip = head.clone().addScaledVector(drive, lengthOf(part, spec, index));

                    expect(
                        mateBox.distanceToPoint(tip),
                        `${part.id} op#${index} → ${joint.insertPartId}: tip misses the mate`,
                    ).toBeLessThan(mateBox.distanceToPoint(head) + 1e-9);
                    expect(
                        mateBox.distanceToPoint(tip),
                        `${part.id} op#${index} → ${joint.insertPartId}: tip is not in the mate`,
                    ).toBeLessThan(0.02);
                    checked += 1;
                });
            }

            expect(checked).toBeGreaterThan(0);
        });
    }
});

describe('movable hardware in the scene (spec 1.12)', () => {
    function cabinet(): Spec {
        return parseSpec({
            specVersion: '1.15',
            units: 'in',
            name: 'Cabinet',
            materials: [
                { id: 'mat', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
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
            ],
        });
    }

    const hardwareOf = (group: THREE.Group, partId: string): THREE.Object3D[] =>
        (group.getObjectByName(partId)?.children ?? []).filter((c) => c.userData.hardware !== undefined);

    it('hangs the hinges and knob off the door, not the carcase', () => {
        const group = buildSpecGroup(cabinet());
        const onDoor = hardwareOf(group, 'p_door');
        expect(onDoor.map((h) => h.userData.hardware).sort()).toEqual(['hinge', 'hinge', 'knob']);
        expect(hardwareOf(group, 'p_carcase')).toHaveLength(0);
    });

    it('puts the hinges on the hinge line and the knob by the far edge', () => {
        const group = buildSpecGroup(cabinet());
        const onDoor = hardwareOf(group, 'p_door');
        // Local frame: hinge edge w0 is x = −6, front arris z = +0.375.
        for (const hinge of onDoor.filter((h) => h.userData.hardware === 'hinge')) {
            expect(hinge.position.x).toBeCloseTo(-6, 6);
            expect(hinge.position.z).toBeCloseTo(0.375, 6);
        }
        // …and the knob stands on the show face at the opposite end.
        const knob = onDoor.find((h) => h.userData.hardware === 'knob')!;
        expect(knob.position.x).toBeGreaterThan(0);
        expect(knob.position.z).toBeCloseTo(0.375, 6);
    });

    it('adds nothing when the design has no movables', () => {
        const plain = parseSpec({ ...cabinet(), movables: [] } as unknown as Spec);
        expect(hardwareOf(buildSpecGroup(plain), 'p_door')).toHaveLength(0);
    });

    it('gives a drawer a knob and a rail down each side', () => {
        const spec = parseSpec({
            ...cabinet(),
            movables: [
                {
                    id: 'mv_drawer',
                    kind: 'drawer',
                    partIds: ['p_door'],
                    frontPartId: 'p_door',
                    style: 'overlay',
                },
            ],
        } as unknown as Spec);
        const kinds = hardwareOf(buildSpecGroup(spec), 'p_door').map((h) => h.userData.hardware);
        expect(kinds.sort()).toEqual(['knob', 'slideRail', 'slideRail']);
    });
});
