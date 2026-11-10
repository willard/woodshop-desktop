import { describe, it, expect } from 'vitest';
import { lintSpec } from '@/spec/linter';
import { parseSpec, type Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import bookshelf from '@fixtures/specs/bookshelf.spec.json';

function clone(spec: unknown): Spec {
    return parseSpec(structuredClone(spec));
}

describe('lintSpec — golden fixtures are clean', () => {
    it('finds no errors in the record stand', () => {
        const issues = lintSpec(parseSpec(recordStand));
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('finds no errors in the bookshelf', () => {
        const issues = lintSpec(parseSpec(bookshelf));
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });
});

describe('lintSpec — part fits material', () => {
    it('flags a part larger than its grained sheet', () => {
        const spec = clone(recordStand);
        spec.parts[0].size.l = 61; // sheet is 60×60, part is grain-locked → cannot rotate
        spec.parts[0].size.w = 61;
        const issues = lintSpec(spec);
        expect(issues.some((i) => i.code === 'part.oversized' && i.partId === spec.parts[0].id)).toBe(true);
    });

    it('allows a non-grained part to fit rotated', () => {
        const spec = clone(recordStand);
        spec.materials[0].grain = false;
        spec.parts[0].grainAxis = 'none';
        spec.parts[0].size.l = 59;
        spec.parts[0].size.w = 20; // fits either orientation on 60×60
        expect(lintSpec(spec).some((i) => i.code === 'part.oversized')).toBe(false);
    });

    it('flags lumber longer than the stock it is sold in', () => {
        const spec = pierceSpec();
        spec.parts[1].size.l = 120; // mat_leg lists [96]
        expect(lintSpec(spec).some((i) => i.code === 'part.oversized' && i.partId === 'p_leg')).toBe(true);
    });

    it('flags lumber longer than the assumed stock when the material lists none', () => {
        // The cut list packs against DEFAULT_STOCK_LENGTH whether or not stockLengths is set,
        // so staying silent here is how a 120" rail shipped as one 96" stick.
        const spec = pierceSpec();
        delete spec.materials[1].stockLengths;
        spec.parts[1].size.l = 120;
        expect(lintSpec(spec).some((i) => i.code === 'part.oversized' && i.partId === 'p_leg')).toBe(true);
    });

    it('leaves a part within the assumed stock alone', () => {
        const spec = pierceSpec();
        delete spec.materials[1].stockLengths;
        spec.parts[1].size.l = 90; // under the assumed 96
        expect(lintSpec(spec).some((i) => i.code === 'part.oversized')).toBe(false);
    });
});

describe('lintSpec — ops fit part', () => {
    it('flags a dado that runs off the edge', () => {
        const spec = clone(recordStand);
        const side = spec.parts[0];
        side.ops![0].offset = 40; // side width is 34
        expect(lintSpec(spec).some((i) => i.code === 'op.out-of-bounds')).toBe(true);
    });

    it('flags a dado deeper than the material', () => {
        const spec = clone(recordStand);
        spec.parts[0].ops![0].depth = 2; // thickness 0.709
        expect(lintSpec(spec).some((i) => i.code === 'op.out-of-bounds')).toBe(true);
    });

    it('flags a stopped dado ending past the run', () => {
        const spec = clone(recordStand);
        const op = spec.parts[0].ops![0];
        if (op.type === 'dado') {
            op.to = 25; // side length (run) is 19
        }
        expect(lintSpec(spec).some((i) => i.code === 'op.out-of-bounds')).toBe(true);
    });

    it('flags a stopped dado with an inverted run', () => {
        const spec = clone(recordStand);
        const op = spec.parts[0].ops![0];
        if (op.type === 'dado') {
            op.from = 10;
            op.to = 5;
        }
        expect(lintSpec(spec).some((i) => i.code === 'op.out-of-bounds')).toBe(true);
    });

    it('accepts a valid stopped dado', () => {
        const spec = clone(recordStand);
        const op = spec.parts[0].ops![0];
        if (op.type === 'dado') {
            op.from = 0.75;
            op.to = 19;
        }
        expect(lintSpec(spec).filter((i) => i.severity === 'error')).toEqual([]);
    });
});

describe('lintSpec — joints', () => {
    it('flags a dado joint whose width != mate thickness', () => {
        const spec = clone(recordStand);
        spec.parts[0].ops![0].width = 0.5; // mate thickness is 0.709
        const issues = lintSpec(spec);
        expect(issues.some((i) => i.code === 'joint.dado-width-mismatch')).toBe(true);
    });

    it('flags a joint referencing a missing part', () => {
        const spec = clone(recordStand);
        spec.joints![0].insertPartId = 'p_ghost';
        expect(lintSpec(spec).some((i) => i.code === 'joint.ref-missing')).toBe(true);
    });
});

describe('lintSpec — joint seating', () => {
    it('flags a dado joint whose insert never reaches the dado', () => {
        // Shrink the shelf so it stops flush with the sides' inner faces instead of
        // entering the 0.25"-deep dados — the spec-42 failure mode (annotated joint, no seat).
        const spec = clone(recordStand);
        const shelf = spec.parts.find((p) => p.id === 'p_shelf_1')!;
        shelf.size.l -= 0.5;
        const issues = lintSpec(spec);
        expect(issues.filter((i) => i.code === 'joint.mate-not-seated')).toHaveLength(2);
        expect(issues.some((i) => i.code === 'joint.mate-not-seated' && i.jointIndex === 0)).toBe(true);
        expect(issues.some((i) => i.code === 'joint.mate-not-seated' && i.jointIndex === 1)).toBe(true);
    });

    it('flags a dado joint whose insert floats clear of the host', () => {
        const spec = clone(recordStand);
        const shelf = spec.parts.find((p) => p.id === 'p_shelf_1')!;
        shelf.size.l -= 4; // a real gap on both ends, but still touching the back panel
        expect(lintSpec(spec).filter((i) => i.code === 'joint.mate-not-seated')).toHaveLength(2);
    });

    it('accepts a fully seated dado joint', () => {
        // The unmodified fixture seats the shelf exactly op.depth into both sides.
        expect(lintSpec(parseSpec(recordStand)).some((i) => i.code === 'joint.mate-not-seated')).toBe(false);
    });

    it('ignores joints without an opRef', () => {
        const spec = clone(recordStand);
        const shelf = spec.parts.find((p) => p.id === 'p_shelf_1')!;
        shelf.size.l -= 0.5;
        spec.joints!.forEach((j) => delete j.opRef);
        expect(lintSpec(spec).some((i) => i.code === 'joint.mate-not-seated')).toBe(false);
    });
});

/**
 * Two-material scratch spec for the pierce cases. Defaults to a tabletop with a leg poking
 * clean through its face — the part.pierce failure; pass `parts` for the allowed layouts.
 */
function pierceSpec(parts?: unknown[]): Spec {
    return parseSpec({
        specVersion: '1.7',
        units: 'in',
        name: 'pierce',
        materials: [
            {
                id: 'mat_ply',
                type: 'sheet',
                name: 'Ply',
                thickness: 0.75,
                sheetSize: { l: 60, w: 60 },
                grain: true,
            },
            {
                id: 'mat_leg',
                type: 'lumber',
                name: '2x2',
                thickness: 1.5,
                stockWidth: 1.5,
                stockLengths: [96],
                grain: true,
            },
        ],
        parts: parts ?? [
            {
                id: 'p_top',
                name: 'Top',
                materialId: 'mat_ply',
                size: { l: 24, w: 16 },
                grainAxis: 'l',
                transform: { pos: [0, 23.625, 0], rot: [90, 0, 0] },
                qty: 1,
            },
            {
                id: 'p_leg',
                name: 'Leg',
                materialId: 'mat_leg',
                size: { l: 25, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [8, 12.5, 4], rot: [0, 0, 90] },
                qty: 1,
            },
        ],
        joints: [],
    });
}

describe('lintSpec — pierced parts', () => {
    it('flags a leg passing completely through a tabletop', () => {
        const issues = lintSpec(pierceSpec());
        expect(issues.some((i) => i.code === 'part.pierce' && i.partId === 'p_leg')).toBe(true);
    });

    it('does not flag a leg that stops at the underside', () => {
        const spec = pierceSpec();
        const leg = spec.parts.find((p) => p.id === 'p_leg')!;
        leg.size.l = 23.25;
        leg.transform.pos = [8, 11.625, 4]; // top of leg exactly at the top's underside
        expect(lintSpec(spec).some((i) => i.code === 'part.pierce')).toBe(false);
    });

    it('does not flag a full-width back overlaying the sides (butt joint)', () => {
        const spec = pierceSpec([
            {
                id: 'p_side',
                name: 'Side',
                materialId: 'mat_ply',
                size: { l: 16, w: 24 },
                grainAxis: 'l',
                transform: { pos: [-11.625, 12, 0], rot: [0, 90, 0] },
                qty: 1,
            },
            {
                id: 'p_back',
                name: 'Back',
                materialId: 'mat_ply',
                size: { l: 24, w: 24 },
                grainAxis: 'l',
                transform: { pos: [0, 12, -7.625], rot: [0, 0, 0] },
                qty: 1,
            },
        ]);
        expect(lintSpec(spec).some((i) => i.code === 'part.pierce')).toBe(false);
    });

    it('does not flag a corner lap', () => {
        const spec = pierceSpec([
            {
                id: 'p_rail_a',
                name: 'Rail A',
                materialId: 'mat_leg',
                size: { l: 24, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
                qty: 1,
            },
            {
                id: 'p_rail_b',
                name: 'Rail B',
                materialId: 'mat_leg',
                size: { l: 24, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [11.25, 11.25, 0], rot: [0, 0, 90] },
                qty: 1,
            },
        ]);
        expect(lintSpec(spec).some((i) => i.code === 'part.pierce')).toBe(false);
    });

    it('does not flag a slat flush-mounted on a tilted post (OBB confirms bodies only touch)', () => {
        // A 75°-tilted backrest post with a slat resting flush on its front face (from the
        // outdoor-bench design). Their AABBs overlap because the tilt inflates each box, but the
        // real oriented bodies only touch — the OBB gate must suppress the false pierce.
        const spec = pierceSpec([
            {
                id: 'p_post',
                name: 'Post',
                materialId: 'mat_leg', // 2x2, 1.5" thick
                size: { l: 14, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [12.5, 21.610833, -23.25], rot: [-90, -75, -180] },
                qty: 1,
            },
            {
                id: 'p_slat',
                name: 'Slat',
                materialId: 'mat_leg', // 1.5" thick — flush face-mount offsets by 0.75 + 0.75
                size: { l: 48, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [11.394398, 23.28023, 0], rot: [-90, -75, 90] },
                qty: 1,
            },
        ]);
        expect(lintSpec(spec).some((i) => i.code === 'part.pierce')).toBe(false);
    });

    it('still flags a genuinely embedded tilted part (OBB confirms real overlap)', () => {
        // Same tilted post, but the slat is pushed onto the post's centreline (no face offset),
        // so the bodies truly interpenetrate — the pierce error must still fire.
        const spec = pierceSpec([
            {
                id: 'p_post',
                name: 'Post',
                materialId: 'mat_leg',
                size: { l: 14, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [12.5, 21.610833, -23.25], rot: [-90, -75, -180] },
                qty: 1,
            },
            {
                id: 'p_slat',
                name: 'Slat',
                materialId: 'mat_leg',
                size: { l: 48, w: 1.5 },
                grainAxis: 'l',
                transform: { pos: [12.5, 21.610833, 0], rot: [-90, -75, 90] }, // sunk to the post centre
                qty: 1,
            },
        ]);
        expect(lintSpec(spec).some((i) => i.code === 'part.pierce')).toBe(true);
    });

    it('skips parts whose notch clears the intruder', () => {
        // AABBs can't see the notch cutout, so a notched part is exempt from pierce checks.
        const spec = pierceSpec();
        const top = spec.parts.find((p) => p.id === 'p_top')!;
        top.ops = [{ type: 'notch', edge: 'l0', from: 10, to: 13, depth: 6 }];
        expect(lintSpec(spec).some((i) => i.code === 'part.pierce')).toBe(false);
    });
});

describe('lintSpec — floating parts', () => {
    it('flags a part that touches nothing', () => {
        const spec = clone(recordStand);
        const shelf = spec.parts.find((p) => p.id === 'p_shelf_1')!;
        shelf.transform.pos = [0, 100, 0]; // fly the shelf far above the carcass
        const issues = lintSpec(spec);
        expect(issues.some((i) => i.code === 'part.floating' && i.partId === 'p_shelf_1')).toBe(true);
    });

    it('does not flag a snug butt joint', () => {
        // Fixtures assemble exactly edge-to-edge; the small tolerance must not mistake
        // a touching part for a floating one.
        expect(lintSpec(parseSpec(bookshelf)).some((i) => i.code === 'part.floating')).toBe(false);
    });

    it('ignores single-part specs', () => {
        const spec = clone(recordStand);
        spec.parts = [spec.parts[0]];
        spec.joints = [];
        expect(lintSpec(spec).some((i) => i.code === 'part.floating')).toBe(false);
    });
});

describe('lintSpec — duplicate part ids', () => {
    it('flags duplicate part ids as error', () => {
        const spec = clone(recordStand);
        spec.parts.push({
            ...spec.parts[0],
            name: 'Duplicate Side',
        });
        const issues = lintSpec(spec);
        const dupes = issues.filter((i) => i.code === 'part.duplicate-id');
        expect(dupes.length).toBe(1);
        expect(dupes[0].severity).toBe('error');
        expect(dupes[0].partId).toBe(spec.parts[0].id);
    });
});
