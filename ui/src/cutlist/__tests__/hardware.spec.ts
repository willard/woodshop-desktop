import { describe, it, expect } from 'vitest';
import { computeHardware } from '@/cutlist/hardware';
import { computeCutList } from '@/cutlist';
import { parseSpec, type Spec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

/** Two 3/4" boards, screwed and pocket-screwed, plus a dowelled pair — one of each hardware kind. */
function fastenedSpec(ops: unknown[], joints: unknown[] = [], qty = 1): Spec {
    return parseSpec({
        specVersion: '1.15',
        units: 'in',
        name: 'Hardware',
        materials: [
            { id: 'mat', type: 'sheet', name: 'Ply 3/4', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
            {
                id: 'mat_oak',
                type: 'lumber',
                name: 'Oak',
                thickness: 1.5,
                stockWidth: 6,
                stockLengths: [96],
                species: 'oak',
            },
        ],
        parts: [
            {
                id: 'p_a',
                name: 'A',
                materialId: 'mat',
                size: { l: 24, w: 12 },
                transform: { pos: [0, 6, 0], rot: [0, 0, 0] },
                ops,
                qty,
            },
            {
                id: 'p_b',
                name: 'B',
                materialId: 'mat_oak',
                size: { l: 24, w: 12 },
                transform: { pos: [0, 6, -1.125], rot: [0, 0, 0] },
            },
        ],
        joints,
    }) as Spec;
}

describe('computeHardware', () => {
    it('derives pocket-screw length and thread when the spec omits them', () => {
        const spec = fastenedSpec(
            [{ type: 'pocketHoles', edge: 'l0', count: 3 }],
            [{ type: 'pocketScrew', hostPartId: 'p_a', insertPartId: 'p_b', opRef: 0 }],
        );
        // 3/4" host → 1-1/4" screws; the mate is oak → fine thread.
        expect(computeHardware(spec)).toEqual([
            { kind: 'pocketScrew', description: '1 1/4" fine-thread pocket screws', qty: 3 },
        ]);
    });

    it('honours sizes the spec states outright', () => {
        const spec = fastenedSpec([
            { type: 'pocketHoles', edge: 'l0', count: 2, thread: 'coarse', length: 2.5 },
        ]);
        expect(computeHardware(spec)[0].description).toBe('2 1/2" coarse-thread pocket screws');
    });

    it('sizes wood screws from the mate behind them and counts per part copy', () => {
        const spec = fastenedSpec(
            [{ type: 'screws', face: 'front', axis: 'l', offset: 6, count: 4 }],
            [{ type: 'screw', hostPartId: 'p_a', insertPartId: 'p_b', opRef: 0 }],
            2, // two copies of the part → twice the screws
        );
        // 3/4 through + 2/3 of a 1-1/2" oak mate = 1.75 ideal → 1-1/2" stocked.
        expect(computeHardware(spec)).toEqual([
            { kind: 'woodScrew', description: '#8 × 1 1/2" wood screws', qty: 8 },
        ]);
    });

    it('lists dowels from dowel holes and merges identical rows', () => {
        const hole = {
            type: 'hole',
            face: 'front',
            x: 4,
            y: 6,
            diameter: 0.375,
            depth: 0.5,
            purpose: 'dowel',
        };
        const spec = fastenedSpec([hole, { ...hole, x: 12 }, { ...hole, x: 20, purpose: 'shelfPin' }]);
        // Two dowel holes merge into one row; the shelf pin is not hardware the list buys.
        expect(computeHardware(spec)).toEqual([{ kind: 'dowel', description: '3/8" × 1" dowels', qty: 2 }]);
    });

    it('is empty for a design with no fasteners', () => {
        expect(computeHardware(fastenedSpec([]))).toEqual([]);
    });

    it('rides along on the cut list', () => {
        const cutList = computeCutList(parseSpec(recordStand) as Spec);
        expect(cutList.hardware).toEqual([
            { kind: 'pocketScrew', description: '1 1/4" coarse-thread pocket screws', qty: 12 },
            { kind: 'woodScrew', description: '#8 × 1" wood screws', qty: 24 },
        ]);
    });
});

/**
 * A design can say "these two parts are screwed together" without saying where the screws go. It
 * used to report `hardware: []` — an agent's bike rack with five screw joints and two dowel joints
 * came back with no metal at all, which is worse than an estimate.
 */
describe('computeHardware — joints with no fastener op behind them (1.14)', () => {
    it('estimates screws for a screw joint that has no screws op', () => {
        const rows = computeHardware(
            fastenedSpec([], [{ type: 'screw', hostPartId: 'p_a', insertPartId: 'p_b' }]),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe('woodScrew');
        expect(rows[0].derived).toBe(true);
        expect(rows[0].description).toContain('estimated');
        expect(rows[0].qty).toBeGreaterThan(0);
    });

    it('estimates pocket screws and dowels the same way', () => {
        const rows = computeHardware(
            fastenedSpec(
                [],
                [
                    { type: 'pocketScrew', hostPartId: 'p_a', insertPartId: 'p_b' },
                    { type: 'dowel', hostPartId: 'p_a', insertPartId: 'p_b' },
                ],
            ),
        );

        expect(rows.map((r) => r.kind)).toEqual(['pocketScrew', 'dowel']);
        expect(rows.every((r) => r.derived === true)).toBe(true);
    });

    it('stays quiet when the op is there — the op counts, the estimate does not', () => {
        const rows = computeHardware(
            fastenedSpec(
                [{ type: 'screws', face: 'front', axis: 'l', offset: 6, count: 4 }],
                [{ type: 'screw', hostPartId: 'p_a', insertPartId: 'p_b' }],
            ),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].qty).toBe(4);
        expect(rows[0].derived).toBeUndefined();
    });

    it('asks for no metal for joinery that needs none', () => {
        const rows = computeHardware(
            fastenedSpec(
                [],
                [
                    { type: 'butt', hostPartId: 'p_a', insertPartId: 'p_b' },
                    { type: 'dado', hostPartId: 'p_a', insertPartId: 'p_b' },
                    { type: 'rabbet', hostPartId: 'p_a', insertPartId: 'p_b' },
                ],
            ),
        );

        expect(rows).toEqual([]);
    });

    it('skips a joint whose parts are gone rather than guessing', () => {
        const rows = computeHardware(
            fastenedSpec([], [{ type: 'screw', hostPartId: 'p_a', insertPartId: 'p_ghost' }]),
        );

        expect(rows).toEqual([]);
    });

    it('leaves the golden fixtures alone — every joint in them is backed by an op', () => {
        expect(computeHardware(parseSpec(recordStand)).some((r) => r.derived === true)).toBe(false);
    });
});

describe('computeHardware — movables (spec 1.12)', () => {
    /** A cabinet with one door and one drawer annotated as movables. */
    function movableSpec(overrides: Record<string, unknown>[] = []): Spec {
        return parseSpec({
            specVersion: '1.15',
            units: 'in',
            name: 'Cabinet',
            materials: [
                { id: 'mat', type: 'sheet', name: 'Ply 3/4', thickness: 0.75, sheetSize: { l: 96, w: 48 } },
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
                    size: { l: 14, w: 10 },
                    transform: { pos: [6, 18, -6], rot: [90, 0, 0] },
                },
            ],
            joints: [{ type: 'screw', hostPartId: 'p_front', insertPartId: 'p_bottom' }],
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
                ...overrides,
            ],
        });
    }

    it('puts hinges, slides, and knobs on the list, after the screws and dowels', () => {
        const rows = computeHardware(movableSpec());
        expect(rows.map((r) => [r.kind, r.description, r.qty])).toEqual([
            // The screw joint holding the drawer box together carries no `screws` op, so its metal
            // is estimated from the joint rather than going unreported (1.14).
            ['woodScrew', '#8 × 1 1/4" wood screws (estimated — no screws op)', 3],
            ['hinge', 'overlay cabinet hinges', 2],
            // Bottom spans z −11..−1, front z 0.025..0.775 → 11.775" deep box → 10" slides.
            ['drawerSlide', '10" side-mount drawer slides (pairs)', 1],
            ['knob', 'cabinet knobs', 2],
        ]);
    });

    it('adds a third hinge past a 40" hinge edge and separates inset from overlay rows', () => {
        const spec = movableSpec([
            {
                id: 'mv_tall',
                kind: 'door',
                partIds: ['p_carcase'],
                panelPartId: 'p_carcase',
                hingeEdge: 'w1',
                style: 'inset',
            },
        ]);
        // Make the second door's hinge edge (w1 → width) taller than 40".
        const tall = {
            ...spec,
            parts: spec.parts.map((p) => (p.id === 'p_carcase' ? { ...p, size: { l: 24, w: 42 } } : p)),
        };
        const rows = computeHardware(parseSpec(tall));
        const hinges = rows.filter((r) => r.kind === 'hinge');
        expect(hinges).toEqual([
            { kind: 'hinge', description: 'inset butt hinges', qty: 3 },
            { kind: 'hinge', description: 'overlay cabinet hinges', qty: 2 },
        ]);
    });

    it('skips a movable whose anchor is missing instead of throwing (the linter reports it)', () => {
        const spec = movableSpec();
        const broken = { ...spec, parts: spec.parts.filter((p) => p.id !== 'p_door') };
        // parseSpec would pass (schema doesn't know about refs); the list must not explode.
        const rows = computeHardware(broken as Spec);
        expect(rows.some((r) => r.kind === 'drawerSlide')).toBe(true);
        expect(rows.filter((r) => r.kind === 'knob')[0]?.qty).toBe(1);
    });

    it('leaves the frozen golden fixtures untouched (no movables, no new rows)', () => {
        const rows = computeHardware(parseSpec(recordStand));
        expect(rows.every((r) => ['pocketScrew', 'woodScrew', 'dowel'].includes(r.kind))).toBe(true);
    });
});
