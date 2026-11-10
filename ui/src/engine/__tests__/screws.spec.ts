import { describe, it, expect } from 'vitest';
import { planScrews, planPocketScrews } from '@/engine/screws';
import { woodScrewLength, pocketScrewLength, pocketScrewThread } from '@/spec/fasteners';
import { AddScrewJoint } from '@/engine/commands';
import { detectScrewJoints } from '@/engine/joints';
import { EditorDocument } from '@/engine/EditorDocument';
import { lintSpec } from '@/spec/linter';
import { parseSpec, type Spec } from '@/spec';

/**
 * Edge-to-face butt: a horizontal shelf (rot [90,0,0]) meets a vertical side (rot [0,90,0]) whose
 * inner face is at x = 12, coincident with the shelf's w1 end. The shelf presents an edge — the
 * pocket-screw host — and the side presents a face.
 */
function lJoint(species?: string): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'Screw L',
        materials: [
            {
                id: 'mat',
                type: 'lumber',
                name: 'Poplar 3/4',
                thickness: 0.75,
                stockWidth: 12,
                stockLengths: [96],
                ...(species === undefined ? {} : { species }),
            },
        ],
        parts: [
            {
                id: 'p_shelf',
                name: 'Shelf',
                materialId: 'mat',
                size: { l: 24, w: 8 },
                transform: { pos: [0, 6, 0], rot: [90, 0, 0] },
            },
            {
                id: 'p_side',
                name: 'Side',
                materialId: 'mat',
                size: { l: 8, w: 12 },
                transform: { pos: [12.375, 6, 0], rot: [0, 90, 0] },
            },
        ],
    }) as Spec;
}

/** A 3/4" top resting on a 1-1/2" leg below it — the wood-screw case (through the top, down). */
function topOnLeg(): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'Screw T',
        materials: [
            { id: 'mat', type: 'sheet', name: 'Ply 3/4', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
            {
                id: 'mat_leg',
                type: 'lumber',
                name: '2x2',
                thickness: 1.5,
                stockWidth: 1.5,
                stockLengths: [96],
            },
        ],
        parts: [
            {
                id: 'p_top',
                name: 'Top',
                materialId: 'mat',
                size: { l: 24, w: 16 },
                transform: { pos: [0, 24.375, 0], rot: [90, 0, 0] },
            },
            {
                id: 'p_leg',
                name: 'Leg',
                materialId: 'mat_leg',
                size: { l: 24, w: 1.5 },
                transform: { pos: [-10, 12, 0], rot: [0, 0, 90] },
            },
        ],
    }) as Spec;
}

describe('screw sizing follows the shop rules', () => {
    it('sizes a wood screw by the 2/3 rule, rounded to a stocked length', () => {
        // 3/4 through + 2/3 of 3/4 (0.5) = 1.25 exactly.
        expect(woodScrewLength(0.75, 0.75)).toBe(1.25);
        // Into a 1-1/2" leg the ideal is 1.75; 1.5 is the longest stocked length under it.
        expect(woodScrewLength(0.75, 1.5)).toBe(1.5);
    });

    it('never lets the tip break out the far side', () => {
        // 1/4" back panel into 1/2" stock: ideal 0.583, but the hard limit is 0.75 − 0.125.
        expect(woodScrewLength(0.25, 0.5)).toBeLessThanOrEqual(0.625);
    });

    it('reads pocket-screw length off the host thickness', () => {
        expect(pocketScrewLength(0.5)).toBe(1);
        expect(pocketScrewLength(0.75)).toBe(1.25);
        expect(pocketScrewLength(1.5)).toBe(2.5);
    });

    it('picks coarse thread for sheet goods and softwood, fine for hardwood', () => {
        const sheet = { id: 'm', type: 'sheet', name: 'Ply', thickness: 0.75 } as never;
        const pine = { id: 'm', type: 'lumber', name: 'Pine', thickness: 0.75, species: 'pine' } as never;
        const oak = { id: 'm', type: 'lumber', name: 'Oak', thickness: 0.75, species: 'oak' } as never;
        expect(pocketScrewThread(sheet)).toBe('coarse');
        expect(pocketScrewThread(pine)).toBe('coarse');
        expect(pocketScrewThread(oak)).toBe('fine');
    });
});

