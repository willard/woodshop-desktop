/**
 * Screw and pocket-screw planning (§3.1 fasteners). Given two abutting parts, works out which one
 * the metal goes through, where the row of screws lands, how many there are, and what length is
 * right for the thicknesses involved — the same division of labour as dowels.ts: pure planning
 * here, the AddScrewJoint / AddPocketScrewJoint commands apply it.
 *
 * The sizing rules are the shop's, not ours: a straight wood screw goes through the near board and
 * two thirds into the far one without breaking through (the "2/3 rule"), and a pocket screw's
 * length is read off the host's thickness (Kreg's table: 1/2" → 1", 3/4" → 1-1/4", 1-1/2" → 2-1/2")
 * with coarse thread in softwood and sheet goods, fine thread in hardwood.
 */
import * as THREE from 'three';
import type { Spec, Part, Op, Vec3 } from '../spec/types';
import { worldAABB, localAxesWorld, TOUCH_TOL } from '../spec/geometry';
import { fastenerSegments, partMatrix, type FastenerOp } from './fastenerPlacement';
import { woodScrewLength, pocketScrewLength, pocketScrewThread, screwGauge } from '../spec/fasteners';
import { faceContact, edgeContact, isContactError } from './contact';
import { DEFAULT_SCREW_CONFIG, type ScrewConfig } from './config';

type ScrewsOp = Extract<Op, { type: 'screws' }>;
type PocketOp = Extract<Op, { type: 'pocketHoles' }>;

export interface ScrewPlan {
    /** The part the screws are driven through (it receives the op). */
    partId: string;
    matePartId: string;
    op: ScrewsOp;
}

export interface PocketScrewPlan {
    /** The part whose edge is drilled for pockets (it receives the op). */
    partId: string;
    matePartId: string;
    op: PocketOp;
}

export type ScrewResult<T> = T | { error: string };

const ROUND = 1 / 64; // clean fractions, matching auto-notch and dowels

const snap = (v: number): number => Math.round(v / ROUND) * ROUND;

/** How many fasteners a run of this length wants, and where they start and end. */
function spacing(from: number, to: number, config: ScrewConfig): { from: number; to: number; count: number } {
    const run = to - from;
    const inset = Math.min(config.endInset, run / 4);
    const usable = run - 2 * inset;
    if (usable <= 0 || run < config.minRunForTwo) {
        const centre = from + run / 2;
        return { from: snap(centre), to: snap(centre), count: 1 };
    }
    const count = Math.max(2, Math.min(20, Math.floor(usable / config.spacing) + 1));
    return { from: snap(from + inset), to: snap(to - inset), count };
}

/**
 * Does this plan actually put metal in the mate? Runs the op through the same placement the
 * renderer draws and checks every tip lands inside the mate's body. A plan can be geometrically
 * legal and still useless — a screw that exits the side of a thin mate, or a joint where the
 * contact rectangle sits off to one side — and the honest answer there is to refuse it so the
 * caller tries the other method.
 */
function tipsLandInMate(spec: Spec, host: Part, mate: Part, op: FastenerOp): boolean {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const toWorld = partMatrix(host);
    const mateBox = worldAABB(mate, thicknessOf.get(mate.materialId) ?? 0);
    const box = new THREE.Box3(
        new THREE.Vector3(...mateBox.min),
        new THREE.Vector3(...mateBox.max),
    ).expandByScalar(TOUCH_TOL);

    return fastenerSegments(host, thicknessOf.get(host.materialId) ?? 0, op).every((segment) =>
        box.containsPoint(segment.tip.clone().applyMatrix4(toWorld)),
    );
}

/**
 * Which face to drill the pockets from (spec 1.9). Pocket holes are the one visible scar this
 * joinery leaves, so they go on the side nobody sees: the face pointing into the assembly. Judged
 * against the centre of everything else — for a cabinet top that is downward into the carcase, for
 * an apron it is inward toward the table's middle, which is where a woodworker would put them.
 *
 * A part sitting on the assembly's centre line has no hidden face to prefer, so it keeps the
 * default (`back`) rather than picking a side on the strength of rounding error.
 */
function hiddenFace(spec: Spec, host: Part): 'front' | 'back' {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const centreOf = (part: Part): Vec3 => {
        const box = worldAABB(part, thicknessOf.get(part.materialId) ?? 0);
        return [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) as unknown as Vec3;
    };
    const others = spec.parts.filter((p) => p.id !== host.id);
    if (others.length === 0) {
        return 'back';
    }
    const assembly = others
        .map(centreOf)
        .reduce(
            (sum, c) => [
                sum[0] + c[0] / others.length,
                sum[1] + c[1] / others.length,
                sum[2] + c[2] / others.length,
            ],
            [0, 0, 0] as number[],
        );

    const centre = centreOf(host);
    const front = localAxesWorld(host)[2]; // the +Z face normal, i.e. `front`
    const inward = [0, 1, 2].reduce((sum, i) => sum + (assembly[i] - centre[i]) * front[i], 0);
    // Half a board's thickness of offset before it counts as a side at all.
    const threshold = (thicknessOf.get(host.materialId) ?? 0) / 2;
    return inward > threshold ? 'front' : 'back';
}

/**
 * How far these two parts may interpenetrate and still be a screwable joint: one board's
 * thickness. Overlays, laps, and a back panel let into a rabbet all overlap by design, and screws
 * through the overlap are how they're held — unlike dowels, which need two faces meeting flush.
 */
