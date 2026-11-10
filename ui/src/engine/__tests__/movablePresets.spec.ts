import { describe, it, expect } from 'vitest';
import {
    detectOpening,
    planDoor,
    planDrawer,
    planMovable,
    hingeEdgeFor,
    frontAllowance,
    defaultMovableOptions,
    type MovableOptions,
} from '@/engine/movablePresets';
import { AddMovable } from '@/engine/commands';
import { EditorDocument } from '@/engine/EditorDocument';
import { lintSpec } from '@/spec/linter';
import { openedPoses } from '@/engine/open';
import { parseSpec } from '@/spec';
import type { Spec } from '@/spec/types';
import { INSET_REVEAL, OVERLAY_ALLOWANCE, SLIDE_CLEARANCE } from '@/spec/movables';

const T = 0.75;

/**
 * A carcase with two sides, a top, and a bottom, framing a 12" × 20" opening that faces +Z.
 * Sides at x ±6.375 (inner faces ±6); top/bottom at y 20.375 / 0.375 (inner faces 20 / 0.75).
 */
function carcase(): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'Carcase',
        materials: [{ id: 'mat', type: 'sheet', name: 'Ply', thickness: T, sheetSize: { l: 96, w: 48 } }],
        parts: [
            {
                id: 'p_side_l',
                name: 'Left',
                materialId: 'mat',
                size: { l: 12, w: 21 },
                transform: { pos: [-6.375, 10.5, -6], rot: [0, 90, 0] },
            },
            {
                id: 'p_side_r',
                name: 'Right',
                materialId: 'mat',
                size: { l: 12, w: 21 },
                transform: { pos: [6.375, 10.5, -6], rot: [0, 90, 0] },
            },
            {
                id: 'p_bottom',
                name: 'Bottom',
                materialId: 'mat',
                size: { l: 12.75, w: 12 },
                transform: { pos: [0, 0.375, -6], rot: [90, 0, 0] },
            },
            {
                id: 'p_top',
                name: 'Top',
                materialId: 'mat',
                size: { l: 12.75, w: 12 },
                transform: { pos: [0, 20.625, -6], rot: [90, 0, 0] },
            },
        ],
        joints: [
            { type: 'butt', hostPartId: 'p_side_l', insertPartId: 'p_bottom' },
            { type: 'butt', hostPartId: 'p_side_r', insertPartId: 'p_bottom' },
            { type: 'butt', hostPartId: 'p_side_l', insertPartId: 'p_top' },
            { type: 'butt', hostPartId: 'p_side_r', insertPartId: 'p_top' },
        ],
    });
}

const options = (over: Partial<MovableOptions> = {}): MovableOptions => ({
    ...defaultMovableOptions(null),
    width: 12,
    height: 20,
    ...over,
});

describe('detectOpening', () => {
    it('reads the clear span between parts that straddle the opening', () => {
        const opening = detectOpening(carcase(), ['p_side_l', 'p_side_r', 'p_top', 'p_bottom'])!;
        expect(opening.width).toBeCloseTo(12, 6); // between the sides' inner faces
        expect(opening.height).toBeCloseTo(19.5, 6); // between top and bottom
        expect(opening.centre[0]).toBeCloseTo(0, 6);
        expect(opening.plane).toBeCloseTo(0, 6); // the carcase front face
    });

    it('falls back to the selection extent on an axis nothing straddles', () => {
        // Two sides only: they give the width, but their own height is the best height guess.
        const opening = detectOpening(carcase(), ['p_side_l', 'p_side_r'])!;
        expect(opening.width).toBeCloseTo(12, 6);
        expect(opening.height).toBeCloseTo(21, 6);
    });

    it('measures the depth available behind the plane', () => {
        const opening = detectOpening(carcase(), ['p_side_l', 'p_side_r'])!;
        expect(opening.depth).toBeCloseTo(12, 6);
    });

    it('returns null with nothing selected, so the caller asks instead of guessing', () => {
        expect(detectOpening(carcase(), [])).toBeNull();
    });
});

describe('sizing rules', () => {
    it('laps the opening for overlay and shrinks inside it for inset', () => {
        expect(frontAllowance('overlay')).toBe(OVERLAY_ALLOWANCE);
        expect(frontAllowance('inset')).toBe(-INSET_REVEAL);
    });

    it('maps each hinge side to the panel edge §3.1 names', () => {
        expect(hingeEdgeFor('left')).toBe('w0');
        expect(hingeEdgeFor('right')).toBe('w1');
        expect(hingeEdgeFor('top')).toBe('l1');
        expect(hingeEdgeFor('bottom')).toBe('l0');
    });
});

