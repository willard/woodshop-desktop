import { describe, it, expect } from 'vitest';
import { planParts, defaultOptions, rotationFor, PART_PRESETS } from '@/engine/presets';
import { AddParts, makePart } from '@/engine/commands';
import { aabbFromPart } from '@/engine/snapping';
import { lintSpec } from '@/spec/linter';
import type { Spec, Part } from '@/spec/types';

const THICKNESS = 0.75;

/** A spec holding one flat top, 36 × 24, resting on the ground unless placed higher. */
function specWithTop(pos: [number, number, number] = [0, THICKNESS / 2, 0]): Spec {
    return {
        specVersion: '1.14',
        units: 'in',
        name: 'Table',
        movables: [],
        groups: [],
        materials: [
            {
                id: 'm',
                type: 'sheet',
                name: 'Ply',
                thickness: THICKNESS,
                sheetSize: { l: 96, w: 48 },
            },
        ],
        parts: [
            makePart({
                id: 'p_top',
                name: 'Top',
                materialId: 'm',
                size: { l: 36, w: 24 },
                pos,
                rot: [90, 0, 0],
            }),
        ],
        joints: [],
    } as Spec;
}

function boxOf(spec: Spec, part: Part) {
    return aabbFromPart(part, spec.materials[0].thickness);
}

describe('rotationFor', () => {
    it('stands a part on end, on edge, or on its face', () => {
        // §3.1: length is local +X, so an unrotated part lies down — that is the bug this fixes.
        expect(rotationFor('upright')).toEqual([0, 0, 90]);
        expect(rotationFor('onEdge')).toEqual([0, 0, 0]);
        expect(rotationFor('flat')).toEqual([90, 0, 0]);
    });
});

describe('planParts — legs', () => {
    const spec = specWithTop();
    const plan = planParts(spec, defaultOptions('leg'));

    it('adds four upright legs by default', () => {
        expect(PART_PRESETS.leg.qty).toBe(4);
        expect(plan.parts).toHaveLength(4);
        expect(plan.parts.every((p) => p.transform.rot[2] === 90)).toBe(true);
    });

    it('stands each leg up, not along the floor', () => {
        for (const leg of plan.parts) {
            const box = boxOf(spec, leg);
            expect(box.max[1] - box.min[1]).toBeCloseTo(PART_PRESETS.leg.l, 6);
            expect(box.max[0] - box.min[0]).toBeCloseTo(PART_PRESETS.leg.w, 6);
        }
    });

    it('puts one leg at each corner of the top, inside its footprint', () => {
        const top = boxOf(spec, spec.parts[0]);
        const corners = plan.parts.map((leg) => {
            const box = boxOf(spec, leg);
            expect(box.min[0]).toBeGreaterThanOrEqual(top.min[0] - 1e-6);
            expect(box.max[0]).toBeLessThanOrEqual(top.max[0] + 1e-6);
            expect(box.min[2]).toBeGreaterThanOrEqual(top.min[2] - 1e-6);
            expect(box.max[2]).toBeLessThanOrEqual(top.max[2] + 1e-6);
            return `${Math.sign(leg.transform.pos[0])},${Math.sign(leg.transform.pos[2])}`;
        });
        expect(new Set(corners).size).toBe(4);
    });

    it('stands the legs on the floor and lifts the design onto them', () => {
        // The top's underside starts on the ground, so it rises by a full leg length.
        expect(plan.lift!.partIds).toEqual(['p_top']);
        expect(plan.lift!.dy).toBeCloseTo(PART_PRESETS.leg.l, 6);
        for (const leg of plan.parts) {
            expect(boxOf(spec, leg).min[1]).toBeCloseTo(0, 6);
        }

        // The top's underside now rests exactly on the leg tops.
        const built = new AddParts(plan.parts, plan.lift).do(spec);
        expect(boxOf(built, built.parts[0]).min[1]).toBeCloseTo(PART_PRESETS.leg.l, 6);
    });

    it('leaves a design that already sits high enough where it is', () => {
        const high = specWithTop([0, 30, 0]);
        const highPlan = planParts(high, defaultOptions('leg'));

        expect(highPlan.lift).toBeNull();
        // Legs hang from the underside instead, so they still touch.
        const top = boxOf(high, high.parts[0]);
        expect(Math.max(...highPlan.parts.map((p) => boxOf(high, p).max[1]))).toBeCloseTo(top.min[1], 6);
    });

    it('carries the lowest part, not the topmost — legs go under a carcase, not through it', () => {
        // A box: bottom on the ground, lid 20" up, both 36 × 24.
        const cabinet = specWithTop();
        cabinet.parts.push(
            makePart({
                id: 'p_lid',
                name: 'Lid',
                materialId: 'm',
                size: { l: 36, w: 24 },
                pos: [0, 20, 0],
                rot: [90, 0, 0],
            }),
        );

        const cabinetPlan = planParts(cabinet, defaultOptions('leg'));
        const built = new AddParts(cabinetPlan.parts, cabinetPlan.lift).do(cabinet);
        const bottom = built.parts.find((p) => p.id === 'p_top')!;

        for (const leg of cabinetPlan.parts) {
            // Every leg sits below the carcase, never inside it.
            expect(boxOf(built, leg).max[1]).toBeLessThanOrEqual(boxOf(built, bottom).min[1] + 1e-6);
        }
        expect(lintSpec(built).map((i) => i.code)).not.toContain('part.pierce');
    });

    it('produces a spec that lints clean — no floating or pierced parts', () => {
        const built = new AddParts(plan.parts, plan.lift).do(spec);
        const codes = lintSpec(built).map((issue) => issue.code);

        expect(codes).not.toContain('part.floating');
        expect(codes).not.toContain('part.pierce');
    });
});

