/**
 * Selection-driven part editor (right dock "Inspector"). Purely presentational: every change is
 * reported through a callback and the workspace executes the Command.
 */
import { useEffect, useRef, useState } from 'react';
import type { HardwareMount, Movable, Op, Part, Species } from '@/spec';
import type { HardwarePatch, PlacementRequest } from '@/engine';
import { MovableFittings, PartHardware } from './HardwareFittings';
import { DEFAULT_EASE_CONFIG, WORKSPACE_POS_BOUND } from '@/engine';
import { formatFraction, parseFraction, parseSignedFraction } from '@/lib/fraction';
import { opSummary } from '@/spec/opLabel';
import { DOWEL_SIZES, LUMBER_SIZES, dowelSizeOf } from '@/lib/lumberSizes';
import { Field, PrimaryButton, SecondaryButton, SectionLabel, Select, TextInput, onEnter } from './form';

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
    onRemove(): void;
    onRename(name: string): void;
    onAddOp(op: Op): void;
    onRemoveOp(index: number): void;
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

const SPECIES_OPTIONS: { value: Species; label: string }[] = [
    { value: 'pine', label: 'Pine' },
    { value: 'oak', label: 'Oak' },
    { value: 'maple', label: 'Maple' },
    { value: 'walnut', label: 'Walnut' },
    { value: 'cherry', label: 'Cherry' },
];

const EDGE_LABELS: { value: Edge; label: string }[] = [
    { value: 'l1', label: 'top of face (l1)' },
    { value: 'l0', label: 'bottom of face (l0)' },
    { value: 'w0', label: 'left end (w0)' },
    { value: 'w1', label: 'right end (w1)' },
];

const AXIS_LABELS = ['X', 'Y', 'Z'] as const;
const ROTATIONS: { axis: Axis3; label: string }[] = [
    { axis: 0, label: 'Rot X' },
    { axis: 1, label: 'Rot Y' },
    { axis: 2, label: 'Rot Z' },
];

/** The two perpendicular edges adjoining `edge`, with picker-friendly labels. */
function endsOf(edge: string): { value: Edge; label: string }[] {
    return edge.startsWith('l')
        ? [
              { value: 'w0', label: 'left end (w0)' },
              { value: 'w1', label: 'right end (w1)' },
          ]
        : [
              { value: 'l0', label: 'bottom end (l0)' },
              { value: 'l1', label: 'top end (l1)' },
          ];
}

type OpForm = 'dado' | 'hole' | 'curve' | 'notch' | 'pocket' | 'miter' | 'ease';
const OP_BUTTONS: { form: OpForm; label: string }[] = [
    { form: 'dado', label: '+ Dado' },
    { form: 'hole', label: '+ Hole' },
    { form: 'curve', label: '+ Curve' },
    { form: 'notch', label: '+ Notch' },
    { form: 'pocket', label: '+ Pocket' },
    { form: 'miter', label: '+ Miter' },
    { form: 'ease', label: '+ Soft edge' },
];