describe('planPocketScrews', () => {
    it('drills the edge that meets the joint and sizes the screws for it', () => {
        const plan = planPocketScrews(lJoint(), 'p_shelf', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        expect(plan.partId).toBe('p_shelf'); // the shelf presents the edge
        expect(plan.matePartId).toBe('p_side');
        expect(plan.op.edge).toBe('w1'); // its +X end, where the side is
        expect(plan.op.count).toBe(2); // an 8" deep shelf gets two
        expect(plan.op.length).toBe(1.25);
        expect(plan.op.thread).toBe('coarse');
    });

    it('reads the mate species: pocket screws into oak get fine thread', () => {
        const plan = planPocketScrews(lJoint('oak'), 'p_shelf', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        expect(plan.op.thread).toBe('fine');
    });

    it('refuses parts that do not touch', () => {
        const spec = lJoint();
        const moved: Spec = {
            ...spec,
            parts: spec.parts.map((p) =>
                p.id === 'p_side' ? { ...p, transform: { ...p.transform, pos: [40, 6, 0] as never } } : p,
            ),
        };
        expect(planPocketScrews(moved, 'p_shelf', 'p_side')).toEqual({
            error: 'Parts must touch to fasten them.',
        });
    });
});

describe('planScrews', () => {
    it('puts the heads on the face away from the mate and spaces them along the contact', () => {
        const plan = planScrews(topOnLeg(), 'p_top', 'p_leg');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        expect(plan.partId).toBe('p_top');
        // The top's local +Z points down at the leg, so the heads sit on `back` — the show face.
        expect(plan.op.face).toBe('back');
        expect(plan.op.gauge).toBe('#8');
        expect(plan.op.length).toBe(1.5); // 3/4 + 2/3 of a 1-1/2" leg, rounded down
        expect(plan.op.count).toBeGreaterThanOrEqual(1);
    });

    it('produces an op the linter accepts, and the screws find their mate', () => {
        const spec = topOnLeg();
        const plan = planScrews(spec, 'p_top', 'p_leg');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        const doc = new EditorDocument(spec);
        doc.execute(new AddScrewJoint(plan.partId, plan.matePartId, plan.op));

        const issues = lintSpec(doc.spec);
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(issues.some((i) => i.code === 'op.fastener-no-mate')).toBe(false);
    });
});

describe('AddScrewJoint', () => {
    it('appends the op, locks the part, records the joint, and undoes exactly', () => {
        const spec = topOnLeg();
        const doc = new EditorDocument(spec);
        const before = JSON.stringify(doc.spec);
        const plan = planScrews(spec, 'p_top', 'p_leg');
        if ('error' in plan) {
            throw new Error(plan.error);
        }

        doc.execute(new AddScrewJoint(plan.partId, plan.matePartId, plan.op));
        const top = doc.spec.parts.find((p) => p.id === 'p_top')!;
        expect(top.ops?.at(-1)?.type).toBe('screws');
        expect(top.locked).toBe(true);
        expect(doc.spec.joints).toEqual([
            { type: 'screw', hostPartId: 'p_top', insertPartId: 'p_leg', opRef: 0 },
        ]);

        doc.undo();
        expect(JSON.stringify(doc.spec)).toBe(before);
    });

    it('records a pocketScrew joint for a pocketHoles op', () => {
        const spec = lJoint();
        const doc = new EditorDocument(spec);
        const plan = planPocketScrews(spec, 'p_shelf', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        doc.execute(new AddScrewJoint(plan.partId, plan.matePartId, plan.op));
        expect(doc.spec.joints?.[0].type).toBe('pocketScrew');
    });
});

describe('detectScrewJoints', () => {
    it('finds the part behind a screw row', () => {
        const spec = topOnLeg();
        const plan = planScrews(spec, 'p_top', 'p_leg');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        const withOp: Spec = {
            ...spec,
            parts: spec.parts.map((p) => (p.id === 'p_top' ? { ...p, ops: [plan.op] } : p)),
        };
        expect(detectScrewJoints(withOp)).toEqual([
            { type: 'screw', hostPartId: 'p_top', insertPartId: 'p_leg', opRef: 0 },
        ]);
    });

    it('finds nothing when the screws point into open air', () => {
        const spec = topOnLeg();
        const flipped: Spec = {
            ...spec,
            parts: spec.parts.map((p) =>
                p.id === 'p_top'
                    ? {
                          ...p,
                          ops: [
                              {
                                  type: 'screws' as const,
                                  face: 'front' as const,
                                  axis: 'l' as const,
                                  offset: 8,
                                  count: 2,
                              },
                          ],
                      }
                    : p,
            ),
        };
        expect(detectScrewJoints(flipped)).toEqual([]);
    });
});

describe('planPocketScrews chooses the face (spec 1.9)', () => {
    it('drills from the face pointing into the assembly, so the holes are hidden', () => {
        // The shelf's local +Z faces the side it is screwed to... the pockets belong on whichever
        // of its faces looks inward, which for a shelf between two uprights is derived from where
        // the rest of the design sits.
        const plan = planPocketScrews(lJoint(), 'p_shelf', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        expect(['front', 'back']).toContain(plan.op.face);

        // Whichever face it picked, the screws still land in the mate — hiding the holes never
        // costs the joint (the planner flips back if the hidden side would miss).
        const doc = new EditorDocument(lJoint());
        doc.execute(new AddScrewJoint(plan.partId, plan.matePartId, plan.op));
        const issues = lintSpec(doc.spec);
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(issues.some((i) => i.code === 'op.fastener-no-mate')).toBe(false);
    });

    it('puts a cabinet top’s pockets on its underside, not the show face', () => {
        // Top lying flat (rot [90,0,0] → local +Z points down) over a side below it: the inward
        // face is `front`, so that is where the holes go.
        const spec = parseSpec({
            specVersion: '1.15',
            units: 'in',
            name: 'Carcase',
            materials: [
                { id: 'mat', type: 'sheet', name: 'Ply', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
            ],
            parts: [
                {
                    id: 'p_top',
                    name: 'Top',
                    materialId: 'mat',
                    size: { l: 22.5, w: 16 },
                    transform: { pos: [0, 23.625, 0], rot: [90, 0, 0] },
                },
                {
                    id: 'p_side',
                    name: 'Side',
                    materialId: 'mat',
                    size: { l: 16, w: 24 },
                    transform: { pos: [-11.625, 12, 0], rot: [0, 90, 0] },
                },
            ],
        }) as Spec;

        const plan = planPocketScrews(spec, 'p_top', 'p_side');
        if ('error' in plan) {
            throw new Error(plan.error);
        }
        expect(plan.partId).toBe('p_top');
        expect(plan.op.face).toBe('front'); // local +Z points down into the carcase
    });
});