describe('planParts — everything else', () => {
    const spec = specWithTop();

    it('rests a shelf on top of the assembly, touching it', () => {
        const plan = planParts(spec, defaultOptions('shelf'));
        expect(plan.parts).toHaveLength(1);
        expect(plan.lift).toBeNull();

        const assembly = boxOf(spec, spec.parts[0]);
        expect(boxOf(spec, plan.parts[0]).min[1]).toBeCloseTo(assembly.max[1], 6);
        expect(lintSpec(new AddParts(plan.parts).do(spec)).map((i) => i.code)).not.toContain('part.floating');
    });

    it('stands an apron on its long edge', () => {
        const plan = planParts(spec, defaultOptions('apron'));
        const box = boxOf(spec, plan.parts[0]);

        expect(box.max[1] - box.min[1]).toBeCloseTo(PART_PRESETS.apron.w, 6);
        expect(box.max[0] - box.min[0]).toBeCloseTo(PART_PRESETS.apron.l, 6);
    });

    it('honours an explicit quantity and size', () => {
        const plan = planParts(spec, { kind: 'slat', l: 30, w: 2, qty: 3, orientation: 'flat' });

        expect(plan.parts).toHaveLength(3);
        expect(plan.parts.map((p) => p.size)).toEqual([
            { l: 30, w: 2 },
            { l: 30, w: 2 },
            { l: 30, w: 2 },
        ]);
        expect(new Set(plan.parts.map((p) => p.id)).size).toBe(3);
        expect(plan.parts.map((p) => p.name)).toEqual(['Slat 1', 'Slat 2', 'Slat 3']);
    });

    it('names a lone part after its preset', () => {
        expect(planParts(spec, { ...defaultOptions('shelf'), qty: 1 }).parts[0].name).toBe('Shelf');
    });
});

describe('AddParts', () => {
    const spec = specWithTop();
    const plan = planParts(spec, defaultOptions('leg'));

    it('adds every part and applies the lift in one step', () => {
        const after = new AddParts(plan.parts, plan.lift).do(spec);

        expect(after.parts).toHaveLength(5);
        expect(after.parts[0].transform.pos[1]).toBeCloseTo(
            spec.parts[0].transform.pos[1] + plan.lift!.dy,
            6,
        );
        // A placement, not a hand-edit: hard rule 10's lock is untouched.
        expect(after.parts[0].locked).toBe(spec.parts[0].locked);
    });

    it('undoes to the exact prior spec', () => {
        const command = new AddParts(plan.parts, plan.lift);
        const after = command.do(spec);

        expect(command.undo(after)).toEqual(spec);
    });

    it('labels itself by how many parts it added', () => {
        expect(new AddParts(plan.parts, plan.lift).label).toBe('Add 4 parts');
        expect(new AddParts([plan.parts[0]]).label).toBe('Add part');
    });
});