const posText = (part: Part): [string, string, string] => [
    formatFraction(part.transform.pos[0]),
    formatFraction(part.transform.pos[1]),
    formatFraction(part.transform.pos[2]),
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
    const [lInput, setLInput] = useState(formatFraction(part.size.l));
    const [wInput, setWInput] = useState(formatFraction(part.size.w));
    const [posInputs, setPosInputs] = useState(posText(part));
    const [rotInputs, setRotInputs] = useState(rotText(part));

    useEffect(() => {
        setRenaming(false); // selection or part changed — drop any half-typed rename
        setLInput(formatFraction(part.size.l));
        setWInput(formatFraction(part.size.w));
        setPosInputs(posText(part));
        setRotInputs(rotText(part));
    }, [part]);

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
        return input.trim() === formatFraction(current) ? current : parseFraction(input);
    }

    function commitResize(): void {
        const l = typedDimension(lInput, part.size.l);
        const w = typedDimension(wInput, part.size.w);
        if (l === null || w === null || l <= 0 || w <= 0 || l > 240 || w > 240) {
            setLInput(formatFraction(part.size.l));
            setWInput(formatFraction(part.size.w));
            return;
        }
        if (l !== part.size.l || w !== part.size.w) p.onResize({ l, w });
    }

    function commitPosition(axis: Axis3): void {
        const text = posInputs[axis];
        const value = parseSignedFraction(text);
        const current = part.transform.pos;
        if (value === null || value < -WORKSPACE_POS_BOUND || value > WORKSPACE_POS_BOUND) {
            setPosInputs(posText(part));
            return;
        }
        // Unchanged text means the user did not ask for a move (the shown value is rounded).
        if (text.trim() === formatFraction(current[axis]) || value === current[axis]) return;
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
    const [formError, setFormError] = useState<string | null>(null);
    const [dado, setDado] = useState({ face: 'front', axis: 'l', offset: '', width: '3/4', depth: '' });
    const [stopped, setStopped] = useState(false);
    const [dadoRun, setDadoRun] = useState({ from: '', to: '' });
    const [hole, setHole] = useState({
        face: 'front',
        x: '',
        y: '',
        diameter: '1/4',
        depth: '',
        purpose: 'other',
    });
    const [curve, setCurve] = useState({ edge: 'l1', kind: 'arc', size: '', end: 'both' });
    const [notch, setNotch] = useState({ edge: 'l1', from: '0', to: '', depth: '' });
    const [clearance, setClearance] = useState('1/16');
    const [pocket, setPocket] = useState({ edge: 'w1', count: '2' });
    const [miter, setMiter] = useState({ edge: 'w1', angle: '15' });
    const [ease, setEase] = useState({
        edge: 'l1',
        profile: 'roundover',
        size: formatFraction(DEFAULT_EASE_CONFIG.defaultRadius),
        face: 'both',
    });
    const [easeStopped, setEaseStopped] = useState(false);
    const [easeRun, setEaseRun] = useState({ from: '', to: '' });

    // Keep the curve's end picker valid when the edge or kind changes (a ramp needs a real end).
    function updateCurve(patch: Partial<typeof curve>): void {
        setCurve((prev) => {
            const next = { ...prev, ...patch };
            const valid = endsOf(next.edge).some((e) => e.value === next.end);
            if (next.kind === 'ramp' && (next.end === 'both' || !valid))
                next.end = endsOf(next.edge)[0].value;
            else if (next.end !== 'both' && !valid) next.end = 'both';
            return next;
        });
    }

    function toggleForm(kind: OpForm): void {
        setFormError(null);
        const next = openForm === kind ? null : kind;
        setOpenForm(next);
        if (next === 'dado' && dado.depth === '' && p.thickness !== null) {
            setDado((d) => ({ ...d, depth: formatFraction(p.thickness! / 2) }));
        }
    }

    /** A required positive fraction; sets the shared error naming the field when invalid. */
    function dim(label: string, raw: string): number | null {
        const value = parseFraction(raw.trim());
        if (value === null || value <= 0 || value > 240) {
            setFormError(`${label} needs a positive dimension (e.g. 3 1/2)`);
            return null;
        }
        return value;
    }

    /** Like dim(), but 0 is legal (a notch `from: 0` is a corner notch). */
    function dim0(label: string, raw: string): number | null {
        const value = parseFraction(raw.trim());
        if (value === null || value < 0 || value > 240) {
            setFormError(`${label} needs a dimension of 0 or more (e.g. 3 1/2)`);
            return null;
        }
        return value;
    }

    function add(op: Op): void {
        p.onAddOp(op);
        setOpenForm(null);
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
            setFormError(`To must be within the ${formatFraction(chord)}" edge`);
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
        const size = dim(curve.kind === 'round' ? 'Radius' : 'Height', curve.size);
        if (size === null) return;
        const edge = curve.edge as Edge;
        if (curve.kind === 'arc') {
            add({ type: 'curve', edge, kind: 'arc', height: size });
        } else if (curve.kind === 'ramp') {
            const low = curve.end === 'both' ? endsOf(edge)[0].value : (curve.end as Edge);
            add({ type: 'curve', edge, kind: 'ramp', height: size, low });
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
                `Max ${formatFraction(limit)}" on ${formatFraction(p.thickness!)}" stock${ease.face === 'both' ? ' eased from both faces' : ''}`,
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
    const placeTitle = p.canPlace
        ? 'Click a face in the 3D view to position it'
        : 'Reassemble (exit exploded view) to place ops';

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
                {part.locked && (
                    <span className="bg-accent/15 text-accent flex-none rounded-full px-2 py-0.5 text-[11.5px] font-semibold">
                        locked
                    </span>
                )}
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
                        <optgroup label="Dimensional lumber">
                            {LUMBER_SIZES.map((s) => (
                                <option key={s.nominal} value={s.nominal}>
                                    {s.nominal} ({formatFraction(s.thickness)}" × {formatFraction(s.width)}")
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="Dowel rod" disabled={hasOps}>
                            {DOWEL_SIZES.map((d) => (
                                <option key={d.label} value={d.label}>
                                    {d.label} dowel
                                </option>
                            ))}
                        </optgroup>
                    </Select>
                </Field>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2.5">
                <Field label="Length (in)">
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
                <Field label="Width (in)">
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
                <span>Thickness {p.thickness === null ? '—' : `${formatFraction(p.thickness)}"`}</span>
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

            <SectionLabel>Position</SectionLabel>
            <div className="mb-1.5 grid grid-cols-3 gap-2">
                {AXIS_LABELS.map((label, i) => {
                    const axis = i as Axis3;
                    return (
                        <Field key={label} label={`${label} (in)`}>
                            <TextInput
                                h="md"
                                value={posInputs[axis]}
                                aria-label={`Position ${label} in inches`}
                                data-testid={`pos-input-${axis}`}
                                onChange={(e) => setPosInputs(setAt(posInputs, axis, e.target.value))}
                                onBlur={() => commitPosition(axis)}
                                onKeyDown={onEnter(() => commitPosition(axis))}
                            />
                        </Field>
                    );
                })}
            </div>
            <p className="text-muted mb-4 text-[11px]">Centre of the part. Y is height; negatives allowed.</p>

            <SectionLabel>Orientation</SectionLabel>
            <div className="mb-2 grid grid-cols-3 gap-2">
                {ROTATIONS.map((r) => (
                    <button
                        key={r.axis}
                        className="border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs"
                        data-testid={`rot-90-${r.axis}`}
                        title={`${r.label} +90°`}
                        onClick={() => p.onRotate(r.axis)}
                    >
                        {r.label}
                    </button>
                ))}
            </div>
            <div className="mb-2.5 grid grid-cols-3 gap-2">
                {ROTATIONS.map((r) => (
                    <div key={r.axis} className="flex items-center gap-1">
                        <button
                            className="border-fg/10 text-muted hover:bg-fg/5 h-8 w-7 flex-none rounded-lg border text-[11px]"
                            data-testid={`rot-minus-${r.axis}`}
                            title={`${r.label} −15°`}
                            onClick={() => p.onRotateBy(r.axis, -15)}
                        >
                            −
                        </button>
                        <input
                            value={rotInputs[r.axis]}
                            inputMode="decimal"
                            className="bg-surface-2 border-fg/10 h-8 w-full min-w-0 rounded-lg border px-1 text-center text-xs"
                            aria-label={`${r.label} degrees`}
                            data-testid={`rot-input-${r.axis}`}
                            onChange={(e) => setRotInputs(setAt(rotInputs, r.axis, e.target.value))}
                            onBlur={() => commitRotation(r.axis)}
                            onKeyDown={onEnter(() => commitRotation(r.axis))}
                        />
                        <button
                            className="border-fg/10 text-muted hover:bg-fg/5 h-8 w-7 flex-none rounded-lg border text-[11px]"
                            data-testid={`rot-plus-${r.axis}`}
                            title={`${r.label} +15°`}
                            onClick={() => p.onRotateBy(r.axis, 15)}
                        >
                            +
                        </button>
                    </div>
                ))}
            </div>

            <SectionLabel>Door / Drawer</SectionLabel>
            {p.movable === null ? (
                <div className="mb-4" data-testid="movable-none">
                    <p className="text-muted mb-2 text-[11px]">
                        Hang this part on hardware so it opens. The spec keeps the closed position — the Open
                        toggle is a view.
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
                        <span className="text-fg/80 text-[12.5px] font-semibold" data-testid="movable-kind">
                            {p.movable.kind === 'door' ? 'Door' : 'Drawer'}
                            <span className="text-muted text-[11px] font-normal">
                                {' '}
                                · {p.movable.partIds.length}{' '}
                                {p.movable.partIds.length === 1 ? 'part' : 'parts'}
                            </span>
                        </span>
                        <button
                            className="text-muted hover:text-danger-fg text-[11px]"
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

            <SectionLabel>Hardware</SectionLabel>
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

            <SectionLabel>Ops</SectionLabel>
            {hasOps && (
                <div className="mb-2.5 flex flex-col gap-1" data-testid="ops-list">
                    {part.ops.map((op, i) => (
                        <div
                            key={i}
                            className="bg-surface-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                            data-testid="ops-row"
                        >
                            <span className="text-fg/75 min-w-0 truncate text-xs">{opSummary(op)}</span>
                            <button
                                className="text-muted hover:bg-danger/15 hover:text-danger-fg flex-none rounded px-1.5 py-0.5 text-xs"
                                data-testid={`ops-delete-${i}`}
                                title={`Delete this ${op.type} op`}
                                onClick={() => p.onRemoveOp(i)}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {p.round ? (
                <p
                    className="border-fg/10 text-muted mb-2.5 rounded-lg border border-dashed px-2.5 py-2 text-[11px]"
                    data-testid="round-no-ops"
                >
                    Dowel stock takes no dados, holes or edges — cut features on square stock.
                </p>
            ) : (
                <div className="mb-2.5 grid grid-cols-3 gap-1.5">
                    {OP_BUTTONS.map((b) => (
                        <button
                            key={b.form}
                            className={`border-fg/15 text-fg/65 h-9 rounded-lg border border-dashed text-xs ${openForm === b.form ? 'border-accent text-accent' : 'hover:border-accent/60'}`}
                            data-testid={`ops-add-${b.form}`}
                            onClick={() => toggleForm(b.form)}
                        >
                            {b.label}
                        </button>
                    ))}
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
                            data-testid="pocket-submit"
                            onClick={() => {
                                setFormError(null);
                                const count = pocketCount();
                                if (count !== null)
                                    add({ type: 'pocketHoles', edge: pocket.edge as Edge, count });
                            }}
                        >
                            Add pocket holes
                        </PrimaryButton>
                        <SecondaryButton
                            disabled={!p.canPlace}
                            title={p.canPlace ? 'Point at the part near an edge to place them' : placeTitle}
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
                        Add miter
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
                        Add soft edge
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
                        <Field label="From (in)">
                            <TextInput
                                value={notch.from}
                                inputMode="decimal"
                                data-testid="notch-from"
                                onChange={(e) => setNotch({ ...notch, from: e.target.value })}
                            />
                        </Field>
                        <Field label="To (in)">
                            <TextInput
                                value={notch.to}
                                inputMode="decimal"
                                placeholder="e.g. 3 1/2"
                                data-testid="notch-to"
                                onChange={(e) => setNotch({ ...notch, to: e.target.value })}
                            />
                        </Field>
                        <Field label="Depth (in)">
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
                        Add notch
                    </PrimaryButton>
                </FormBox>
            )}

            {p.overlaps.length > 0 && (
                <div className="mb-3" data-testid="overlap-list">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-muted text-[11.5px] font-semibold tracking-wider uppercase">
                            Overlapping parts
                        </span>
                        <label className="text-muted flex items-center gap-1.5 text-[11px]">
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
                            </Select>
                        </Field>
                    </div>
                    {curve.kind !== 'arc' && (
                        <Field
                            className="mb-2"
                            label={curve.kind === 'ramp' ? 'Sweeps down toward' : 'Which corner'}
                        >
                            <Select
                                value={curve.end}
                                data-testid="curve-end"
                                onChange={(e) => updateCurve({ end: e.target.value })}
                            >
                                {curve.kind === 'round' && <option value="both">both corners</option>}
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
                                ? 'Height (in) — how far the corners drop'
                                : curve.kind === 'ramp'
                                  ? 'Height (in) — how far the low end drops'
                                  : 'Corner radius (in)'
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
                    <PrimaryButton className="w-full" data-testid="curve-submit" onClick={submitCurve}>
                        Add curve
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
                        <Field label="Offset (in)">
                            <TextInput
                                value={dado.offset}
                                inputMode="decimal"
                                placeholder="e.g. 17"
                                data-testid="dado-offset"
                                onChange={(e) => setDado({ ...dado, offset: e.target.value })}
                            />
                        </Field>
                        <Field label="Width (in)">
                            <TextInput
                                value={dado.width}
                                inputMode="decimal"
                                data-testid="dado-width"
                                onChange={(e) => setDado({ ...dado, width: e.target.value })}
                            />
                        </Field>
                        <Field label="Depth (in)">
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
                        <PrimaryButton data-testid="dado-submit" onClick={submitDado}>
                            Add dado
                        </PrimaryButton>
                        <SecondaryButton
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
                        <Field label="Diameter (in)">
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
                        <PrimaryButton data-testid="hole-submit" onClick={submitHole}>
                            Add hole
                        </PrimaryButton>
                        <SecondaryButton
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

            <div className="grid grid-cols-2 gap-2">
                <button
                    className="border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs"
                    onClick={p.onDuplicate}
                >
                    Duplicate
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
    return <p className="text-muted mb-2 text-[11px]">{children}</p>;
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
        <label className="text-muted mb-2 flex items-center gap-2 text-[11px]">
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
            <Field label="From (in)">
                <TextInput
                    value={value.from}
                    inputMode="decimal"
                    placeholder="0"
                    data-testid={`${testPrefix}-from`}
                    onChange={(e) => onChange({ ...value, from: e.target.value })}
                />
            </Field>
            <Field label="To (in)">
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
            className="border-accent/40 text-accent hover:bg-accent/10 min-h-[30px] flex-1 rounded-lg border px-2 py-1 text-[11px] font-semibold"
            data-testid={testId}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