describe('planDoor', () => {
    it('cuts an overlay door bigger than the opening and hangs it on the front', () => {
        const spec = carcase();
        const opening = detectOpening(spec, ['p_side_l', 'p_side_r', 'p_top', 'p_bottom'])!;
        const plan = planDoor(spec, opening, options({ style: 'overlay', height: 19.5 }));
        const door = plan.parts[0];

        expect(door.size.l).toBeCloseTo(12 + 2 * OVERLAY_ALLOWANCE, 6);
        expect(door.size.w).toBeCloseTo(19.5 + 2 * OVERLAY_ALLOWANCE, 6);
        // Its back face lands on the carcase front, so it laps rather than sinks in.
        expect(door.transform.pos[2] - T / 2).toBeCloseTo(opening.plane, 6);
    });

    it('cuts an inset door smaller and sits it flush in the opening', () => {
        const spec = carcase();
        const opening = detectOpening(spec, ['p_side_l', 'p_side_r', 'p_top', 'p_bottom'])!;
        const plan = planDoor(spec, opening, options({ style: 'inset', height: 19.5 }));
        const door = plan.parts[0];

        expect(door.size.l).toBeCloseTo(12 - 2 * INSET_REVEAL, 6);
        // Front face flush with the carcase front.
        expect(door.transform.pos[2] + T / 2).toBeCloseTo(opening.plane, 6);
    });

    it('names the hinge edge the chosen side asks for', () => {
        const spec = carcase();
        const opening = detectOpening(spec, ['p_side_l', 'p_side_r'])!;
        const plan = planDoor(spec, opening, options({ hingeSide: 'right' }));
        expect(plan.movable.kind === 'door' && plan.movable.hingeEdge).toBe('w1');
        expect(plan.movable.partIds).toEqual([plan.parts[0].id]);
    });
});

describe('planDrawer', () => {
    const spec = carcase();
    const opening = detectOpening(spec, ['p_side_l', 'p_side_r', 'p_top', 'p_bottom'])!;
    const plan = planDrawer(spec, opening, options({ height: 6 }));

    it('builds a five-part box whose front is the anchor', () => {
        expect(plan.parts).toHaveLength(5);
        expect(plan.movable.partIds).toHaveLength(5);
        expect(plan.movable.kind === 'drawer' && plan.movable.frontPartId).toBe(plan.parts[0].id);
    });

    it('leaves slide clearance either side of the box', () => {
        const [, left, right] = plan.parts;
        const outerSpan = right.transform.pos[0] - left.transform.pos[0] + T;
        expect(outerSpan).toBeCloseTo(12 - SLIDE_CLEARANCE * 2, 6);
    });

    it('sizes the box to a stock slide length that fits the carcase', () => {
        // 12" of depth, less an inch of room behind → a 10" slide.
        expect(plan.parts[1].size.l).toBe(10);
    });

    it('screws the bottom up into the sides, where a screw has wood to bite', () => {
        const doc = new EditorDocument(carcase());
        doc.execute(new AddMovable(plan));
        // Every fastener row must reach a mate — a screw into thin air holds nothing.
        expect(lintSpec(doc.spec).filter((i) => i.code === 'op.fastener-no-mate')).toEqual([]);
    });

    it('fastens the box to itself, never to the carcase', () => {
        const boxIds = new Set(plan.parts.map((p) => p.id));
        for (const joint of plan.joints) {
            expect(boxIds.has(joint.hostPartId)).toBe(true);
            expect(boxIds.has(joint.insertPartId)).toBe(true);
        }
    });
});

describe('an added movable is buildable and it opens', () => {
    function added(kind: 'door' | 'drawer'): EditorDocument {
        const spec = carcase();
        const opening = detectOpening(spec, ['p_side_l', 'p_side_r', 'p_top', 'p_bottom'])!;
        const plan = planMovable(spec, opening, options({ kind, height: kind === 'door' ? 19.5 : 6 }));
        const doc = new EditorDocument(spec);
        doc.execute(new AddMovable(plan));
        return doc;
    }

    it('lints clean — a planned door raises nothing', () => {
        expect(lintSpec(added('door').spec).filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('lints clean — a planned drawer raises nothing', () => {
        const issues = lintSpec(added('drawer').spec);
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
        // And no "held by the hardware alone" warnings: the box really does hold itself.
        expect(issues.filter((i) => i.code === 'movable.member-loose')).toEqual([]);
    });

    it('opens once added — the door swings and the drawer pulls out', () => {
        const door = openedPoses(added('door').spec, 1);
        expect(door.size).toBe(1);
        const drawer = openedPoses(added('drawer').spec, 1);
        expect(drawer.size).toBe(5);
        // The drawer travels forward, along +Z.
        const front = [...drawer.values()][0];
        expect(front.pos[2]).toBeGreaterThan(0);
    });

    it('takes the whole thing back in one undo', () => {
        const doc = added('drawer');
        expect(doc.spec.parts).toHaveLength(9);
        doc.undo();
        expect(doc.spec.parts).toHaveLength(4);
        expect(doc.spec.movables ?? []).toEqual([]);
        expect(doc.spec.joints).toHaveLength(4);
    });
});
