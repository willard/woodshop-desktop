/**
 * Selection-driven part editor (right dock "Inspector"). Purely presentational: every change is
 * reported through a callback and the workspace executes the Command.
 */
import { Lock, LockOpen, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { HardwareMount, Movable, Op, Part, Species } from '@/spec';
import type { HardwarePatch, PlacementRequest } from '@/engine';
import { MovableFittings, PartHardware } from './HardwareFittings';
import { MirrorButtons } from './MirrorButtons';
import {
    DEFAULT_EASE_CONFIG,
    WORKSPACE_POS_BOUND,
    defaultShelfPins,
    frontColumn,
    planShelfPins,
    readShelfPins,
    shelfPinProblem,
    shelfPinRuns,
    type RowColumns,
    type RowPurpose,
    type ShelfPinOptions,
    type ShelfPinRun,
} from '@/engine';
import { opSummary } from '@/spec/opLabel';
import { Section } from './InspectorSection';
import { Popover } from './Popover';
import {
    DOWEL_SIZES,
    LUMBER_SIZES,
    METRIC_DOWEL_SIZES,
    METRIC_LUMBER_SIZES,
    dowelSizeOf,
} from '@/lib/lumberSizes';
import { Field, PrimaryButton, SecondaryButton, SectionLabel, Select, TextInput, onEnter } from './form';
import { getUnits, len, lenValue, parseLen, parseSignedLen, unitSuffix } from '@/lib/display';

type Edge = 'l0' | 'l1' | 'w0' | 'w1';
type Axis3 = 0 | 1 | 2;

export interface PartInspectorProps {
    part: Part;
    materialName: string;
    thickness: number | null;
    species: Species | null;
    /** Nominal lumber label ("2x4") when the part's material is standard stock. */
    nominal: string | null;
    /** Round stock carries no ops (a dowel has no faces or edges to cut). */
    round: boolean;
    /** Sheet goods (plywood, MDF): their edges can be banded. */
    sheet?: boolean;
    /** Sets the edges covered with edge banding. */
    onEdgeBand(edges: Edge[]): void;
    dowel: string | null;
    /** False while exploded/open — click-to-place is blocked there. */
    canPlace: boolean;
    overlaps: { partId: string; name: string }[];
    touching: { partId: string; name: string }[];
    movable: Movable | null;
    onResize(size: { l: number; w: number }): void;
    onMove(pos: [number, number, number]): void;
    onHide(): void;
    onRotate(axis: Axis3): void;
    onRotateBy(axis: Axis3, delta: number): void;
    onRotateTo(axis: Axis3, deg: number): void;
    onDuplicate(): void;
    /** `count` copies along world `axis` (0 x, 1 y, 2 z), `gap` apart edge to edge. */
    onCopies(count: number, axis: 0 | 1 | 2, gap: number): void;
    /** A mirrored copy across the design's middle, along world `axis`. */
    onMirror(axis: 0 | 1 | 2): void;
    onRemove(): void;
    onRename(name: string): void;
    /** Lock the part against agents' edits, or hand it back to them. */
    onSetLocked(locked: boolean): void;
    onAddOp(op: Op): void;
    /** Swaps the cut at `index` for an edited one. */
    onReplaceOp(index: number, op: Op): void;
    onRemoveOp(index: number): void;
    /** Swaps `deleteCount` cuts from `start` for `ops`, as one undo step (a run of shelf-pin holes). */
    onSpliceOps(start: number, deleteCount: number, ops: Op[], label: string): void;
    /** Which face looks into the case and which way is up, for a new run of shelf-pin holes. */
    shelfPinFacing?: { face: 'front' | 'back'; axis: 'l' | 'w' };
    onSpecies(species: Species): void;
    onStock(nominal: string): void;
    onRoundStock(label: string): void;
    onGrainAxis(axis: 'l' | 'w' | 'none'): void;
    onPlaceOp(request: PlacementRequest): void;
    onNotchAround(insertPartId: string, clearance: number): void;
    onPushOut(overlapPartId: string): void;
    onDowelTo(matePartId: string): void;
    onFastenTo(matePartId: string, method: 'pocket' | 'screws'): void;
    onMakeMovable(kind: 'door' | 'drawer'): void;
    onUpdateMovable(patch: Record<string, unknown>): void;
    onDissolveMovable(): void;
    /** Catalog hardware mounted on this part (spec 1.15). */
    hardware: HardwareMount[];
    onAddHardware(): void;
    onUpdateHardware(id: string, patch: HardwarePatch): void;
    onRemoveHardware(id: string): void;
    /** The piece picked in the 3D view, highlighted and scrolled to. */
    selectedHardwareId: string | null;
    onSelectHardware(id: string | null): void;
}

const IMPERIAL_STOCK = {
    lumberLabel: 'Dimensional lumber',
    lumber: LUMBER_SIZES,
    dowelLabel: 'Dowel rod',
    dowels: DOWEL_SIZES,
};
const METRIC_STOCK = {
    lumberLabel: 'Timber (metric)',
    lumber: METRIC_LUMBER_SIZES,
    dowelLabel: 'Dowel rod (metric)',
    dowels: METRIC_DOWEL_SIZES,
};

/** Stock sizes for the picker, the system being worked in first. */
function stockGroups() {
    return getUnits() === 'metric' ? [METRIC_STOCK, IMPERIAL_STOCK] : [IMPERIAL_STOCK, METRIC_STOCK];
}

const SPECIES_OPTIONS: { value: Species; label: string }[] = [
    { value: 'pine', label: 'Pine' },
    { value: 'oak', label: 'Oak' },
    { value: 'maple', label: 'Maple' },
    { value: 'walnut', label: 'Walnut' },
    { value: 'cherry', label: 'Cherry' },
    { value: 'cedar', label: 'Cedar' },
];

const EDGE_LABELS: { value: Edge; label: string }[] = [
    { value: 'l1', label: 'Top edge' },
    { value: 'l0', label: 'Bottom edge' },
    { value: 'w0', label: 'Left end' },
    { value: 'w1', label: 'Right end' },
];

const AXIS_LABELS = ['X', 'Y', 'Z'] as const;
/** Named for what the part does, seen from the front: about X it tips, about Y it turns, about Z it rolls. */
const ROTATIONS: { axis: Axis3; label: string; hint: string }[] = [
    { axis: 0, label: 'Tip', hint: 'Tip forward or back (about the left-right axis)' },
    { axis: 1, label: 'Turn', hint: 'Turn left or right (about the vertical axis)' },
    { axis: 2, label: 'Roll', hint: 'Roll onto its side (about the front-back axis)' },
];

/** Which columns a run of holes can have, the front one marked when the part shows it. */
function columnChoices(part: Part, axis: 'l' | 'w'): { value: RowColumns; label: string }[] {
    const [low, high] = axis === 'l' ? ['l0', 'l1'] : ['w0', 'w1'];
    const name = (edge: string) => EDGE_LABELS.find((e) => e.value === edge)!.label.toLowerCase();
    const front = frontColumn(part, axis);
    const mark = (c: RowColumns) => (front === c ? ' (front)' : front !== null ? ' (back)' : '');
    return [
        { value: 'both', label: 'Both edges' },
        { value: 'low', label: `By the ${name(low)} only${mark('low')}` },
        { value: 'high', label: `By the ${name(high)} only${mark('high')}` },
    ];
}

/** The two perpendicular edges adjoining `edge`, with picker-friendly labels. */
function endsOf(edge: string): { value: Edge; label: string }[] {
    return edge.startsWith('l')
        ? [
              { value: 'w0', label: 'Left end' },
              { value: 'w1', label: 'Right end' },
          ]
        : [
              { value: 'l0', label: 'Bottom end' },
              { value: 'l1', label: 'Top end' },
          ];
}

type OpForm = 'dado' | 'rabbet' | 'hole' | 'pins' | 'curve' | 'notch' | 'pocket' | 'miter' | 'ease';

/**
 * What a taper's height comes to as an angle off square, so an angled end can be cut to the
 * degree the plan gives: a corner moved in `height` across an edge `along` long.
 */
function TaperAngle({ height, along }: { height: number | null; along: number }) {
    const degrees =
        height !== null && height > 0 && height < along ? (Math.atan(height / along) * 180) / Math.PI : null;
    return (
        <p className="text-muted mb-2 text-xs" data-testid="taper-angle">
            {degrees === null
                ? 'For an angled end, the height is the board width times the tangent of the angle: about 3 3/16 for 30° on a 5 1/2 board.'
                : `Cuts ${Math.round(degrees * 10) / 10}° off square.`}
        </p>
    );
}
const OP_BUTTONS: { form: OpForm; label: string; does: string; icon: string }[] = [
    { form: 'dado', label: 'Dado or groove', does: 'A channel another part sits in', icon: 'dado' },
    { form: 'rabbet', label: 'Rabbet', does: 'A step along an edge, for a back or a lid', icon: 'rabbet' },
    { form: 'hole', label: 'Hole', does: 'Dowel, shelf-pin or through hole', icon: 'hole' },
    {
        form: 'pins',
        label: 'Rows of holes',
        does: 'Shelf pins, hinge plates and slides (32 mm)',
        icon: 'shelfPins',
    },
    { form: 'pocket', label: 'Pocket screws', does: 'Angled screws through an edge', icon: 'pocketHoles' },
    {
        form: 'curve',
        label: 'Curve or angle',
        does: 'An arched edge, rounded corners or an angled end',
        icon: 'curve',
    },
    { form: 'notch', label: 'Notch', does: 'A cut-out from an edge', icon: 'notch' },
    { form: 'miter', label: 'Miter', does: 'An angled edge for a corner joint', icon: 'miter' },
    { form: 'ease', label: 'Soft edge', does: 'Roundover, chamfer or bullnose', icon: 'ease' },
];

/** A small line icon per kind of cut, so a list of them can be scanned. */
function OpIcon({ type }: { type: string }) {
    const path: Record<string, string> = {
        dado: 'M3 8h18M3 16h18M9 8v8M15 8v8',
        groove: 'M3 8h18M3 16h18M9 8v8M15 8v8',
        rabbet: 'M3 6h18v12H9V12H3Z',
        hole: 'M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10Z',
        shelfPins:
            'M5.8 5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M5.8 10a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M5.8 15a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M5.8 20a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M15.8 5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M15.8 10a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M15.8 15a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M15.8 20a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0',
        pocketHoles: 'M4 18 14 8m-3-1 6 6M15 5l4 4',
        screws: 'M12 3v4m-3 0h6l-1 12h-4ZM10 11h4m-4 4h4',
        curve: 'M3 18c4-10 14-10 18 0',
        notch: 'M3 6h6v6h6V6h6v12H3Z',
        miter: 'M4 18h16L4 6Z',
        ease: 'M4 18V10a6 6 0 0 1 6-6h10',
    };
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d={path[type] ?? 'M5 12h14'}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** The form that edits an op, or null for one only Fasten to or the 3D view makes. */
function editFormOf(op: Op): OpForm | null {
    switch (op.type) {
        case 'dado':
            return 'dado';
        case 'rabbet':
            return 'rabbet';
        case 'hole':
            return 'hole';
        case 'curve':
            return 'curve';
        case 'notch':
            return 'notch';
        case 'pocketHoles':
            return 'pocket';
        case 'miter':
            return 'miter';
        case 'ease':
            return 'ease';
        default:
            return null;
    }
}

const posText = (part: Part): [string, string, string] => [
    lenValue(part.transform.pos[0]),
    lenValue(part.transform.pos[1]),
    lenValue(part.transform.pos[2]),
];
const rotText = (part: Part): [string, string, string] => [
    String(part.transform.rot[0]),
    String(part.transform.rot[1]),
    String(part.transform.rot[2]),
];

export function PartInspector(p: PartInspectorProps) {
    const { part } = p;

    // --- Rename (the part name doubles as the edit affordance) ---
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const nameInput = useRef<HTMLInputElement>(null);

    // --- Dimension, position and rotation fields: text, so fractions and half-typed values work.
    const [lInput, setLInput] = useState(lenValue(part.size.l));
    const [wInput, setWInput] = useState(lenValue(part.size.w));
    const [posInputs, setPosInputs] = useState(posText(part));
    const [rotInputs, setRotInputs] = useState(rotText(part));

    useEffect(() => {
        setRenaming(false); // selection or part changed — drop any half-typed rename
        setLInput(lenValue(part.size.l));
        setWInput(lenValue(part.size.w));
        setPosInputs(posText(part));
        setRotInputs(rotText(part));
    }, [part]);

    // A different part: an edit in progress belonged to the last one.
    useEffect(() => {
        setEditing(null);
        setOpenForm(null);
    }, [part.id]);

    useEffect(() => {
        if (renaming) nameInput.current?.select();
    }, [renaming]);

    function commitRename(): void {
        if (!renaming) return;
        setRenaming(false);
        const name = nameDraft.trim();
        if (name !== '' && name !== part.name) p.onRename(name);
    }

    /**
     * Fields display 1/16", but stored dimensions need not land on it. Text that still matches what
     * was rendered means "unchanged", so the exact stored value passes straight through.
     */
    function typedDimension(input: string, current: number): number | null {
        return input.trim() === lenValue(current) ? current : parseLen(input);
    }

    function commitResize(): void {
        const l = typedDimension(lInput, part.size.l);
        const w = typedDimension(wInput, part.size.w);
        if (l === null || w === null || l <= 0 || w <= 0 || l > 240 || w > 240) {
            setLInput(lenValue(part.size.l));
            setWInput(lenValue(part.size.w));
            return;
        }
        if (l !== part.size.l || w !== part.size.w) {
            p.onResize({ l, w });
        } else {
            // Same size typed another way ("12 in" for 305 mm): show it the usual way.
            setLInput(lenValue(l));
            setWInput(lenValue(w));
        }
    }

    function commitPosition(axis: Axis3): void {
        const text = posInputs[axis];
        const value = parseSignedLen(text);
        const current = part.transform.pos;
        if (value === null || value < -WORKSPACE_POS_BOUND || value > WORKSPACE_POS_BOUND) {
            setPosInputs(posText(part));
            return;
        }
        // Unchanged text means the user did not ask for a move (the shown value is rounded).
        if (text.trim() === lenValue(current[axis]) || value === current[axis]) {
            setPosInputs(posText(part));
            return;
        }
        const pos: [number, number, number] = [current[0], current[1], current[2]];
        pos[axis] = value;
        p.onMove(pos);
    }

    function commitRotation(axis: Axis3): void {
        const value = Number(rotInputs[axis].trim());
        const current = part.transform.rot[axis];
        if (!Number.isFinite(value) || value < -180 || value > 180) {
            setRotInputs(rotText(part));
            return;
        }
        if (value !== current) p.onRotateTo(axis, value);
    }

    function setAt<T extends string[]>(list: T, i: number, value: string): T {
        const next = [...list] as T;
        next[i] = value;
        return next;
    }

    // --- Op forms ---
    const [openForm, setOpenForm] = useState<OpForm | null>(null);
    /** The cut being edited, by index, while its form is open; null when adding a new one. */
    const [editing, setEditing] = useState<number | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [dado, setDado] = useState({
        face: 'front',
        axis: 'l',
        offset: '',
        width: lenValue(0.75),
        depth: '',
    });
    const [stopped, setStopped] = useState(false);
    const [dadoRun, setDadoRun] = useState({ from: '', to: '' });
    const [hole, setHole] = useState({
        face: 'front',
        x: '',
        y: '',
        diameter: lenValue(0.25),
        depth: '',
        purpose: 'other',
    });
    const [curve, setCurve] = useState({ edge: 'l1', kind: 'arc', size: '', end: 'both', from: '' });
    const [notch, setNotch] = useState({ edge: 'l1', from: '0', to: '', depth: '' });
    const [clearance, setClearance] = useState(lenValue(0.0625));
    const [pocket, setPocket] = useState({ edge: 'w1', count: '2' });
    const [miter, setMiter] = useState({ edge: 'w1', angle: '15' });
    const [rabbet, setRabbet] = useState({ edge: 'l1', width: lenValue(0.25), depth: '' });
    const [ease, setEase] = useState({
        edge: 'l1',
        profile: 'roundover',
        size: lenValue(DEFAULT_EASE_CONFIG.defaultRadius),
        face: 'both',
    });
    const [easeStopped, setEaseStopped] = useState(false);
    /** The run of shelf-pin holes being changed, while the pins form is open on it. */
    const [editingRun, setEditingRun] = useState<ShelfPinRun | null>(null);
    const [pins, setPins] = useState({
        face: 'front',
        axis: 'l',
        purpose: 'shelfPin' as RowPurpose,
        columns: 'both' as RowColumns,
        inset: '',
        from: '',
        to: '',
        spacing: '',
        diameter: '',
        depth: '',
    });
    const [easeRun, setEaseRun] = useState({ from: '', to: '' });

    // Keep the curve's end picker valid when the edge or kind changes (a ramp or taper needs a
    // real end).
    function updateCurve(patch: Partial<typeof curve>): void {
        setCurve((prev) => {
            const next = { ...prev, ...patch };
            const valid = endsOf(next.edge).some((e) => e.value === next.end);
            if ((next.kind === 'ramp' || next.kind === 'taper') && (next.end === 'both' || !valid))
                next.end = endsOf(next.edge)[0].value;
            else if (next.end !== 'both' && !valid) next.end = 'both';
            return next;
        });
    }

    function toggleForm(kind: OpForm): void {
        setFormError(null);
        setEditing(null);
        setEditingRun(null);
        const next = openForm === kind ? null : kind;
        setOpenForm(next);
        if (next === 'pins') fillPins(newPins());
        if (next === 'dado' && dado.depth === '' && p.thickness !== null) {
            setDado((d) => ({ ...d, depth: lenValue(p.thickness! / 2) }));
        }
        if (next === 'rabbet' && rabbet.depth === '' && p.thickness !== null) {
            setRabbet((r) => ({ ...r, depth: lenValue(p.thickness! / 2) }));
        }
    }

    /** A required positive fraction; sets the shared error naming the field when invalid. */
    function dim(label: string, raw: string): number | null {
        const value = parseLen(raw.trim());
        if (value === null || value <= 0 || value > 240) {
            setFormError(`${label} needs a positive dimension (e.g. 3 1/2)`);
            return null;
        }
        return value;
    }

    /** Like dim(), but 0 is legal (a notch `from: 0` is a corner notch). */
    function dim0(label: string, raw: string): number | null {
        const value = parseLen(raw.trim());
        if (value === null || value < 0 || value > 240) {
            setFormError(`${label} needs a dimension of 0 or more (e.g. 3 1/2)`);
            return null;
        }
        return value;
    }

    function add(op: Op): void {
        if (editing !== null) p.onReplaceOp(editing, op);
        else p.onAddOp(op);
        setOpenForm(null);
        setEditing(null);
    }

    /** Opens the cut's own form filled in with its values; saving replaces it in place. */
    function startEdit(index: number): void {
        setEditingRun(null);
        const op = part.ops?.[index];
        const form = op === undefined ? null : editFormOf(op);
        if (op === undefined || form === null) return;
        setFormError(null);
        const v = (n: number | undefined) => (n === undefined ? '' : lenValue(n));
        switch (op.type) {
            case 'dado':
                setDado({
                    face: op.face,
                    axis: op.axis,
                    offset: v(op.offset),
                    width: v(op.width),
                    depth: v(op.depth),
                });
                setStopped(op.from !== undefined || op.to !== undefined);
                setDadoRun({ from: v(op.from), to: v(op.to) });
                break;
            case 'hole':
                setHole({
                    face: op.face,
                    x: v(op.x),
                    y: v(op.y),
                    diameter: v(op.diameter),
                    depth: v(op.depth),
                    purpose: op.purpose ?? 'other',
                });
                break;
            case 'curve':
                if (op.kind === 'clip')
                    setCurve({
                        edge: op.edge,
                        kind: 'clip',
                        size: v(op.size),
                        end: op.corner ?? 'both',
                        from: '',
                    });
                else if (op.kind === 'round')
                    setCurve({
                        edge: op.edge,
                        kind: 'round',
                        size: v(op.radius),
                        end: op.corner ?? 'both',
                        from: '',
                    });
                else if (op.kind === 'ramp' || op.kind === 'taper')
                    setCurve({
                        edge: op.edge,
                        kind: op.kind,
                        size: v(op.height),
                        end: op.low,
                        from: op.kind === 'taper' && op.from !== undefined ? v(op.from) : '',
                    });
                else setCurve({ edge: op.edge, kind: 'arc', size: v(op.height), end: 'both', from: '' });
                break;
            case 'notch':
                setNotch({ edge: op.edge, from: v(op.from), to: v(op.to), depth: v(op.depth) });
                break;
            case 'pocketHoles':
                setPocket({ edge: op.edge, count: String(op.count) });
                break;
            case 'miter':
                setMiter({ edge: op.edge, angle: String(op.angle) });
                break;
            case 'rabbet':
                setRabbet({ edge: op.edge, width: v(op.width), depth: v(op.depth) });
                break;
            case 'ease':
                setEase({
                    edge: op.edge,
                    profile: op.profile,
                    size:
                        op.profile === 'roundover'
                            ? v(op.radius)
                            : op.profile === 'chamfer'
                              ? v(op.width)
                              : ease.size,
                    face: op.face ?? 'both',
                });
                setEaseStopped(op.from !== undefined || op.to !== undefined);
                setEaseRun({ from: v(op.from), to: v(op.to) });
                break;
        }
        setOpenForm(form);
        setEditing(index);
    }

    function run(
        from: string,
        to: string,
        allowZero: boolean,
        chord?: number,
    ): { from?: number; to?: number } | null {
        const f = allowZero ? dim0('From', from) : dim('From', from);
        const t = dim('To', to);
        if (f === null || t === null) return null;
        if (t <= f) {
            setFormError('To must be greater than From');
            return null;
        }
        if (chord !== undefined && t > chord) {
            setFormError(`To must be within the ${len(chord)} edge`);
            return null;
        }
        return { from: f, to: t };
    }

    function submitDado(): void {
        setFormError(null);
        const offset = dim('Offset', dado.offset);
        const width = dim('Width', dado.width);
        const depth = dim('Depth', dado.depth);
        if (offset === null || width === null || depth === null) return;
        const extent = stopped ? run(dadoRun.from, dadoRun.to, false) : {};
        if (extent === null) return;
        add({
            type: 'dado',
            face: dado.face as 'front' | 'back',
            axis: dado.axis as 'l' | 'w',
            offset,
            width,
            depth,
            ...extent,
        });
    }

    function placeDado(): void {
        setFormError(null);
        const width = dim('Width', dado.width);
        const depth = dim('Depth', dado.depth);
        if (width === null || depth === null) return;
        p.onPlaceOp({ kind: 'dado', axis: dado.axis as 'l' | 'w', width, depth });
        setOpenForm(null);
    }

    function holeDepth(): number | undefined | null {
        if (hole.depth.trim() === '') return undefined;
        return dim('Depth', hole.depth);
    }

    function submitHole(): void {
        setFormError(null);
        const x = dim('X', hole.x);
        const y = dim('Y', hole.y);
        const diameter = dim('Diameter', hole.diameter);
        const depth = holeDepth();
        if (x === null || y === null || diameter === null || depth === null) return;
        add({
            type: 'hole',
            face: hole.face as 'front' | 'back',
            x,
            y,
            diameter,
            ...(depth === undefined ? {} : { depth }),
            purpose: hole.purpose as 'dowel' | 'shelfPin' | 'hardware' | 'other',
        });
    }

    function placeHole(): void {
        setFormError(null);
        const diameter = dim('Diameter', hole.diameter);
        const depth = holeDepth();
        if (diameter === null || depth === null) return;
        p.onPlaceOp({
            kind: 'hole',
            diameter,
            ...(depth === undefined ? {} : { depth }),
            purpose: hole.purpose as 'dowel' | 'shelfPin' | 'hardware' | 'other',
        });
        setOpenForm(null);
    }

    function submitCurve(): void {
        setFormError(null);
        const size = dim(
            curve.kind === 'round' ? 'Radius' : curve.kind === 'clip' ? 'Size' : 'Height',
            curve.size,
        );
        if (size === null) return;
        const edge = curve.edge as Edge;
        if (curve.kind === 'arc') {
            add({ type: 'curve', edge, kind: 'arc', height: size });
        } else if (curve.kind === 'clip') {
            add({
                type: 'curve',
                edge,
                kind: 'clip',
                size,
                ...(curve.end === 'both' ? {} : { corner: curve.end as Edge }),
            });
        } else if (curve.kind === 'ramp' || curve.kind === 'taper') {
            const low = curve.end === 'both' ? endsOf(edge)[0].value : (curve.end as Edge);
            // A taper may run straight first (a leg square where the apron meets it).
            let from: number | undefined;
            if (curve.kind === 'taper' && curve.from.trim() !== '') {
                const run = dim('Straight for', curve.from);
                if (run === null) return;
                from = run;
            }
            add({
                type: 'curve',
                edge,
                kind: curve.kind,
                height: size,
                low,
                ...(from === undefined ? {} : { from }),
            });
        } else {
            add({
                type: 'curve',
                edge,
                kind: 'round',
                radius: size,
                ...(curve.end === 'both' ? {} : { corner: curve.end as Edge }),
            });
        }
    }

    function submitNotch(): void {
        setFormError(null);
        const extent = run(notch.from, notch.to, true);
        const depth = dim('Depth', notch.depth);
        if (extent === null || depth === null) return;
        add({ type: 'notch', edge: notch.edge as Edge, from: extent.from!, to: extent.to!, depth });
    }

    function pocketCount(): number | null {
        const count = Math.round(Number(pocket.count));
        if (!Number.isFinite(count) || count < 1 || count > 20) {
            setFormError('Count must be a whole number from 1 to 20');
            return null;
        }
        return count;
    }

    /** A length for a field that reads back exactly: `1 1/4` when that is the value, else `32 mm`. */
    function exactText(inches: number): string {
        const text = lenValue(inches);
        const back = parseLen(text);
        return back !== null && Math.abs(back - inches) < 1e-4 ? text : `${+(inches * 25.4).toFixed(2)} mm`;
    }

    function newPins(): ShelfPinOptions {
        const metric = getUnits() === 'metric';
        return defaultShelfPins(part, p.thickness ?? 0.75, {
            ...p.shelfPinFacing,
            diameter: metric ? 5 / 25.4 : 0.25,
            step: metric ? 1 / 25.4 : 1 / 16,
        });
    }

    function fillPins(o: ShelfPinOptions): void {
        setPins({
            face: o.face,
            axis: o.axis,
            purpose: o.purpose ?? 'shelfPin',
            columns: o.columns ?? 'both',
            inset: exactText(o.inset),
            from: exactText(o.from),
            to: exactText(o.to),
            spacing: exactText(o.spacing),
            diameter: exactText(o.diameter),
            depth: exactText(o.depth),
        });
    }

    /** The form's values, or null (with the error shown) when one doesn't read. */
    function pinOptions(): ShelfPinOptions | null {
        const inset = dim('Inset', pins.inset);
        const from = dim0('First hole', pins.from);
        const to = dim('Last hole', pins.to);
        const spacing = dim('Spacing', pins.spacing);
        const diameter = dim('Diameter', pins.diameter);
        const depth = dim('Depth', pins.depth);
        if ([inset, from, to, spacing, diameter, depth].some((v) => v === null)) return null;
        return {
            face: pins.face as 'front' | 'back',
            axis: pins.axis as 'l' | 'w',
            purpose: pins.purpose,
            columns: pins.columns,
            inset: inset!,
            from: from!,
            to: to!,
            spacing: spacing!,
            diameter: diameter!,
            depth: depth!,
        };
    }

    function submitPins(): void {
        setFormError(null);
        const o = pinOptions();
        if (o === null) return;
        const problem = shelfPinProblem(part, p.thickness ?? Infinity, o, editingRun?.count ?? 0);
        if (problem !== null) {
            setFormError(problem);
            return;
        }
        const holes = planShelfPins(part, o);
        const what = o.purpose === 'hardware' ? 'hardware holes' : 'shelf-pin holes';
        if (editingRun === null) p.onSpliceOps(part.ops.length, 0, holes, `Add ${what}`);
        else p.onSpliceOps(editingRun.start, editingRun.count, holes, `Change ${what}`);
        setOpenForm(null);
        setEditingRun(null);
    }

    function startEditRun(run: ShelfPinRun): void {
        const holes = part.ops.slice(run.start, run.start + run.count) as Extract<Op, { type: 'hole' }>[];
        const o = readShelfPins(part, holes);
        if (o === null) return;
        setFormError(null);
        setEditing(null);
        setEditingRun(run);
        fillPins(o);
        setOpenForm('pins');
    }

    function submitRabbet(): void {
        setFormError(null);
        const width = dim('Width', rabbet.width);
        const depth = dim('Depth', rabbet.depth);
        if (width === null || depth === null) return;
        if (p.thickness !== null && depth >= p.thickness) {
            setFormError(`Depth must be less than the ${len(p.thickness)} stock`);
            return;
        }
        add({ type: 'rabbet', edge: rabbet.edge as Edge, width, depth });
    }

    function submitMiter(): void {
        setFormError(null);
        const angle = Number(miter.angle.trim());
        if (!Number.isFinite(angle) || angle <= 0 || angle > 60) {
            setFormError('Angle must be between 0 and 60 degrees');
            return;
        }
        add({ type: 'miter', edge: miter.edge as Edge, angle });
    }

    function submitEase(): void {
        setFormError(null);
        const edge = ease.edge as Edge;
        const chord = edge === 'l0' || edge === 'l1' ? part.size.l : part.size.w;
        const extent = easeStopped ? run(easeRun.from, easeRun.to, true, chord) : {};
        if (extent === null) return;
        if (ease.profile === 'bullnose') {
            add({ type: 'ease', edge, profile: 'bullnose', ...extent });
            return;
        }
        const size = dim(ease.profile === 'roundover' ? 'Radius' : 'Width', ease.size);
        if (size === null) return;
        // The bit can only take half the stock when it runs down both sides — say so here.
        const limit = p.thickness === null ? null : ease.face === 'both' ? p.thickness / 2 : p.thickness;
        if (limit !== null && size > limit) {
            setFormError(
                `Max ${len(limit)} on ${len(p.thickness!)} stock${ease.face === 'both' ? ' eased from both faces' : ''}`,
            );
            return;
        }
        add({
            type: 'ease',
            edge,
            ...(ease.profile === 'roundover'
                ? { profile: 'roundover' as const, radius: size }
                : { profile: 'chamfer' as const, width: size }),
            ...(ease.face === 'both' ? {} : { face: ease.face as 'front' | 'back' }),
            ...extent,
        } as Op);
    }

    function notchAround(insertPartId: string): void {
        setFormError(null);
        const c = dim0('Clearance', clearance);
        if (c !== null) p.onNotchAround(insertPartId, c);
    }

    const hasOps = (part.ops ?? []).length > 0;
    const pinRuns = shelfPinRuns(part.ops ?? []);

    // --- Copies: a run of this part along an axis ---
    const [copiesOpen, setCopiesOpen] = useState(false);
    const [copiesError, setCopiesError] = useState<string | null>(null);
    const [copies, setCopies] = useState({ count: '3', axis: '1', gap: lenValue(2) });
    useEffect(() => setCopiesOpen(false), [part.id]);

    function submitCopies(): void {
        setCopiesError(null);
        const count = Math.round(Number(copies.count));
        if (!Number.isFinite(count) || count < 1 || count > 50) {
            setCopiesError('How many must be a whole number from 1 to 50');
            return;
        }
        const gap = parseLen(copies.gap.trim());
        if (gap === null || gap < 0 || gap > 240) {
            setCopiesError('Gap needs a dimension of 0 or more (e.g. 2 1/2)');
            return;
        }
        p.onCopies(count, Number(copies.axis) as 0 | 1 | 2, gap);
        setCopiesOpen(false);
    }
    const placeTitle = p.canPlace
        ? 'Click a face in the 3D view to position it'
        : 'Reassemble (leave the exploded view) to place cuts';

    return (
        <div data-testid="properties">
            <div className="mb-1 flex items-center justify-between gap-2">
                {renaming ? (
                    <input
                        ref={nameInput}
                        value={nameDraft}
                        maxLength={80}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenaming(false);
                        }}
                        onBlur={commitRename}
                        className="bg-surface-2 focus:border-accent border-fg/10 h-8 min-w-0 flex-1 rounded-lg border px-2 text-[15px] font-semibold focus:outline-none"
                        data-testid="rename-input"
                    />
                ) : (
                    <button
                        className="hover:border-accent/50 -mx-1 min-w-0 truncate rounded border border-transparent px-1 text-left text-[15px] font-semibold"
                        data-testid="rename-start"
                        title="Click to rename this part"
                        onClick={() => {
                            setNameDraft(part.name);
                            setRenaming(true);
                        }}
                    >
                        {part.name}
                    </button>
                )}
                <button
                    className={`flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        part.locked
                            ? 'bg-accent/15 text-accent'
                            : 'text-faint hover:text-fg-strong hover:bg-fg/5'
                    }`}
                    aria-pressed={part.locked}
                    aria-label={part.locked ? `Unlock ${part.name}` : `Lock ${part.name}`}
                    title={
                        part.locked
                            ? 'Locked: adjusted by hand, so AI agents leave it exactly as it is. Click to let them change it.'
                            : 'Lock it, so AI agents leave this part exactly as it is'
                    }
                    data-testid="part-lock"
                    onClick={() => p.onSetLocked(!part.locked)}
                >
                    {part.locked ? (
                        <>
                            <Lock size={12} aria-hidden="true" />
                            locked
                        </>
                    ) : (
                        <LockOpen size={13} aria-hidden="true" />
                    )}
                </button>
            </div>
            <div className="text-muted mb-3 text-xs">{p.materialName}</div>

            <div className="mb-4 grid grid-cols-2 gap-2.5">
                <Field label="Wood species">
                    <Select
                        h="md"
                        value={p.species ?? ''}
                        data-testid="species-select"
                        onChange={(e) => e.target.value !== '' && p.onSpecies(e.target.value as Species)}
                    >
                        <option value="" disabled>
                            — pick a species —
                        </option>
                        {SPECIES_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                                {s.label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="Stock">
                    <Select
                        h="md"
                        value={p.dowel ?? p.nominal ?? ''}
                        data-testid="stock-select"
                        onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') return;
                            // One picker, two piles of stock: a dowel label routes to round stock.
                            if (dowelSizeOf(value) !== undefined) p.onRoundStock(value);
                            else p.onStock(value);
                        }}
                    >
                        <option value="" disabled>
                            — custom —
                        </option>
                        {/* The stock of the system being worked in comes first; the other stays reachable. */}
                        {stockGroups().map((g) => (
                            <Fragment key={g.lumberLabel}>
                                <optgroup label={g.lumberLabel}>
                                    {g.lumber.map((s) => (
                                        <option key={s.nominal} value={s.nominal}>
                                            {s.metric
                                                ? s.nominal
                                                : `${s.nominal} (${len(s.thickness)} × ${len(s.width)})`}
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label={g.dowelLabel} disabled={hasOps}>
                                    {g.dowels.map((d) => (
                                        <option key={d.label} value={d.label}>
                                            {d.label} dowel
                                        </option>
                                    ))}
                                </optgroup>
                            </Fragment>
                        ))}
                    </Select>
                </Field>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2.5">
                <Field label={`Length (${unitSuffix()})`}>
                    <TextInput
                        h="md"
                        value={lInput}
                        data-testid="length"
                        inputMode="decimal"
                        onChange={(e) => setLInput(e.target.value)}
                        onBlur={commitResize}
                        onKeyDown={onEnter(commitResize)}
                    />
                </Field>
                <Field label={`Width (${unitSuffix()})`}>
                    <TextInput
                        h="md"
                        value={wInput}
                        data-testid="width"
                        inputMode="decimal"
                        onChange={(e) => setWInput(e.target.value)}
                        onBlur={commitResize}
                        onKeyDown={onEnter(commitResize)}
                    />
                </Field>
            </div>

            <div className="text-muted mb-4 flex items-center justify-between text-xs">
                <span>Thickness {p.thickness === null ? '—' : `${len(p.thickness)}`}</span>
                <label className="flex items-center gap-2">
                    <span>Grain</span>
                    <select
                        value={part.grainAxis ?? 'l'}
                        className="bg-surface-2 focus:border-accent border-fg/10 rounded border px-1 py-0.5 outline-none"
                        onChange={(e) => p.onGrainAxis(e.target.value as 'l' | 'w' | 'none')}
                    >
                        <option value="l">Length</option>
                        <option value="w">Width</option>
                        <option value="none">None</option>
                    </select>
                </label>
            </div>

            <button
                className="border-fg/10 text-muted hover:bg-fg/5 mb-3 h-9 w-full rounded-lg border text-[12px]"
                data-testid="hide-part"
                title="Hide this part in the 3D view (H). It is still cut and still built."
                onClick={p.onHide}
            >
                Hide from view
            </button>

            <Section id="position" title="Position">
                <div className="mb-1.5 grid grid-cols-3 gap-2">
                    {AXIS_LABELS.map((label, i) => {
                        const axis = i as Axis3;
                        return (
                            <Field key={label} label={`${label} (${unitSuffix()})`}>
                                <TextInput
                                    h="md"
                                    value={posInputs[axis]}
                                    aria-label={`Position ${label} in ${unitSuffix() === 'mm' ? 'millimetres' : 'inches'}`}
                                    data-testid={`pos-input-${axis}`}
                                    onChange={(e) => setPosInputs(setAt(posInputs, axis, e.target.value))}
                                    onBlur={() => commitPosition(axis)}
                                    onKeyDown={onEnter(() => commitPosition(axis))}
                                />
                            </Field>
                        );
                    })}
                </div>
                <p className="text-muted mb-4 text-xs">Centre of the part. Y is height; negatives allowed.</p>
            </Section>

            <Section id="orientation" title="Orientation">
                <div className="mb-2 grid grid-cols-3 gap-2">
                    {ROTATIONS.map((r) => (
                        <button
                            key={r.axis}
                            className="border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs"
                            data-testid={`rot-90-${r.axis}`}
                            title={`${r.hint}: a quarter turn`}
                            onClick={() => p.onRotate(r.axis)}
                        >
                            {r.label} 90°
                        </button>
                    ))}
                </div>
                <div className="mb-2.5 grid grid-cols-3 gap-2">
                    {ROTATIONS.map((r) => (
                        <div key={r.axis} className="flex items-center gap-1">
                            <button
                                className="border-fg/10 text-muted hover:bg-fg/5 h-8 w-7 flex-none rounded-lg border text-xs"
                                data-testid={`rot-minus-${r.axis}`}
                                title={`${r.label} back 15°`}
                                onClick={() => p.onRotateBy(r.axis, -15)}
                            >
                                −
                            </button>
                            <input
                                value={rotInputs[r.axis]}
                                inputMode="decimal"
                                className="bg-surface-2 border-fg/10 h-8 w-full min-w-0 rounded-lg border px-1 text-center text-xs"
                                aria-label={`${r.label}, degrees`}
                                title={r.hint}
                                data-testid={`rot-input-${r.axis}`}
                                onChange={(e) => setRotInputs(setAt(rotInputs, r.axis, e.target.value))}
                                onBlur={() => commitRotation(r.axis)}
                                onKeyDown={onEnter(() => commitRotation(r.axis))}
                            />
                            <button
                                className="border-fg/10 text-muted hover:bg-fg/5 h-8 w-7 flex-none rounded-lg border text-xs"
                                data-testid={`rot-plus-${r.axis}`}
                                title={`${r.label} on 15°`}
                                onClick={() => p.onRotateBy(r.axis, 15)}
                            >
                                +
                            </button>
                        </div>
                    ))}
                </div>
            </Section>

            <Section id="movable" title="Door or drawer">
                {p.movable === null ? (
                    <div className="mb-4" data-testid="movable-none">
                        <p className="text-muted mb-2 text-xs">
                            Turn this part into a door or a drawer. Use Open in the toolbar to see it move.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {(['door', 'drawer'] as const).map((kind) => (
                                <button
                                    key={kind}
                                    className="hover:border-accent/60 border-fg/15 text-fg/65 h-9 rounded-lg border border-dashed text-xs"
                                    data-testid={`make-${kind}`}
                                    onClick={() => p.onMakeMovable(kind)}
                                >
                                    Make a {kind}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="bg-surface-2/60 mb-4 rounded-lg p-2.5" data-testid="movable-panel">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-fg/80 text-[13px] font-semibold" data-testid="movable-kind">
                                {p.movable.kind === 'door' ? 'Door' : 'Drawer'}
                                <span className="text-muted text-xs font-normal">
                                    {' '}
                                    · {p.movable.partIds.length}{' '}
                                    {p.movable.partIds.length === 1 ? 'part' : 'parts'}
                                </span>
                            </span>
                            <button
                                className="text-muted hover:text-danger-fg text-xs"
                                data-testid="movable-dissolve"
                                onClick={p.onDissolveMovable}
                            >
                                Dissolve
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Style">
                                <Select
                                    value={p.movable.style}
                                    data-testid="movable-style"
                                    onChange={(e) => p.onUpdateMovable({ style: e.target.value })}
                                >
                                    <option value="overlay">overlay</option>
                                    <option value="inset">inset</option>
                                </Select>
                            </Field>
                            {p.movable.kind === 'door' && (
                                <Field label="Hinges on">
                                    <Select
                                        value={p.movable.hingeEdge}
                                        data-testid="movable-hinge-edge"
                                        onChange={(e) => p.onUpdateMovable({ hingeEdge: e.target.value })}
                                    >
                                        {EDGE_LABELS.map((e) => (
                                            <option key={e.value} value={e.value}>
                                                {e.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            )}
                        </div>
                        <MovableFittings movable={p.movable} onChange={p.onUpdateMovable} />
                    </div>
                )}
            </Section>

            <Section id="hardware" title="Hardware">
                <PartHardware
                    part={p.part}
                    thickness={p.thickness ?? 0.75}
                    mounts={p.hardware}
                    onAdd={p.onAddHardware}
                    onUpdate={p.onUpdateHardware}
                    onRemove={p.onRemoveHardware}
                    selectedId={p.selectedHardwareId}
                    onSelect={p.onSelectHardware}
                />
            </Section>

            {p.sheet && (
                <Section id="banding" title="Edge banding">
                    <div className="mb-1.5 grid grid-cols-2 gap-1.5" data-testid="edge-band">
                        {EDGE_LABELS.map(({ value, label }) => {
                            const on = (part.edgeBand ?? []).includes(value);
                            return (
                                <button
                                    key={value}
                                    role="checkbox"
                                    aria-checked={on}
                                    className={`h-8 rounded-lg border text-xs ${on ? 'border-accent bg-accent/10 text-accent font-semibold' : 'border-fg/10 text-fg/70 hover:bg-fg/5'}`}
                                    data-testid={`edge-band-${value}`}
                                    onClick={() => {
                                        const edges = part.edgeBand ?? [];
                                        p.onEdgeBand(
                                            on
                                                ? edges.filter((e) => e !== value)
                                                : EDGE_LABELS.map((x) => x.value).filter(
                                                      (e) => e === value || edges.includes(e),
                                                  ),
                                        );
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-muted mb-2.5 text-xs">
                        Edges to cover. The cut list adds up the banding to buy.
                    </p>
                </Section>
            )}

            <Section id="cuts" title="Cuts &amp; fasteners">
                {hasOps && (
                    <div className="mb-2.5 flex flex-col gap-1" data-testid="ops-list">
                        {part.ops.map((op, i) => {
                            const run = pinRuns.find((r) => i >= r.start && i < r.start + r.count);
                            if (run !== undefined) {
                                if (run.start !== i) return null;
                                const hardware = (op as { purpose?: string }).purpose === 'hardware';
                                const label = `${hardware ? 'Hardware holes' : 'Shelf-pin holes'} ×${run.count}, ${len((op as { diameter: number }).diameter)}`;
                                const active = editingRun?.start === run.start;
                                return (
                                    <div
                                        key={i}
                                        className={`bg-surface-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${active ? 'ring-accent ring-1' : ''}`}
                                        data-testid="ops-row"
                                        data-editing={active || undefined}
                                    >
                                        <span className="text-faint flex-none" aria-hidden="true">
                                            <OpIcon type="shelfPins" />
                                        </span>
                                        <button
                                            className="text-fg/80 hover:text-fg-strong min-w-0 flex-1 text-left text-xs leading-snug"
                                            title="Change these holes"
                                            aria-label={`Change these holes: ${label}`}
                                            onClick={() =>
                                                active
                                                    ? (setEditingRun(null), setOpenForm(null))
                                                    : startEditRun(run)
                                            }
                                            data-testid="pins-edit"
                                        >
                                            {label}
                                        </button>
                                        <button
                                            className="text-muted hover:bg-danger/15 hover:text-danger-fg flex-none rounded px-1.5 py-0.5 text-xs"
                                            data-testid="pins-delete"
                                            title="Delete these holes"
                                            aria-label="Delete these holes"
                                            onClick={() => {
                                                if (active) {
                                                    setEditingRun(null);
                                                    setOpenForm(null);
                                                }
                                                p.onSpliceOps(
                                                    run.start,
                                                    run.count,
                                                    [],
                                                    hardware
                                                        ? 'Remove hardware holes'
                                                        : 'Remove shelf-pin holes',
                                                );
                                            }}
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                );
                            }
                            return (
                                <div
                                    key={i}
                                    className={`bg-surface-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${editing === i ? 'ring-accent ring-1' : ''}`}
                                    data-testid="ops-row"
                                    data-editing={editing === i || undefined}
                                >
                                    <span className="text-faint flex-none" aria-hidden="true">
                                        <OpIcon type={op.type} />
                                    </span>
                                    {editFormOf(op) === null ? (
                                        <span
                                            className="text-fg/80 min-w-0 flex-1 text-xs leading-snug"
                                            title={opSummary(op)}
                                        >
                                            {opSummary(op)}
                                        </span>
                                    ) : (
                                        <button
                                            className="text-fg/80 hover:text-fg-strong min-w-0 flex-1 text-left text-xs leading-snug"
                                            title="Change this cut"
                                            aria-label={`Change this cut: ${opSummary(op)}`}
                                            onClick={() =>
                                                editing === i
                                                    ? (setEditing(null), setOpenForm(null))
                                                    : startEdit(i)
                                            }
                                            data-testid={`ops-edit-${i}`}
                                        >
                                            {opSummary(op)}
                                        </button>
                                    )}
                                    <button
                                        className="text-muted hover:bg-danger/15 hover:text-danger-fg flex-none rounded px-1.5 py-0.5 text-xs"
                                        data-testid={`ops-delete-${i}`}
                                        title="Delete this cut"
                                        aria-label="Delete this cut"
                                        onClick={() => p.onRemoveOp(i)}
                                    >
                                        <X size={14} aria-hidden="true" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {p.round ? (
                    <p
                        className="border-fg/10 text-muted mb-2.5 rounded-lg border border-dashed px-2.5 py-2 text-xs"
                        data-testid="round-no-ops"
                    >
                        Dowel stock takes no dados, holes or edges — cut features on square stock.
                    </p>
                ) : (
                    <div className="mb-2.5">
                        <Popover
                            align="left"
                            panelClassName="flex w-64 flex-col gap-px p-1.5"
                            trigger={({ open, toggle }) => (
                                <button
                                    className={`border-fg/15 text-fg/75 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs ${open || openForm !== null ? 'border-accent text-accent' : 'hover:border-accent/60'}`}
                                    aria-expanded={open}
                                    onClick={toggle}
                                    data-testid="ops-add-menu"
                                >
                                    {openForm === null
                                        ? '+ Add a cut'
                                        : `${editing === null && editingRun === null ? 'Adding' : 'Changing'}: ${OP_BUTTONS.find((b) => b.form === openForm)?.label}`}
                                </button>
                            )}
                        >
                            {(close) =>
                                OP_BUTTONS.map((b) => (
                                    <button
                                        key={b.form}
                                        className={`hover:bg-fg/[0.07] flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left ${openForm === b.form ? 'bg-fg/[0.07]' : ''}`}
                                        data-testid={`ops-add-${b.form}`}
                                        onClick={() => {
                                            close();
                                            toggleForm(b.form);
                                        }}
                                    >
                                        <span className="text-muted mt-px flex-none" aria-hidden="true">
                                            <OpIcon type={b.icon} />
                                        </span>
                                        <span>
                                            <span className="block text-[13px] font-medium">{b.label}</span>
                                            <span className="text-muted block text-xs">{b.does}</span>
                                        </span>
                                    </button>
                                ))
                            }
                        </Popover>
                    </div>
                )}

                {openForm === 'pocket' && (
                    <FormBox testId="pocket-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <EdgeField
                                value={pocket.edge}
                                testId="pocket-edge"
                                onChange={(edge) => setPocket({ ...pocket, edge })}
                            />
                            <Field label="Screws">
                                <TextInput
                                    value={pocket.count}
                                    inputMode="numeric"
                                    data-testid="pocket-count"
                                    onChange={(e) => setPocket({ ...pocket, count: e.target.value })}
                                />
                            </Field>
                        </div>
                        <Hint>
                            Marker only — pocket screws through this edge into the mating part. Butt the edge
                            against a part and the joint is recorded automatically.
                        </Hint>
                        <div className="grid grid-cols-2 gap-2">
                            <PrimaryButton
                                className={editing === null ? undefined : 'col-span-2'}
                                data-testid="pocket-submit"
                                onClick={() => {
                                    setFormError(null);
                                    const count = pocketCount();
                                    if (count !== null)
                                        add({ type: 'pocketHoles', edge: pocket.edge as Edge, count });
                                }}
                            >
                                {editing === null ? 'Add pocket holes' : 'Save changes'}
                            </PrimaryButton>
                            <SecondaryButton
                                hidden={editing !== null}
                                disabled={!p.canPlace}
                                title={
                                    p.canPlace ? 'Point at the part near an edge to place them' : placeTitle
                                }
                                data-testid="pocket-place"
                                onClick={() => {
                                    setFormError(null);
                                    const count = pocketCount();
                                    if (count !== null) {
                                        p.onPlaceOp({ kind: 'pocket', count });
                                        setOpenForm(null);
                                    }
                                }}
                            >
                                Place in 3D
                            </SecondaryButton>
                        </div>
                    </FormBox>
                )}

                {openForm === 'pins' && (
                    <FormBox testId="pins-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <Field label="Holes for">
                                <Select
                                    value={pins.purpose}
                                    data-testid="pins-purpose"
                                    onChange={(e) => {
                                        const purpose = e.target.value as RowPurpose;
                                        // Hinge plates and slides screw to the front column.
                                        const front = frontColumn(part, pins.axis as 'l' | 'w');
                                        const columns: RowColumns =
                                            purpose === 'hardware' ? (front ?? 'both') : 'both';
                                        setPins({ ...pins, purpose, columns });
                                    }}
                                >
                                    <option value="shelfPin">Shelf pins</option>
                                    <option value="hardware">Hinge plates &amp; slides</option>
                                </Select>
                            </Field>
                            <Field label="Columns">
                                <Select
                                    value={pins.columns}
                                    data-testid="pins-columns"
                                    onChange={(e) =>
                                        setPins({ ...pins, columns: e.target.value as RowColumns })
                                    }
                                >
                                    {columnChoices(part, pins.axis as 'l' | 'w').map((c) => (
                                        <option key={c.value} value={c.value}>
                                            {c.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <FaceField value={pins.face} onChange={(face) => setPins({ ...pins, face })} />
                            <Field label="Columns run">
                                <Select
                                    value={pins.axis}
                                    data-testid="pins-axis"
                                    onChange={(e) => setPins({ ...pins, axis: e.target.value })}
                                >
                                    <option value="l">along the length</option>
                                    <option value="w">across the width</option>
                                </Select>
                            </Field>
                        </div>
                        <div className="mb-2 grid grid-cols-3 gap-2">
                            <Field label={`First hole (${unitSuffix()})`}>
                                <TextInput
                                    value={pins.from}
                                    inputMode="decimal"
                                    data-testid="pins-from"
                                    onChange={(e) => setPins({ ...pins, from: e.target.value })}
                                />
                            </Field>
                            <Field label={`Up to (${unitSuffix()})`}>
                                <TextInput
                                    value={pins.to}
                                    inputMode="decimal"
                                    data-testid="pins-to"
                                    onChange={(e) => setPins({ ...pins, to: e.target.value })}
                                />
                            </Field>
                            <Field label={`Spacing (${unitSuffix()})`}>
                                <TextInput
                                    value={pins.spacing}
                                    inputMode="decimal"
                                    data-testid="pins-spacing"
                                    onChange={(e) => setPins({ ...pins, spacing: e.target.value })}
                                />
                            </Field>
                        </div>
                        <div className="mb-2 grid grid-cols-3 gap-2">
                            <Field label={`Edge inset (${unitSuffix()})`}>
                                <TextInput
                                    value={pins.inset}
                                    inputMode="decimal"
                                    data-testid="pins-inset"
                                    onChange={(e) => setPins({ ...pins, inset: e.target.value })}
                                />
                            </Field>
                            <Field label={`Diameter (${unitSuffix()})`}>
                                <TextInput
                                    value={pins.diameter}
                                    inputMode="decimal"
                                    data-testid="pins-diameter"
                                    onChange={(e) => setPins({ ...pins, diameter: e.target.value })}
                                />
                            </Field>
                            <Field label={`Depth (${unitSuffix()})`}>
                                <TextInput
                                    value={pins.depth}
                                    inputMode="decimal"
                                    data-testid="pins-depth"
                                    onChange={(e) => setPins({ ...pins, depth: e.target.value })}
                                />
                            </Field>
                        </div>
                        <Hint>
                            Columns of holes, each the inset from an edge, from the first hole to the last
                            that fits. 32 mm spacing and 37 mm inset match most shelf-pin jigs and the
                            mounting plates of cup hinges and drawer slides. Drill on the face that looks into
                            the case.
                        </Hint>
                        <PrimaryButton className="w-full" data-testid="pins-submit" onClick={submitPins}>
                            {editingRun !== null
                                ? 'Save changes'
                                : pins.purpose === 'hardware'
                                  ? 'Add hardware holes'
                                  : 'Add shelf-pin holes'}
                        </PrimaryButton>
                    </FormBox>
                )}

                {openForm === 'rabbet' && (
                    <FormBox testId="rabbet-form">
                        <div className="mb-2 grid grid-cols-3 gap-2">
                            <EdgeField
                                value={rabbet.edge}
                                testId="rabbet-edge"
                                onChange={(edge) => setRabbet({ ...rabbet, edge })}
                            />
                            <Field label={`Width (${unitSuffix()})`}>
                                <TextInput
                                    value={rabbet.width}
                                    data-testid="rabbet-width"
                                    onChange={(e) => setRabbet({ ...rabbet, width: e.target.value })}
                                />
                            </Field>
                            <Field label={`Depth (${unitSuffix()})`}>
                                <TextInput
                                    value={rabbet.depth}
                                    data-testid="rabbet-depth"
                                    onChange={(e) => setRabbet({ ...rabbet, depth: e.target.value })}
                                />
                            </Field>
                        </div>
                        <Hint>
                            A step cut from the front face along this edge: Width is how far in from the edge
                            (the thickness of the panel that sits in it), Depth how far down. Set a back panel
                            into it and the joint is recorded.
                        </Hint>
                        <PrimaryButton className="w-full" data-testid="rabbet-submit" onClick={submitRabbet}>
                            {editing === null ? 'Add rabbet' : 'Save changes'}
                        </PrimaryButton>
                    </FormBox>
                )}

                {openForm === 'miter' && (
                    <FormBox testId="miter-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <EdgeField
                                value={miter.edge}
                                testId="miter-edge"
                                onChange={(edge) => setMiter({ ...miter, edge })}
                            />
                            <Field label="Angle (°)">
                                <TextInput
                                    value={miter.angle}
                                    inputMode="decimal"
                                    data-testid="miter-angle"
                                    onChange={(e) => setMiter({ ...miter, angle: e.target.value })}
                                />
                            </Field>
                        </div>
                        <Hint>
                            Bevels this edge off square (up to 60°), cut from the back face — how an inclined
                            backrest meets the seat flush.
                        </Hint>
                        <PrimaryButton className="w-full" data-testid="miter-submit" onClick={submitMiter}>
                            {editing === null ? 'Add miter' : 'Save changes'}
                        </PrimaryButton>
                    </FormBox>
                )}

                {openForm === 'ease' && (
                    <FormBox testId="ease-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <EdgeField
                                value={ease.edge}
                                testId="ease-edge"
                                onChange={(edge) => setEase({ ...ease, edge })}
                            />
                            <Field label="Profile">
                                <Select
                                    value={ease.profile}
                                    data-testid="ease-profile"
                                    onChange={(e) => setEase({ ...ease, profile: e.target.value })}
                                >
                                    <option value="roundover">roundover</option>
                                    <option value="chamfer">chamfer</option>
                                    <option value="bullnose">bullnose (half-round)</option>
                                </Select>
                            </Field>
                        </div>
                        {ease.profile !== 'bullnose' && (
                            <div className="mb-2 grid grid-cols-2 gap-2">
                                <Field label={ease.profile === 'roundover' ? 'Radius' : 'Width'}>
                                    <TextInput
                                        value={ease.size}
                                        placeholder="1/4"
                                        data-testid="ease-size"
                                        onChange={(e) => setEase({ ...ease, size: e.target.value })}
                                    />
                                </Field>
                                <Field label="Faces">
                                    <Select
                                        value={ease.face}
                                        data-testid="ease-face"
                                        onChange={(e) => setEase({ ...ease, face: e.target.value })}
                                    >
                                        <option value="both">both (one pass each side)</option>
                                        <option value="front">front only</option>
                                        <option value="back">back only</option>
                                    </Select>
                                </Field>
                            </div>
                        )}
                        <Checkbox checked={easeStopped} onChange={setEaseStopped} testId="ease-stopped">
                            stopped run (from / to)
                        </Checkbox>
                        {easeStopped && <RunFields value={easeRun} onChange={setEaseRun} testPrefix="ease" />}
                        <Hint>
                            {ease.profile === 'bullnose'
                                ? 'Rounds the whole edge to a half-circle of the stock thickness — the bit size follows the board.'
                                : 'Softens the sharp corner where this edge meets the face. The blank stays the same size: rout after cutting.'}
                        </Hint>
                        <PrimaryButton className="w-full" data-testid="ease-submit" onClick={submitEase}>
                            {editing === null ? 'Add soft edge' : 'Save changes'}
                        </PrimaryButton>
                    </FormBox>
                )}

                {p.touching.length > 0 && (
                    <div className="mb-3" data-testid="dowel-list">
                        <SectionLabel>Fasten to</SectionLabel>
                        <div className="flex flex-col gap-1.5">
                            {p.touching.map((t) => (
                                <div key={t.partId} className="bg-surface-2 rounded-lg px-2.5 py-2">
                                    <span className="text-fg/75 mb-1.5 block min-w-0 truncate text-xs">
                                        {t.name}
                                    </span>
                                    <div className="flex flex-wrap gap-1.5">
                                        <MateButton
                                            testId={`fasten-pocket-${t.partId}`}
                                            onClick={() => p.onFastenTo(t.partId, 'pocket')}
                                        >
                                            Pocket screws
                                        </MateButton>
                                        <MateButton
                                            testId={`fasten-screws-${t.partId}`}
                                            onClick={() => p.onFastenTo(t.partId, 'screws')}
                                        >
                                            Screws
                                        </MateButton>
                                        <MateButton
                                            testId={`dowel-add-${t.partId}`}
                                            onClick={() => p.onDowelTo(t.partId)}
                                        >
                                            Dowels
                                        </MateButton>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {openForm === 'notch' && (
                    <FormBox testId="notch-form">
                        <EdgeField
                            className="mb-2"
                            value={notch.edge}
                            testId="notch-edge"
                            onChange={(edge) => setNotch({ ...notch, edge })}
                        />
                        <div className="mb-2 grid grid-cols-3 gap-2">
                            <Field label={`From (${unitSuffix()})`}>
                                <TextInput
                                    value={notch.from}
                                    inputMode="decimal"
                                    data-testid="notch-from"
                                    onChange={(e) => setNotch({ ...notch, from: e.target.value })}
                                />
                            </Field>
                            <Field label={`To (${unitSuffix()})`}>
                                <TextInput
                                    value={notch.to}
                                    inputMode="decimal"
                                    placeholder="e.g. 3 1/2"
                                    data-testid="notch-to"
                                    onChange={(e) => setNotch({ ...notch, to: e.target.value })}
                                />
                            </Field>
                            <Field label={`Depth (${unitSuffix()})`}>
                                <TextInput
                                    value={notch.depth}
                                    inputMode="decimal"
                                    data-testid="notch-depth"
                                    onChange={(e) => setNotch({ ...notch, depth: e.target.value })}
                                />
                            </Field>
                        </div>
                        <Hint>From/To run along the edge from its low end; From 0 notches the corner.</Hint>
                        <PrimaryButton className="w-full" data-testid="notch-submit" onClick={submitNotch}>
                            {editing === null ? 'Add notch' : 'Save changes'}
                        </PrimaryButton>
                    </FormBox>
                )}

                {p.overlaps.length > 0 && (
                    <div className="mb-3" data-testid="overlap-list">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-muted text-xs font-semibold tracking-wider uppercase">
                                Overlapping parts
                            </span>
                            <label className="text-muted flex items-center gap-1.5 text-xs">
                                clearance
                                <input
                                    value={clearance}
                                    inputMode="decimal"
                                    onChange={(e) => setClearance(e.target.value)}
                                    className="bg-surface-2 focus:border-accent border-fg/10 h-7 w-14 rounded-lg border px-2 text-center text-xs focus:outline-none"
                                    data-testid="notch-clearance"
                                />
                            </label>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {p.overlaps.map((o) => (
                                <div
                                    key={o.partId}
                                    className="bg-surface-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                                >
                                    <span className="text-fg/75 min-w-0 truncate text-xs">{o.name}</span>
                                    <div className="flex flex-none items-center gap-1.5">
                                        <MateButton
                                            testId={`overlap-push-${o.partId}`}
                                            onClick={() => p.onPushOut(o.partId)}
                                        >
                                            Push out
                                        </MateButton>
                                        <MateButton
                                            testId={`overlap-notch-${o.partId}`}
                                            onClick={() => notchAround(o.partId)}
                                        >
                                            Notch around
                                        </MateButton>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {openForm === 'curve' && (
                    <FormBox testId="curve-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <EdgeField
                                value={curve.edge}
                                testId="curve-edge"
                                onChange={(edge) => updateCurve({ edge })}
                            />
                            <Field label="Shape">
                                <Select
                                    value={curve.kind}
                                    data-testid="curve-kind"
                                    onChange={(e) => updateCurve({ kind: e.target.value })}
                                >
                                    <option value="arc">arc / dome</option>
                                    <option value="round">rounded corners</option>
                                    <option value="ramp">one-sided sweep</option>
                                    <option value="taper">straight taper / angled end</option>
                                    <option value="clip">dog ear (45° off a corner)</option>
                                </Select>
                            </Field>
                        </div>
                        {curve.kind !== 'arc' && (
                            <Field
                                className="mb-2"
                                label={
                                    curve.kind === 'ramp'
                                        ? 'Sweeps down toward'
                                        : curve.kind === 'taper'
                                          ? 'Corner that moves in'
                                          : 'Which corner'
                                }
                            >
                                <Select
                                    value={curve.end}
                                    data-testid="curve-end"
                                    onChange={(e) => updateCurve({ end: e.target.value })}
                                >
                                    {(curve.kind === 'round' || curve.kind === 'clip') && (
                                        <option value="both">both corners</option>
                                    )}
                                    {endsOf(curve.edge).map((e) => (
                                        <option key={e.value} value={e.value}>
                                            {e.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )}
                        <Field
                            className="mb-2"
                            label={
                                curve.kind === 'arc'
                                    ? `Height (${unitSuffix()}) — how far the corners drop`
                                    : curve.kind === 'ramp'
                                      ? `Height (${unitSuffix()}) — how far the low end drops`
                                      : curve.kind === 'taper'
                                        ? `Height (${unitSuffix()}) — how far that corner moves in`
                                        : curve.kind === 'clip'
                                          ? `Size (${unitSuffix()}) — along each edge`
                                          : `Corner radius (${unitSuffix()})`
                            }
                        >
                            <TextInput
                                value={curve.size}
                                inputMode="decimal"
                                placeholder="e.g. 4"
                                data-testid="curve-size"
                                onChange={(e) => updateCurve({ size: e.target.value })}
                            />
                        </Field>
                        {curve.kind === 'taper' && (
                            <Field
                                className="mb-2"
                                label={`Straight for (${unitSuffix()}) — optional, from the full-size end`}
                            >
                                <TextInput
                                    value={curve.from}
                                    inputMode="decimal"
                                    placeholder="e.g. 4 for a leg below its apron"
                                    data-testid="curve-from"
                                    onChange={(e) => updateCurve({ from: e.target.value })}
                                />
                            </Field>
                        )}
                        {curve.kind === 'taper' && (
                            <TaperAngle
                                height={parseLen(curve.size.trim())}
                                along={
                                    (curve.edge.startsWith('l') ? part.size.l : part.size.w) -
                                    (parseLen(curve.from.trim()) ?? 0)
                                }
                            />
                        )}
                        <PrimaryButton className="w-full" data-testid="curve-submit" onClick={submitCurve}>
                            {editing === null ? 'Add curve' : 'Save changes'}
                        </PrimaryButton>
                    </FormBox>
                )}

                {openForm === 'dado' && (
                    <FormBox testId="dado-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <FaceField value={dado.face} onChange={(face) => setDado({ ...dado, face })} />
                            <Field label="Axis">
                                <Select
                                    value={dado.axis}
                                    data-testid="dado-axis"
                                    onChange={(e) => setDado({ ...dado, axis: e.target.value })}
                                >
                                    <option value="l">along length</option>
                                    <option value="w">along width</option>
                                </Select>
                            </Field>
                        </div>
                        <div className="mb-2 grid grid-cols-3 gap-2">
                            <Field label={`Offset (${unitSuffix()})`}>
                                <TextInput
                                    value={dado.offset}
                                    inputMode="decimal"
                                    placeholder="e.g. 17"
                                    data-testid="dado-offset"
                                    onChange={(e) => setDado({ ...dado, offset: e.target.value })}
                                />
                            </Field>
                            <Field label={`Width (${unitSuffix()})`}>
                                <TextInput
                                    value={dado.width}
                                    inputMode="decimal"
                                    data-testid="dado-width"
                                    onChange={(e) => setDado({ ...dado, width: e.target.value })}
                                />
                            </Field>
                            <Field label={`Depth (${unitSuffix()})`}>
                                <TextInput
                                    value={dado.depth}
                                    inputMode="decimal"
                                    data-testid="dado-depth"
                                    onChange={(e) => setDado({ ...dado, depth: e.target.value })}
                                />
                            </Field>
                        </div>
                        <Checkbox checked={stopped} onChange={setStopped}>
                            stopped channel (from / to)
                        </Checkbox>
                        {stopped && <RunFields value={dadoRun} onChange={setDadoRun} testPrefix="dado" />}
                        <div className="grid grid-cols-2 gap-2">
                            <PrimaryButton
                                className={editing === null ? undefined : 'col-span-2'}
                                data-testid="dado-submit"
                                onClick={submitDado}
                            >
                                {editing === null ? 'Add dado' : 'Save changes'}
                            </PrimaryButton>
                            <SecondaryButton
                                hidden={editing !== null}
                                disabled={!p.canPlace}
                                title={placeTitle}
                                data-testid="dado-place"
                                onClick={placeDado}
                            >
                                Place in 3D
                            </SecondaryButton>
                        </div>
                    </FormBox>
                )}

                {openForm === 'hole' && (
                    <FormBox testId="hole-form">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <FaceField value={hole.face} onChange={(face) => setHole({ ...hole, face })} />
                            <Field label="Purpose">
                                <Select
                                    value={hole.purpose}
                                    onChange={(e) => setHole({ ...hole, purpose: e.target.value })}
                                >
                                    <option value="dowel">dowel</option>
                                    <option value="shelfPin">shelf pin</option>
                                    <option value="hardware">hardware</option>
                                    <option value="other">other</option>
                                </Select>
                            </Field>
                        </div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <Field label="X (in, from left)">
                                <TextInput
                                    value={hole.x}
                                    inputMode="decimal"
                                    data-testid="hole-x"
                                    onChange={(e) => setHole({ ...hole, x: e.target.value })}
                                />
                            </Field>
                            <Field label="Y (in, from bottom)">
                                <TextInput
                                    value={hole.y}
                                    inputMode="decimal"
                                    data-testid="hole-y"
                                    onChange={(e) => setHole({ ...hole, y: e.target.value })}
                                />
                            </Field>
                        </div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                            <Field label={`Diameter (${unitSuffix()})`}>
                                <TextInput
                                    value={hole.diameter}
                                    inputMode="decimal"
                                    data-testid="hole-diameter"
                                    onChange={(e) => setHole({ ...hole, diameter: e.target.value })}
                                />
                            </Field>
                            <Field label="Depth (empty = through)">
                                <TextInput
                                    value={hole.depth}
                                    inputMode="decimal"
                                    placeholder="through"
                                    onChange={(e) => setHole({ ...hole, depth: e.target.value })}
                                />
                            </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <PrimaryButton
                                className={editing === null ? undefined : 'col-span-2'}
                                data-testid="hole-submit"
                                onClick={submitHole}
                            >
                                {editing === null ? 'Add hole' : 'Save changes'}
                            </PrimaryButton>
                            <SecondaryButton
                                hidden={editing !== null}
                                disabled={!p.canPlace}
                                title={placeTitle}
                                data-testid="hole-place"
                                onClick={placeHole}
                            >
                                Place in 3D
                            </SecondaryButton>
                        </div>
                    </FormBox>
                )}

                {formError && (
                    <p className="text-danger-fg mb-3 text-xs" data-testid="ops-error">
                        {formError}
                    </p>
                )}
            </Section>

            {copiesOpen && (
                <FormBox testId="copies-form">
                    <div className="mb-2 grid grid-cols-3 gap-2">
                        <Field label="How many">
                            <TextInput
                                value={copies.count}
                                inputMode="numeric"
                                data-testid="copies-count"
                                onChange={(e) => setCopies({ ...copies, count: e.target.value })}
                            />
                        </Field>
                        <Field label="Direction">
                            <Select
                                value={copies.axis}
                                data-testid="copies-axis"
                                onChange={(e) => setCopies({ ...copies, axis: e.target.value })}
                            >
                                <option value="1">Up</option>
                                <option value="0">Right</option>
                                <option value="2">Forward</option>
                            </Select>
                        </Field>
                        <Field label={`Gap (${unitSuffix()})`}>
                            <TextInput
                                value={copies.gap}
                                data-testid="copies-gap"
                                onChange={(e) => setCopies({ ...copies, gap: e.target.value })}
                            />
                        </Field>
                    </div>
                    <Hint>
                        Copies of this part in a row, each the gap away from the last, edge to edge. Select
                        the row afterwards and use Space evenly to fit it between two parts.
                    </Hint>
                    {copiesError && <p className="text-danger-fg mb-2 text-xs">{copiesError}</p>}
                    <PrimaryButton className="w-full" data-testid="copies-submit" onClick={submitCopies}>
                        Make copies
                    </PrimaryButton>
                </FormBox>
            )}
            <MirrorButtons className="mb-3" onMirror={p.onMirror} />
            <div className="grid grid-cols-3 gap-2">
                <button
                    className="border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs"
                    onClick={p.onDuplicate}
                >
                    Duplicate
                </button>
                <button
                    className={`border-fg/10 hover:bg-fg/5 h-9 rounded-lg border text-xs ${copiesOpen ? 'border-accent text-accent' : 'text-fg/75'}`}
                    aria-expanded={copiesOpen}
                    data-testid="copies-toggle"
                    onClick={() => {
                        setCopiesError(null);
                        setCopiesOpen(!copiesOpen);
                    }}
                >
                    Copies…
                </button>
                <button
                    className="border-danger/40 bg-danger/10 text-danger-fg hover:bg-danger/20 h-9 rounded-lg border text-xs"
                    data-testid="delete"
                    onClick={p.onRemove}
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

function FormBox({ testId, children }: { testId: string; children: React.ReactNode }) {
    return (
        <div className="bg-surface-2/60 mb-3 rounded-lg p-2.5" data-testid={testId}>
            {children}
        </div>
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return <p className="text-muted mb-2 text-xs">{children}</p>;
}

function EdgeField({
    value,
    onChange,
    testId,
    className,
}: {
    value: string;
    onChange: (edge: string) => void;
    testId: string;
    className?: string;
}) {
    return (
        <Field label="Edge" className={className}>
            <Select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)}>
                {EDGE_LABELS.map((e) => (
                    <option key={e.value} value={e.value}>
                        {e.label}
                    </option>
                ))}
            </Select>
        </Field>
    );
}

function FaceField({ value, onChange }: { value: string; onChange: (face: string) => void }) {
    return (
        <Field label="Face">
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="front">front</option>
                <option value="back">back</option>
            </Select>
        </Field>
    );
}

function Checkbox({
    checked,
    onChange,
    testId,
    children,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    testId?: string;
    children: React.ReactNode;
}) {
    return (
        <label className="text-muted mb-2 flex items-center gap-2 text-xs">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="accent-accent"
                data-testid={testId}
            />
            {children}
        </label>
    );
}

function RunFields({
    value,
    onChange,
    testPrefix,
}: {
    value: { from: string; to: string };
    onChange: (v: { from: string; to: string }) => void;
    testPrefix: string;
}) {
    return (
        <div className="mb-2 grid grid-cols-2 gap-2">
            <Field label={`From (${unitSuffix()})`}>
                <TextInput
                    value={value.from}
                    inputMode="decimal"
                    placeholder="0"
                    data-testid={`${testPrefix}-from`}
                    onChange={(e) => onChange({ ...value, from: e.target.value })}
                />
            </Field>
            <Field label={`To (${unitSuffix()})`}>
                <TextInput
                    value={value.to}
                    inputMode="decimal"
                    data-testid={`${testPrefix}-to`}
                    onChange={(e) => onChange({ ...value, to: e.target.value })}
                />
            </Field>
        </div>
    );
}

function MateButton({
    testId,
    onClick,
    children,
}: {
    testId: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            className="border-accent/40 text-accent hover:bg-accent/10 min-h-[30px] flex-1 rounded-lg border px-2 py-1 text-xs font-semibold"
            data-testid={testId}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