function overlapAllowance(spec: Spec, aId: string, bId: string): number {
    const thicknessOf = new Map(spec.materials.map((m) => [m.id, m.thickness]));
    const thickness = (id: string): number => {
        const part = spec.parts.find((p) => p.id === id);
        return part === undefined ? 0 : (thicknessOf.get(part.materialId) ?? 0);
    };
    return Math.max(thickness(aId), thickness(bId));
}

/**
 * Plans a row of wood screws joining `preferredId` and `mateId`: through the face that meets the
 * joint, centred across the mate's thickness, spaced along the contact. Returns `{ error }` with a
 * user-facing message when the pair can't be screwed this way.
 */
export function planScrews(
    spec: Spec,
    preferredId: string,
    mateId: string,
    config: ScrewConfig = DEFAULT_SCREW_CONFIG,
): ScrewResult<ScrewPlan> {
    const materials = new Map(spec.materials.map((m) => [m.id, m]));
    const contact = faceContact(spec, preferredId, mateId, overlapAllowance(spec, preferredId, mateId));
    if (isContactError(contact)) {
        return contact;
    }
    const { host, mate, face: contactFace, rect } = contact;
    const hostThickness = materials.get(host.materialId)?.thickness ?? 0;
    const mateThickness = materials.get(mate.materialId)?.thickness ?? 0;
    // `face` on a screws op is where the *heads* sit, so it is the face away from the mate —
    // you drive from the outside, through this board, into the one behind it (§3.1 fasteners).
    const face: 'front' | 'back' = contactFace === 'front' ? 'back' : 'front';

    const width = rect.x1 - rect.x0;
    const height = rect.y1 - rect.y0;
    if (Math.max(width, height) <= 0) {
        return { error: 'The parts share no face area to screw through.' };
    }

    // Screws run down the long side of the contact and sit on its centreline, which for a butt
    // joint is the middle of the mate's thickness — where the screw finds the most wood.
    const alongLength = width >= height;
    const run = alongLength ? spacing(rect.x0, rect.x1, config) : spacing(rect.y0, rect.y1, config);
    const offset = snap(alongLength ? (rect.y0 + rect.y1) / 2 : (rect.x0 + rect.x1) / 2);

    const op: ScrewsOp = {
        type: 'screws',
        face,
        axis: alongLength ? 'l' : 'w',
        offset,
        count: run.count,
        from: run.from,
        to: run.to,
        gauge: screwGauge(mateThickness),
        length: woodScrewLength(hostThickness, mateThickness),
    };
    if (!tipsLandInMate(spec, host, mate, op)) {
        return { error: `Screws through "${host.name}" would miss "${mate.name}".` };
    }
    return { partId: host.id, matePartId: mate.id, op };
}

/**
 * Plans pocket screws joining `preferredId` and `mateId`: pockets drilled in the edge that meets
 * the joint (the rail, not the panel), driven at 15° into the mate's face.
 */
export function planPocketScrews(
    spec: Spec,
    preferredId: string,
    mateId: string,
    config: ScrewConfig = DEFAULT_SCREW_CONFIG,
): ScrewResult<PocketScrewPlan> {
    const materials = new Map(spec.materials.map((m) => [m.id, m]));
    const contact = edgeContact(spec, preferredId, mateId, overlapAllowance(spec, preferredId, mateId));
    if (isContactError(contact)) {
        return contact;
    }
    const { host, mate, edge, from, to } = contact;
    const hostThickness = materials.get(host.materialId)?.thickness ?? 0;
    const mateThickness = materials.get(mate.materialId)?.thickness ?? 0;
    if (to - from <= 0) {
        return { error: 'The parts share no edge contact to pocket-screw.' };
    }
    // Pocket screws leave the drilled board's edge on a slant, so they need a mate at least as
    // thick as that board or the tip wanders out its side: a 1-1/2" leg pocket-screwed into a 3/4"
    // shelf breaks through. The shop's answer is to reverse the joint — screw through the thin
    // piece into the thick one — which is what the caller falls back to.
    if (mateThickness + 1e-6 < hostThickness) {
        return {
            error: `"${mate.name}" is thinner than "${host.name}" — pocket screws would break out of it. Screw through the thinner part instead.`,
        };
    }

    // The pockets sit in the stretch of edge that actually meets the mate — on a long rail or a
    // leg, screws spread over the whole edge would be drilled into thin air.
    const run = spacing(from, to, config);
    const op: PocketOp = {
        type: 'pocketHoles',
        face: hiddenFace(spec, host),
        edge,
        count: run.count,
        from: run.from,
        to: run.to,
        thread: pocketScrewThread(materials.get(mate.materialId)),
        length: pocketScrewLength(hostThickness, mateThickness),
    };
    // Hiding the holes is a preference, not a licence to miss: the screw tilts away from the face
    // it was drilled from, so on thin stock the far side is sometimes the only one that lands.
    if (!tipsLandInMate(spec, host, mate, op)) {
        const flipped: PocketOp = { ...op, face: op.face === 'front' ? 'back' : 'front' };
        if (!tipsLandInMate(spec, host, mate, flipped)) {
            return { error: `Pocket screws in "${host.name}" would miss "${mate.name}".` };
        }
        return { partId: host.id, matePartId: mate.id, op: flipped };
    }
    return { partId: host.id, matePartId: mate.id, op };
}
