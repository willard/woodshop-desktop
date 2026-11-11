/**
 * The 3D editor: toolbar over a three.js canvas, with a docked right panel (Cut list / Inspector /
 * Notes). The parent owns the document (and persists it); this renders and edits it. Every change
 * goes through an `EditorDocument` Command, so undo/redo and autosave see all of them.
 *
 * The engine is imperative and long-lived, so it lives in a ref and its handlers read the current
 * document through refs too — never through a closure that a re-render could leave stale.
 */
import * as THREE from 'three';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import {
    AddDowelJoint,
    AddMovable,
    AddOp,
    AddParts,
    AddScrewJoint,
    ApplyFocusEdits,
    DEFAULT_NUDGE_CONFIG,
    DeleteMaterial,
    DissolveMovable,
    DuplicateGroup,
    DuplicatePart,
    EditorDocument,
    EditorEngine,
    GRID_SIZES,
    GroupParts,
    MakeMovable,
    MoveParts,
    MovePart,
    PART_KINDS,
    PART_PRESETS,
    RecenterAssembly,
    RemoveOp,
    RemovePart,
    RemoveParts,
    RenameGroup,
    RenamePart,
    ResizePart,
    RotatePart,
    RotateParts,
    SNAP_GAPS,
    SetGrainAxis,
    SetJoints,
    SetMaterial,
    SetPartRoundStock,
    SetPartSpecies,
    SetPartStock,
    UngroupParts,
    UpdateMovable,
    AddHardware,
    UpdateHardware,
    RemoveHardware,
    uniqueHardwareId,
    WORKSPACE_POS_BOUND,
    aabbFromPart,
    clampToWorkspace,
    cohortOf,
    cohortsOf,
    defaultMovableOptions,
    defaultOptions,
    detectDadoJoints,
    detectOpening,
    detectPocketScrewJoints,
    detectScrewJoints,
    enterFocusMode,
    mergeJoints,
    movableOf,
    notchForOverlap,
    nudgeDelta,
    nudgeStep,
    overlappingParts,
    planDowels,
    planMovable,
    planParts,
    planPocketScrews,
    planScrews,
    pushOutDelta,
    screenAxes,
    touchingParts,
    uniqueGroupId,
    uniqueMovableId,
    uniquePartIdFrom,
    type AddPartOptions,
    type DragInfo,
    type MeasureLabel,
    type MeasureMode,
    type MovableOptions,
    type PartKind,
    type PlacementPreview,
    type PlacementRequest,
    type Vec3,
} from '@/engine';
import { createCsgWorker } from '@/engine/csgWorker';
import type { Joint, Material, Movable, Op, Part, Spec, Species } from '@/spec';
import type { CutList } from '@/cutlist';
import { assessSturdiness } from '@/struct';
import { formatFraction } from '@/lib/fraction';
import { dowelLabelOf, nominalOf } from '@/lib/lumberSizes';
import { handleEditorKeydown, type NudgeDirection, type NudgeStep } from '@/lib/shortcuts';
import { activeTheme, onThemeChange, sceneFor } from '@/lib/theme';
import { AddMovableDialog } from './AddMovableDialog';
import { AddPartDialog } from './AddPartDialog';
import { CutListPanel } from './CutListPanel';
import { GroupInspector } from './GroupInspector';
import { HardwareDialog } from './HardwareDialog';
import { findItem } from '@/hardware/catalog';
import { PartInspector } from './PartInspector';
import { Popover } from './Popover';
import { SnapSettings } from './SnapSettings';
import { ToolbarOverflow } from './ToolbarOverflow';
import { ToolsOverlay } from './tools/ToolsOverlay';

export interface EditorWorkspaceHandle {
    snapshot(): Promise<Blob | null>;
    highlight(ids: string[]): void;
}

export interface EditorWorkspaceProps {
    doc: EditorDocument;
    /** Left toolbar content: back link, project name, save state. */
    toolbar?: ReactNode;
    /** Content for the Notes tab; the tab hides without it. */
    notes?: ReactNode;
    /** Header actions for the cut list (exports). */
    cutListActions?: (cutList: CutList, kerf: number) => ReactNode;
    /** Extra items in the toolbar's overflow menu. */
    overflowExtra?: (close: () => void) => ReactNode;
    kerf: number;
    onKerfChange(kerf: number): void;
    /** Start a new project from these parts of the design (a group, or a multi-selection). */
    onNewProjectFromParts?(partIds: readonly string[], name: string): void;
}

type DockTab = 'cutlist' | 'inspector' | 'notes';

/** Subscribe React to an EditorDocument: re-render on every change. */
function useDocRevision(doc: EditorDocument): number {
    const counter = useRef(0);
    const subscribe = useCallback(
        (notify: () => void) =>
            doc.subscribe(() => {
                counter.current += 1;
                notify();
            }),
        [doc],
    );
    return useSyncExternalStore(subscribe, () => counter.current);
}

/** Wraps a degree value into the schema's ±180 range. */
function clampAngle(deg: number): number {
    return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export const EditorWorkspace = forwardRef<EditorWorkspaceHandle, EditorWorkspaceProps>(
    function EditorWorkspace(props, ref) {
        // --- Focus mode: a group edited in isolation as its own document ---
        const [focus, setFocus] = useState<{
            doc: EditorDocument;
            originalGroupId: string;
            offset: Vec3;
        } | null>(null);
        const doc = focus?.doc ?? props.doc;
        const docRef = useRef(doc);
        docRef.current = doc;
        const rev = useDocRevision(doc);
        const spec = doc.spec;

        const canvas = useRef<HTMLCanvasElement>(null);
        const engineRef = useRef<EditorEngine | null>(null);
        const lastSpec = useRef<Spec | null>(null);

        // --- UI state ---
        const [gridSize, setGridSize] = useState(0.125);
        const [faceSnap, setFaceSnap] = useState(true);
        const [snapGap, setSnapGap] = useState(0);
        const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
        const [mode, setMode] = useState<'view' | 'edit'>('edit');
        const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
        const [dockOpen, setDockOpen] = useState(true);
        const [activeTab, setActiveTab] = useState<DockTab>('cutlist');
        const [issuesOpen, setIssuesOpen] = useState(false);
        const [explode, setExplode] = useState(0);
        const [explodeOpen, setExplodeOpen] = useState(false);
        const [doorsOpen, setDoorsOpen] = useState(0);
        const [doorsOpenVisible, setDoorsOpenVisible] = useState(false);
        const [measuring, setMeasuring] = useState(false);
        const [measureMode, setMeasureModeState] = useState<MeasureMode>('parts');
        const [measureLabels, setMeasureLabels] = useState<MeasureLabel[]>([]);
        const [addDialog, setAddDialog] = useState<AddPartOptions | null>(null);
        const [movableDialog, setMovableDialog] = useState<{
            options: MovableOptions;
            detected: boolean;
        } | null>(null);
        const [toolsOpen, setToolsOpen] = useState(false);
        const [hardwareDialog, setHardwareDialog] = useState<{ partId: string | null } | null>(null);
        const [selectedHardware, setSelectedHardware] = useState<string | null>(null);
        const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
        const [opError, setOpError] = useState<string | null>(null);
        const [placing, setPlacing] = useState<PlacementRequest | null>(null);
        const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
        const placingRef = useRef<PlacementRequest | null>(null);
        placingRef.current = placing;

        // --- Derived from the document (recomputed per revision) ---
        const selected = doc.selectedPart;
        const selectedIds = doc.selectedIds;
        const selectedGroup = doc.selectedGroup;
        const issues = useMemo(() => doc.lint(), [doc, rev]); // eslint-disable-line react-hooks/exhaustive-deps
        const structIssues = useMemo(() => assessSturdiness(spec).issues, [spec]);
        const errorCount = issues.filter((i) => i.severity === 'error').length;
        const advisoryCount = structIssues.length + issues.filter((i) => i.severity === 'warn').length;
        const multiSelected = selectedIds.length >= 2 && selectedGroup === null;
        const groupedIds = useMemo(() => new Set((spec.groups ?? []).flatMap((g) => g.partIds)), [spec]);
        const canGroup = multiSelected && selectedIds.every((id) => !groupedIds.has(id));
        const groupParts =
            selectedGroup === null ? [] : spec.parts.filter((p) => selectedGroup.partIds.includes(p.id));
        const selectedMaterial =
            selected === null ? null : (spec.materials.find((m) => m.id === selected.materialId) ?? null);
        const selectedMovable = selected === null ? null : movableOf(spec, selected.id);
        const selectedGroupMovable =
            selectedGroup === null
                ? null
                : ((spec.movables ?? []).find((m: Movable) =>
                      m.partIds.some((id: string) => selectedGroup.partIds.includes(id)),
                  ) ?? null);
        const hasMovables = (spec.movables ?? []).length > 0;
        const hiddenPresent = spec.parts.filter((p) => hiddenIds.has(p.id)).map((p) => p.id);
        const offCenter = RecenterAssembly.deltaFor(spec).some((d) => d !== 0);

        // --- Engine lifecycle ---
        const syncEngineSelection = useCallback(() => {
            const engine = engineRef.current;
            const d = docRef.current;
            if (engine === null) return;
            engine.setSelected([...d.selectedIds]);
            engine.setDragCohort(d.selectedGroupId !== null ? [...d.selectedIds] : null);
        }, []);

        const recordJoints = useCallback((detected: Joint[]) => {
            const d = docRef.current;
            const existing = d.spec.joints ?? [];
            const merged = mergeJoints(existing, detected);
            if (merged.length !== existing.length) d.execute(new SetJoints(merged));
        }, []);

        useEffect(() => {
            if (canvas.current === null) return;
            const engine = new EditorEngine(canvas.current, {
                scenePalette: sceneFor(activeTheme()),
                csgWorkerFactory: createCsgWorker,
            });
            engineRef.current = engine;
            const unwatchTheme = onThemeChange((next) => engine.setScenePalette(sceneFor(next)));
            engine.pickHandler = (id, modifiers) => {
                if (modifiers.hardwareId !== undefined) {
                    // A piece of hardware: select its part on its own (never the whole group) and
                    // point the inspector at that piece.
                    docRef.current.select(id);
                    setSelectedHardware(modifiers.hardwareId);
                    setActiveTab('inspector');
                    setDockOpen(true);
                    return;
                }
                setSelectedHardware(null);
                docRef.current.handlePick(id, modifiers);
            };
            engine.dragCommitHandler = (ids: string[], delta: Vec3) => {
                docRef.current.execute(new MoveParts(ids, delta));
                // Record any dado joints the drop seated (annotations, not constraints).
                recordJoints(detectDadoJoints(docRef.current.spec));
            };
            engine.dragUpdateHandler = (info) => setDragInfo(info);
            engine.measureUpdateHandler = (labels) => setMeasureLabels(labels);
            engine.placementUpdateHandler = (preview) => setPlacementPreview(preview);
            engine.placementCommitHandler = (preview) => commitPlacementRef.current(preview);
            engine.contextMenuHandler = (id, x, y) => {
                const d = docRef.current;
                // Right-click selects like a click (whole group first) but never drills.
                if (!d.selectedIds.includes(id)) d.handlePick(id, { additive: false });
                setContextMenu({ x, y });
            };
            engine.setMode('edit');
            return () => {
                unwatchTheme();
                engine.dispose();
                engineRef.current = null;
            };
        }, [recordJoints]);

        // (Re)bind when the document object changes: frame the camera on a fresh load.
        useEffect(() => {
            const engine = engineRef.current;
            if (engine === null) return;
            lastSpec.current = doc.spec;
            engine.loadSpec(doc.spec, { frame: true });
            syncEngineSelection();
        }, [doc, syncEngineSelection]);

        // Every change: reload geometry only when the spec object actually changed.
        useEffect(() => {
            const engine = engineRef.current;
            if (engine === null) return;
            if (doc.spec !== lastSpec.current) {
                engine.loadSpec(doc.spec);
                lastSpec.current = doc.spec;
            }
            syncEngineSelection();
        }, [rev, doc, syncEngineSelection]);

        useEffect(() => {
            const engine = engineRef.current;
            if (engine === null) return;
            engine.snapConfig = {
                ...engine.snapConfig,
                gridSize,
                faceGap: snapGap,
                faceSnap,
                alignSnap: faceSnap,
            };
        }, [gridSize, snapGap, faceSnap]);

        // Inspect on selection; the always-on ruler shows a selected part's height above ground.
        const selectionKey = `${selected?.id ?? ''}|${selectedGroup?.id ?? ''}`;
        useEffect(() => {
            if (selected !== null || selectedGroup !== null) {
                setActiveTab('inspector');
                setDockOpen(true);
            }
            engineRef.current?.setAutoMeasure(selectedGroup === null ? (selected?.id ?? null) : null);
        }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

        // The selected piece of hardware belongs to the selected part; drop it when either goes.
        const hardwareStillThere =
            selectedHardware !== null &&
            (spec.hardware ?? []).some((h) => h.id === selectedHardware && h.partId === selected?.id);
        useEffect(() => {
            if (selectedHardware !== null && !hardwareStillThere) setSelectedHardware(null);
            engineRef.current?.setSelectedHardware(hardwareStillThere ? selectedHardware : null);
        }, [selectedHardware, hardwareStillThere]);

        useImperativeHandle(ref, () => ({
            snapshot: () => engineRef.current?.snapshot() ?? Promise.resolve(null),
            highlight: (ids) => engineRef.current?.setHighlight(ids),
        }));

        // --- Visibility (a viewing aid: hidden parts are still cut and still built) ---
        const syncHidden = () => setHiddenIds(engineRef.current?.getHidden() ?? new Set());

        function hideSelection(): void {
            const ids = cohortsOf(doc.spec, doc.selectedIds);
            if (ids.length === 0) return;
            engineRef.current?.hide(ids);
            doc.select(null); // the Inspector must never edit something the user cannot see
            syncHidden();
        }

        function isolateSelection(): void {
            const ids = cohortsOf(doc.spec, doc.selectedIds);
            if (ids.length === 0) return;
            engineRef.current?.isolate(ids);
            syncHidden();
        }

        function showAllParts(): void {
            engineRef.current?.showAll();
            syncHidden();
        }

        /** Bring a hidden part (and its cohort) back before selecting it by id. */
        function reveal(partId: string): void {
            const engine = engineRef.current;
            if (engine === null || !engine.getHidden().has(partId)) return;
            const next = engine.getHidden();
            for (const id of cohortOf(doc.spec, partId)) next.delete(id);
            engine.setHidden(next);
            syncHidden();
        }

        function revealAndPick(partId: string, additive = false): void {
            reveal(partId);
            doc.handlePick(partId, { additive });
        }

        function revealAndSelect(partId: string | null): void {
            if (partId !== null) reveal(partId);
            doc.select(partId);
        }

        function toggleHidden(partId: string): void {
            const engine = engineRef.current;
            if (engine === null) return;
            const cohort = cohortOf(doc.spec, partId);
            const next = engine.getHidden();
            if (next.has(partId)) {
                for (const id of cohort) next.delete(id);
            } else {
                for (const id of cohort) next.add(id);
                if (cohort.some((id) => doc.selectedIds.includes(id))) doc.select(null);
            }
            engine.setHidden(next);
            syncHidden();
        }

        // --- View modes ---
        function toggleExplode(): void {
            const open = !explodeOpen;
            setExplodeOpen(open);
            applyExplode(open ? 0.5 : 0);
        }

        function applyExplode(factor: number): void {
            setExplode(factor);
            engineRef.current?.setExplode(factor);
            if (factor > 0) {
                if (placingRef.current !== null) stopPlacing();
                setDoorsOpen(0);
                setDoorsOpenVisible(false);
            }
        }

        function toggleOpen(): void {
            const visible = !doorsOpenVisible;
            setDoorsOpenVisible(visible);
            applyDoorsOpen(visible ? 1 : 0);
        }

        function applyDoorsOpen(factor: number): void {
            setDoorsOpen(factor);
            engineRef.current?.setOpen(factor);
            if (factor > 0) {
                if (placingRef.current !== null) stopPlacing();
                setExplode(0);
                setExplodeOpen(false);
            }
        }

        function toggleMeasure(): void {
            if (!measuring && explode > 0) return; // measuring separated parts would mislead
            const next = !measuring;
            setMeasuring(next);
            engineRef.current?.setMeasuring(next);
        }

        function setMeasureMode(m: MeasureMode): void {
            setMeasureModeState(m);
            engineRef.current?.setMeasureMode(m);
        }

        function toggleMode(): void {
            const next = mode === 'edit' ? 'view' : 'edit';
            setMode(next);
            engineRef.current?.setMode(next);
        }

        /** Why a press on a part orbits instead of dragging it, and how to get dragging back. */
        const dragBlocked: { reason: string; action: string; fix: () => void } | null =
            mode === 'view'
                ? { reason: 'View mode: parts stay put.', action: 'Edit parts', fix: toggleMode }
                : doorsOpen > 0
                  ? { reason: 'Doors and drawers are open.', action: 'Close them to drag', fix: toggleOpen }
                  : explode > 0
                    ? { reason: 'Exploded view.', action: 'Reassemble to drag', fix: toggleExplode }
                    : measuring
                      ? { reason: 'Measuring.', action: 'Done measuring', fix: toggleMeasure }
                      : null;

        /** Mounts a catalog item on a part, centred on its front face, and shows it in the inspector. */
        function addHardware(itemId: string, partId: string): void {
            const part = spec.parts.find((p) => p.id === partId);
            if (part === undefined) return;
            doc.execute(
                new AddHardware({
                    id: uniqueHardwareId(spec, itemId),
                    item: itemId,
                    partId,
                    side: 'front',
                    x: part.size.l / 2,
                    y: part.size.w / 2,
                    rot: 0,
                }),
            );
            setHardwareDialog(null);
            revealAndSelect(partId);
        }

        function recenter(): void {
            if (focus === null) doc.execute(new RecenterAssembly());
            engineRef.current?.frame();
        }

        // --- Adding parts ---
        function addPart(options: AddPartOptions): void {
            const plan = planParts(doc.spec, options);
            doc.execute(new AddParts(plan.parts, plan.lift, plan.material ?? null));
            doc.select(plan.parts[0].id);
            for (const part of plan.parts.slice(1)) doc.handlePick(part.id, { additive: true });
        }

        function openMovableDialog(kind: 'door' | 'drawer'): void {
            const opening = detectOpening(doc.spec, doc.selectedIds);
            setMovableDialog({
                options: { ...defaultMovableOptions(opening), kind },
                detected: opening !== null,
            });
        }

        function confirmMovableDialog(options: MovableOptions): void {
            setMovableDialog(null);
            const detected = detectOpening(doc.spec, doc.selectedIds);
            // The dialog's numbers win: the user may have overridden what the selection suggested.
            const opening = {
                centre: detected?.centre ?? ([0, options.height / 2] as [number, number]),
                width: options.width,
                height: options.height,
                plane: detected?.plane ?? 0,
                depth: detected?.depth ?? 12,
            };
            const plan = planMovable(doc.spec, opening, options);
            doc.execute(new AddMovable(plan));
            doc.select(plan.parts[0].id);
        }

        // --- Part edits ---
        function move(pos: [number, number, number]): void {
            if (selected === null) return;
            endNudgeSession();
            doc.execute(new MovePart(selected.id, pos));
            recordJoints(detectDadoJoints(doc.spec)); // a typed move can seat a mate too
        }

        function rotateBy(axis: 0 | 1 | 2, delta: number): void {
            if (selectedGroup !== null) {
                doc.execute(new RotateParts([...selectedGroup.partIds], axis, delta));
                return;
            }
            if (selected === null) return;
            const rot = [...selected.transform.rot];
            rot[axis] = clampAngle(rot[axis] + delta);
            doc.execute(new RotatePart(selected.id, rot));
        }

        function rotateTo(axis: 0 | 1 | 2, value: number): void {
            if (selected === null) return;
            const rot = [...selected.transform.rot];
            rot[axis] = clampAngle(value);
            doc.execute(new RotatePart(selected.id, rot));
        }

        const duplicate = (): void => {
            const d = docRef.current;
            const group = d.selectedGroup;
            if (group !== null) {
                const command = new DuplicateGroup(group.id);
                d.execute(command);
                if (command.resultGroupId !== null) d.selectGroup(command.resultGroupId);
                return;
            }
            const part = d.selectedPart;
            if (part === null) return;
            const used = new Set(d.spec.parts.map((p) => p.id));
            for (const p of props.doc.spec.parts) used.add(p.id); // focus mode: ids stay unique overall
            const newId = uniquePartIdFrom(used, `${part.id}_copy`);
            d.execute(new DuplicatePart(part.id, newId, snapGap));
            d.select(newId);
        };

        const remove = (): void => {
            const d = docRef.current;
            const ids = d.selectedIds;
            if (d.selectedGroup !== null || ids.length > 1) {
                d.execute(new RemoveParts([...ids]));
                return;
            }
            const part = d.selectedPart;
            if (part !== null) d.execute(new RemovePart(part.id));
        };

        const group = (): void => {
            const d = docRef.current;
            const ids = d.selectedIds;
            const grouped = new Set((d.spec.groups ?? []).flatMap((g) => g.partIds));
            if (ids.length < 2 || d.selectedGroup !== null || ids.some((id) => grouped.has(id))) return;
            const id = uniqueGroupId(d.spec);
            d.execute(new GroupParts(id, [...ids]));
            d.selectGroup(id);
        };

        const ungroup = (): void => {
            const d = docRef.current;
            if (d.selectedGroupId !== null) d.execute(new UngroupParts(d.selectedGroupId));
        };

        function focusGroup(): void {
            if (selectedGroup === null) return;
            const state = enterFocusMode(props.doc.spec, selectedGroup.id);
            if (!state) return;
            const focusDoc = new EditorDocument(state.focusSpec);
            const newGroupId = (focusDoc.spec.groups ?? [])[0]?.id;
            if (newGroupId) focusDoc.selectGroup(newGroupId);
            setFocus({ doc: focusDoc, originalGroupId: selectedGroup.id, offset: state.offset as Vec3 });
        }

        function exitFocus(apply: boolean): void {
            if (focus === null) return;
            if (apply)
                props.doc.execute(new ApplyFocusEdits(focus.doc.spec, focus.originalGroupId, focus.offset));
            setFocus(null);
        }

        function executeAddOp(partId: string, op: Op): void {
            setOpError(null);
            try {
                doc.execute(new AddOp(partId, op));
            } catch {
                setOpError('That op is invalid — check the values and try again.');
                return;
            }
            // A manually cut joint may already be seated in a mate: record it as drag-seating does.
            if (op.type === 'dado' || op.type === 'groove') recordJoints(detectDadoJoints(doc.spec));
            else if (op.type === 'pocketHoles') recordJoints(detectPocketScrewJoints(doc.spec));
            else if (op.type === 'screws') recordJoints(detectScrewJoints(doc.spec));
        }

        function tryExecute(run: () => void): void {
            setOpError(null);
            try {
                run();
            } catch {
                setOpError('Material limit reached — remove an unused material first.');
            }
        }

        /** Collision view: in focus mode the rest of the build (and the floor) still counts. */
        const collisionSpec = useMemo((): Spec => {
            const focusIds = focus ? new Set(focus.doc.spec.parts.map((p) => p.id)) : new Set<string>();
            const offset = focus?.offset ?? [0, 0, 0];
            const background = focus
                ? props.doc.spec.parts
                      .filter((p) => !focusIds.has(p.id))
                      .map((p) => ({
                          ...p,
                          transform: {
                              ...p.transform,
                              pos: [
                                  p.transform.pos[0] - offset[0],
                                  p.transform.pos[1] - offset[1],
                                  p.transform.pos[2] - offset[2],
                              ] as [number, number, number],
                          },
                      }))
                : [];
            const groundMaterial: Material = {
                id: '__ground_mat__',
                name: 'Ground',
                type: 'sheet',
                thickness: 10,
                sheetSize: { l: 2000, w: 2000 },
                grain: true,
            };
            const ground: Part = {
                id: '__ground__',
                name: 'Floor',
                materialId: groundMaterial.id,
                size: { l: 2000, w: 2000 },
                transform: { pos: [-offset[0], -5 - offset[1], -offset[2]], rot: [90, 0, 0] },
                ops: [],
                qty: 1,
                locked: true,
                grainAxis: 'none',
            };
            return {
                ...spec,
                parts: [...spec.parts, ...background, ground],
                materials: [...spec.materials, groundMaterial],
            };
        }, [spec, focus, props.doc.spec]);

        const overlaps = useMemo(
            () =>
                selected === null
                    ? []
                    : overlappingParts(collisionSpec, selected.id).map((o) => ({
                          partId: o.part.id,
                          name: o.part.name,
                      })),
            [collisionSpec, selected],
        );
        const touching = useMemo(
            () => (selected === null ? [] : touchingParts(collisionSpec, selected.id)),
            [collisionSpec, selected],
        );

        function thicknessIn(s: Spec, part: Part): number {
            return s.materials.find((m) => m.id === part.materialId)?.thickness ?? 0.75;
        }

        function notchAround(insertPartId: string, clearance: number): void {
            const insert = collisionSpec.parts.find((p) => p.id === insertPartId);
            if (selected === null || insert === undefined) return;
            const op = notchForOverlap(
                selected,
                thicknessIn(collisionSpec, selected),
                insert,
                thicknessIn(collisionSpec, insert),
                clearance,
            );
            if (op === null) {
                setOpError("That overlap isn't notch-shaped — it doesn't reach an edge of this part.");
                return;
            }
            executeAddOp(selected.id, op);
        }

        function pushOut(overlapPartId: string): void {
            const overlap = collisionSpec.parts.find((p) => p.id === overlapPartId);
            if (selected === null || overlap === undefined) return;
            const delta = pushOutDelta(
                aabbFromPart(selected, thicknessIn(collisionSpec, selected)),
                aabbFromPart(overlap, thicknessIn(collisionSpec, overlap)),
            );
            if (delta !== null) {
                const p = selected.transform.pos;
                move([p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]);
            }
        }

        function dowelTo(matePartId: string): void {
            if (selected === null) return;
            setOpError(null);
            const plan = planDowels(doc.spec, selected.id, matePartId);
            if ('error' in plan) {
                setOpError(plan.error);
                return;
            }
            doc.execute(new AddDowelJoint(plan.partId, plan.matePartId, plan.holes));
        }

        function fastenTo(matePartId: string, method: 'pocket' | 'screws'): void {
            if (selected === null) return;
            setOpError(null);
            const plan =
                method === 'pocket'
                    ? planPocketScrews(doc.spec, selected.id, matePartId)
                    : planScrews(doc.spec, selected.id, matePartId);
            if ('error' in plan) {
                setOpError(plan.error);
                return;
            }
            doc.execute(new AddScrewJoint(plan.partId, plan.matePartId, plan.op));
        }

        function makeMovable(kind: 'door' | 'drawer'): void {
            if (selected === null) return;
            const id = uniqueMovableId(doc.spec, kind);
            const common = { id, name: selected.name, partIds: [selected.id], style: 'overlay' as const };
            doc.execute(
                new MakeMovable(
                    kind === 'door'
                        ? { ...common, kind: 'door', panelPartId: selected.id, hingeEdge: 'w0' }
                        : { ...common, kind: 'drawer', frontPartId: selected.id },
                ),
            );
        }

        function makeGroupDoor(): void {
            if (selectedGroup === null || groupParts.length === 0) return;
            const anchor = [...groupParts].sort((a, b) => b.size.l * b.size.w - a.size.l * a.size.w)[0];
            doc.execute(
                new MakeMovable({
                    id: uniqueMovableId(doc.spec, 'door'),
                    kind: 'door',
                    name: selectedGroup.name ?? 'Door',
                    partIds: [...selectedGroup.partIds],
                    panelPartId: anchor.id,
                    hingeEdge: 'w0',
                    style: 'overlay',
                }),
            );
        }

        // --- Click-to-place (Inspector "Place in 3D") ---
        function placeOp(request: PlacementRequest): void {
            if (engineRef.current === null || !engineRef.current.startPlacement(request)) return;
            setPlacing(request);
            setPlacementPreview(null);
        }

        /** Quarter-turns the hardware being placed (the R key, or the chip's button). */
        function turnPlacing(): void {
            const request = placingRef.current;
            if (request === null || request.kind !== 'hardware') return;
            placeOp({ ...request, rot: ((request.rot + 90) % 360) as 0 | 90 | 180 | 270 });
        }

        function stopPlacing(): void {
            engineRef.current?.cancelPlacement();
            setPlacing(null);
            setPlacementPreview(null);
        }

        const commitPlacementRef = useRef<(preview: PlacementPreview) => void>(() => undefined);
        commitPlacementRef.current = (preview: PlacementPreview) => {
            const request = placingRef.current;
            if (request === null) return;
            if (request.kind === 'hardware') {
                // Stays in placement mode: casters and pulls go on in runs.
                const d = docRef.current;
                d.execute(
                    new AddHardware({
                        id: uniqueHardwareId(d.spec, request.item),
                        item: request.item,
                        partId: preview.partId,
                        side: preview.face,
                        x: preview.x,
                        y: preview.y,
                        rot: request.rot,
                    }),
                );
                return;
            }
            let op: Op;
            if (request.kind === 'hole') {
                op = {
                    type: 'hole',
                    face: preview.face,
                    x: preview.x,
                    y: preview.y,
                    diameter: request.diameter,
                    ...(request.depth === undefined ? {} : { depth: request.depth }),
                    purpose: request.purpose,
                };
            } else if (request.kind === 'dado') {
                op = {
                    type: 'dado',
                    face: preview.face,
                    axis: request.axis,
                    offset: preview.offset ?? 0,
                    width: request.width,
                    depth: request.depth,
                };
            } else {
                if (preview.edge === null) return; // pocket: nothing to place without an edge
                op = { type: 'pocketHoles', edge: preview.edge, count: request.count };
            }
            executeAddOp(preview.partId, op);
        };

        const placementLabel = (() => {
            const preview = placementPreview;
            if (preview === null || placing === null) return null;
            if (placing.kind === 'dado')
                return `offset ${formatFraction(preview.offset ?? 0)}" · ${preview.face}`;
            if (placing.kind === 'pocket')
                return preview.edge === null ? null : `edge ${preview.edge} · ${placing.count} screws`;
            if (placing.kind === 'hardware') {
                const on = spec.parts.find((p) => p.id === preview.partId)?.name ?? '';
                return `${on} · ${preview.face} · (${formatFraction(preview.x)}", ${formatFraction(preview.y)}")`;
            }
            return `(${formatFraction(preview.x)}", ${formatFraction(preview.y)}") · ${preview.face}`;
        })();

        // --- Arrow-key nudging: a run of presses is one undo entry ---
        const nudgeSession = useRef<{ ids: string[]; delta: Vec3; at: number; rev: number } | null>(null);
        const revRef = useRef(rev);
        revRef.current = rev;

        function endNudgeSession(): void {
            nudgeSession.current = null;
        }

        const nudge = (direction: NudgeDirection, step: NudgeStep): void => {
            const engine = engineRef.current;
            const d = docRef.current;
            if (engine === null) return;
            const invisible = engine.getHidden();
            const ids = [...d.selectedIds].filter((id) => !invisible.has(id));
            if (ids.length === 0) return;
            const forward = new THREE.Vector3();
            engine.camera.getWorldDirection(forward);
            const axes = screenAxes([forward.x, forward.y, forward.z]);
            const positions = d.spec.parts.filter((p) => ids.includes(p.id)).map((p) => p.transform.pos);
            const delta = clampToWorkspace(
                nudgeDelta(direction, axes, nudgeStep(step, gridSize)),
                positions,
                WORKSPACE_POS_BOUND,
            );
            if (delta.every((v) => v === 0)) return;

            const now = Date.now();
            const s = nudgeSession.current;
            const active =
                s !== null &&
                now - s.at <= DEFAULT_NUDGE_CONFIG.coalesceMs &&
                s.rev === revRef.current &&
                s.ids.length === ids.length &&
                s.ids.every((id, i) => id === ids[i]);
            if (active && s !== null) {
                const total: Vec3 = [s.delta[0] + delta[0], s.delta[1] + delta[1], s.delta[2] + delta[2]];
                d.executeReplacingTop(new MoveParts(ids, total));
                nudgeSession.current = { ids, delta: total, at: now, rev: revRef.current + 1 };
                return;
            }
            d.execute(new MoveParts(ids, delta));
            nudgeSession.current = { ids, delta, at: now, rev: revRef.current + 1 };
        };

        // --- Keyboard ---
        const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
        keyHandler.current = (event: KeyboardEvent) => {
            if (
                (event.key === 'r' || event.key === 'R') &&
                placingRef.current?.kind === 'hardware' &&
                !event.metaKey &&
                !event.ctrlKey
            ) {
                event.preventDefault();
                turnPlacing();
                return;
            }
            if (event.key === 'Escape' && placingRef.current !== null) {
                event.preventDefault();
                stopPlacing();
                return;
            }
            if (event.key === 'Escape' && measuring) {
                event.preventDefault();
                toggleMeasure();
                return;
            }
            const nudging =
                event.key.startsWith('Arrow') || event.key === 'PageUp' || event.key === 'PageDown';
            if (!nudging) endNudgeSession();
            const d = docRef.current;
            handleEditorKeydown(event, {
                undo: () => d.undo(),
                redo: () => d.redo(),
                duplicate,
                remove,
                deselect: () => d.select(null),
                hasSelection: () => d.selectedIds.length > 0,
                group,
                canGroup: () => canGroup,
                ungroup,
                hasGroupSelection: () => d.selectedGroupId !== null,
                nudge,
                hide: hideSelection,
                isolate: isolateSelection,
                showAll: showAllParts,
            });
        };
        useEffect(() => {
            const onKey = (e: KeyboardEvent) => keyHandler.current(e);
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, []);

        // Edit ▸ Undo / Redo from the native menu bar (which owns ⌘Z on macOS).
        useEffect(() => {
            const undo = () => docRef.current.undo();
            const redo = () => docRef.current.redo();
            window.addEventListener('woodshop:undo', undo);
            window.addEventListener('woodshop:redo', redo);
            return () => {
                window.removeEventListener('woodshop:undo', undo);
                window.removeEventListener('woodshop:redo', redo);
            };
        }, []);

        // --- Render helpers ---
        const dragLabel = (() => {
            if (dragInfo === null) return null;
            if (dragInfo.snapped) {
                if (dragInfo.nearestGap === null || Math.abs(dragInfo.nearestGap) < 1 / 32) return 'flush';
                return `${formatFraction(Math.abs(dragInfo.nearestGap))}" gap`;
            }
            return dragInfo.nearestGap === null
                ? null
                : `${formatFraction(Math.abs(dragInfo.nearestGap))}" to neighbour`;
        })();

        const measureText = (label: MeasureLabel): string => {
            if (label.kind === 'gap' && label.distance < 1 / 32) return 'touching';
            const value = `${formatFraction(label.distance)}"`;
            return label.prefix === '' ? value : `${label.prefix} ${value}`;
        };
        const measureChipClass = (label: MeasureLabel): string =>
            label.kind === 'gap'
                ? 'bg-warn/25 text-warn-fg'
                : label.kind === 'size'
                  ? 'bg-surface-1/85 text-fg/70'
                  : 'bg-info/25 text-info-fg';

        const toolBtn = (active: boolean) =>
            `h-[30px] flex-none rounded-lg px-3 text-[12.5px] font-semibold ${active ? 'bg-accent/20 text-accent' : 'text-fg/65 hover:bg-fg/5'}`;
        const iconBtn =
            'enabled:hover:text-fg-strong text-muted enabled:hover:bg-fg/5 disabled:text-faint flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg';
        const tabClass = (tab: DockTab) =>
            `h-[30px] rounded-t-lg px-3 text-[12.5px] ${activeTab === tab ? 'bg-surface-2 text-fg-strong font-semibold' : 'text-muted hover:text-fg/80 font-medium'}`;

        const inspector = (
            <>
                {opError && (selected || selectedGroup) && (
                    <p className="text-danger-fg mb-2 text-xs">{opError}</p>
                )}
                {selectedGroup ? (
                    <GroupInspector
                        group={selectedGroup}
                        parts={groupParts}
                        movable={selectedGroupMovable}
                        onRename={(name) => doc.execute(new RenameGroup(selectedGroup.id, name))}
                        onFocus={focusGroup}
                        onRotate={(axis) => rotateBy(axis, 90)}
                        onRotateBy={rotateBy}
                        onDuplicate={duplicate}
                        onUngroup={ungroup}
                        onHide={hideSelection}
                        onRemove={remove}
                        onDrill={revealAndSelect}
                        onMakeDoor={makeGroupDoor}
                        onUpdateMovable={(patch) =>
                            selectedGroupMovable &&
                            doc.execute(new UpdateMovable(selectedGroupMovable.id, patch))
                        }
                        onDissolveMovable={() =>
                            selectedGroupMovable && doc.execute(new DissolveMovable(selectedGroupMovable.id))
                        }
                        onNewProject={
                            props.onNewProjectFromParts &&
                            (() =>
                                props.onNewProjectFromParts!(
                                    selectedGroup.partIds,
                                    selectedGroup.name ?? 'Group',
                                ))
                        }
                    />
                ) : multiSelected ? (
                    <div className="flex flex-col gap-3" data-testid="multi-panel">
                        <div className="text-fg/70 text-[13px]">{selectedIds.length} parts selected</div>
                        {canGroup ? (
                            <button
                                className="bg-accent text-accent-ink hover:bg-accent-strong h-9 rounded-lg text-xs font-semibold"
                                data-testid="multi-group"
                                onClick={group}
                            >
                                Group {selectedIds.length} parts
                            </button>
                        ) : (
                            <p className="text-muted text-xs">
                                Some of these parts are already grouped — ungroup them first.
                            </p>
                        )}
                        {props.onNewProjectFromParts && (
                            <button
                                className="border-fg/10 text-fg/75 hover:bg-fg/5 h-9 rounded-lg border text-xs"
                                data-testid="multi-new-project"
                                title="Copy these parts into a new project of their own, with their materials and joints."
                                onClick={() =>
                                    props.onNewProjectFromParts!(
                                        selectedIds,
                                        `${spec.name} (${selectedIds.length} parts)`,
                                    )
                                }
                            >
                                New project from {selectedIds.length} parts
                            </button>
                        )}
                        <button
                            className="border-fg/10 text-muted hover:bg-fg/5 h-9 rounded-lg border text-xs"
                            data-testid="multi-hide"
                            onClick={hideSelection}
                        >
                            Hide {selectedIds.length} parts
                        </button>
                        <button
                            className="border-danger/40 bg-danger/10 text-danger-fg hover:bg-danger/20 h-9 rounded-lg border text-xs"
                            onClick={remove}
                        >
                            Delete {selectedIds.length} parts
                        </button>
                    </div>
                ) : selected ? (
                    <PartInspector
                        part={selected}
                        materialName={selectedMaterial?.name ?? ''}
                        thickness={selectedMaterial?.thickness ?? null}
                        species={selectedMaterial?.species ?? null}
                        nominal={
                            selectedMaterial?.type === 'lumber'
                                ? nominalOf(selectedMaterial.thickness, selectedMaterial.stockWidth)
                                : null
                        }
                        round={selectedMaterial?.type === 'round'}
                        dowel={
                            selectedMaterial?.type === 'round'
                                ? dowelLabelOf(selectedMaterial.thickness)
                                : null
                        }
                        canPlace={explode === 0 && doorsOpen === 0}
                        overlaps={overlaps}
                        touching={touching}
                        movable={selectedMovable}
                        onResize={(size) => doc.execute(new ResizePart(selected.id, size))}
                        onMove={move}
                        onHide={hideSelection}
                        onMakeMovable={makeMovable}
                        onUpdateMovable={(patch) =>
                            selectedMovable && doc.execute(new UpdateMovable(selectedMovable.id, patch))
                        }
                        hardware={(spec.hardware ?? []).filter((h) => h.partId === selected.id)}
                        onAddHardware={() => setHardwareDialog({ partId: selected.id })}
                        onUpdateHardware={(id, patch) => doc.execute(new UpdateHardware(id, patch))}
                        onRemoveHardware={(id) => doc.execute(new RemoveHardware(id))}
                        selectedHardwareId={hardwareStillThere ? selectedHardware : null}
                        onSelectHardware={setSelectedHardware}
                        onDissolveMovable={() =>
                            selectedMovable && doc.execute(new DissolveMovable(selectedMovable.id))
                        }
                        onRotate={(axis) => rotateBy(axis, 90)}
                        onRotateBy={rotateBy}
                        onRotateTo={rotateTo}
                        onDuplicate={duplicate}
                        onRemove={remove}
                        onRename={(name) => doc.execute(new RenamePart(selected.id, name))}
                        onAddOp={(op) => executeAddOp(selected.id, op)}
                        onRemoveOp={(i) => {
                            setOpError(null);
                            doc.execute(new RemoveOp(selected.id, i));
                        }}
                        onSpecies={(s: Species) =>
                            tryExecute(() => doc.execute(new SetPartSpecies(selected.id, s)))
                        }
                        onStock={(n) => tryExecute(() => doc.execute(new SetPartStock(selected.id, n)))}
                        onRoundStock={(l) =>
                            tryExecute(() => doc.execute(new SetPartRoundStock(selected.id, l)))
                        }
                        onGrainAxis={(axis) => doc.execute(new SetGrainAxis(selected.id, axis))}
                        onPlaceOp={placeOp}
                        onNotchAround={notchAround}
                        onPushOut={pushOut}
                        onDowelTo={dowelTo}
                        onFastenTo={fastenTo}
                    />
                ) : (
                    <div className="text-muted flex h-full flex-col items-center justify-center gap-2 pt-10 text-center">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                            <rect
                                x="4"
                                y="4"
                                width="16"
                                height="16"
                                rx="3"
                                stroke="currentColor"
                                strokeWidth="1.6"
                            />
                            <path d="M9 9h6v6H9z" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                        <div className="text-[13px]">
                            Select a part in the 3D view
                            <br />
                            or Cut list to inspect it.
                        </div>
                    </div>
                )}
            </>
        );

        return (
            <div
                className="bg-surface-0 text-fg-strong flex h-full w-full overflow-hidden text-sm"
                data-testid="editor-shell"
            >
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* Toolbar */}
                    <div
                        className="bg-surface-1 border-fg/[0.07] flex min-h-[52px] flex-none items-center gap-2 border-b px-3 py-2"
                        data-testid="editor-toolbar"
                    >
                        <div
                            className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden"
                            data-testid="toolbar-left"
                        >
                            {props.toolbar}
                            <div className="bg-fg/[0.08] mx-1 h-6 w-px flex-none" />
                            <button
                                className={`h-[30px] flex-none rounded-lg px-3 text-[12.5px] font-semibold ${mode === 'edit' ? 'bg-accent text-accent-ink' : 'text-fg/65 hover:bg-fg/5'}`}
                                data-testid="mode-toggle"
                                title={mode === 'edit' ? 'Edit: drag parts' : 'View: orbit only'}
                                onClick={toggleMode}
                            >
                                {mode === 'edit' ? 'Edit' : 'View'}
                            </button>
                        </div>

                        <div
                            className="toolbar-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
                            data-testid="toolbar-middle"
                        >
                            <button
                                className={iconBtn}
                                disabled={!doc.canUndo}
                                data-testid="undo"
                                title="Undo (⌘Z)"
                                aria-label="Undo"
                                onClick={() => doc.undo()}
                            >
                                <svg
                                    width="15"
                                    height="15"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M9 7H15a5 5 0 0 1 0 10h-4M9 7 5.5 3.5M9 7l-3.5 3.5"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>
                            <button
                                className={iconBtn}
                                disabled={!doc.canRedo}
                                data-testid="redo"
                                title="Redo (⇧⌘Z)"
                                aria-label="Redo"
                                onClick={() => doc.redo()}
                            >
                                <svg
                                    width="15"
                                    height="15"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M15 7H9a5 5 0 0 0 0 10h4M15 7l3.5-3.5M15 7l3.5 3.5"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>
                            <div className="bg-fg/[0.08] mx-1 h-6 w-px flex-none" />
                            <button
                                className={toolBtn(explode > 0)}
                                data-testid="explode-toggle"
                                title={
                                    explode > 0
                                        ? 'Reassemble the parts'
                                        : 'Explode the view to see every part'
                                }
                                onClick={toggleExplode}
                            >
                                Explode
                            </button>
                            {explodeOpen && (
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={explode}
                                    onChange={(e) => applyExplode(Number(e.target.value))}
                                    className="accent-accent w-20 flex-none"
                                    data-testid="explode-slider"
                                    title="Explode distance"
                                />
                            )}
                            {hasMovables && (
                                <button
                                    className={toolBtn(doorsOpen > 0)}
                                    data-testid="open-toggle"
                                    title={
                                        doorsOpen > 0
                                            ? 'Close the doors and drawers'
                                            : 'Swing the doors and drawers open'
                                    }
                                    onClick={toggleOpen}
                                >
                                    Open
                                </button>
                            )}
                            {hasMovables && doorsOpenVisible && (
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={doorsOpen}
                                    onChange={(e) => applyDoorsOpen(Number(e.target.value))}
                                    className="accent-accent w-20 flex-none"
                                    data-testid="open-slider"
                                    title="How far open"
                                />
                            )}
                            <button
                                className={toolBtn(measuring)}
                                data-testid="measure-toggle"
                                disabled={!measuring && (explode > 0 || doorsOpen > 0)}
                                title={
                                    measuring ? 'Stop measuring' : 'Measure heights and gaps between parts'
                                }
                                onClick={toggleMeasure}
                            >
                                Measure
                            </button>
                            {canGroup && (
                                <button
                                    className="bg-accent/20 text-accent hover:bg-accent/30 h-[30px] flex-none rounded-lg px-3 text-[12.5px] font-semibold"
                                    data-testid="group"
                                    title={`Group ${selectedIds.length} parts (⌘G)`}
                                    onClick={group}
                                >
                                    Group {selectedIds.length}
                                </button>
                            )}
                            {selectedGroup && (
                                <button
                                    className={toolBtn(false)}
                                    data-testid="ungroup"
                                    title="Ungroup (⇧⌘G)"
                                    onClick={ungroup}
                                >
                                    Ungroup
                                </button>
                            )}
                        </div>

                        <div className="flex flex-none items-center gap-1.5" data-testid="toolbar-right">
                            <SnapSettings
                                gridSize={gridSize}
                                faceSnap={faceSnap}
                                snapGap={snapGap}
                                gridSizes={GRID_SIZES}
                                snapGaps={SNAP_GAPS}
                                onGridSize={setGridSize}
                                onFaceSnap={setFaceSnap}
                                onSnapGap={setSnapGap}
                            />
                            <Popover
                                align="left"
                                panelClassName="flex w-44 flex-col gap-px p-1.5"
                                trigger={({ toggle }) => (
                                    <button
                                        className="bg-accent text-accent-ink hover:bg-accent-strong flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold"
                                        data-testid="add-menu-toggle"
                                        onClick={toggle}
                                    >
                                        Add
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                                            <path
                                                d="M6 9l6 6 6-6"
                                                stroke="currentColor"
                                                strokeWidth="2.6"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    </button>
                                )}
                            >
                                {(close) => (
                                    <>
                                        {PART_KINDS.map((kind: PartKind) => (
                                            <div key={kind} className="flex items-stretch gap-px">
                                                <button
                                                    className="hover:bg-fg/[0.07] flex-1 rounded-md px-2.5 py-2 text-left text-[12.5px]"
                                                    data-testid={`add-${kind}`}
                                                    onClick={() => {
                                                        addPart(defaultOptions(kind));
                                                        close();
                                                    }}
                                                >
                                                    {PART_PRESETS[kind].label}
                                                    {PART_PRESETS[kind].qty > 1 && (
                                                        <span className="text-muted">
                                                            {' '}
                                                            ×{PART_PRESETS[kind].qty}
                                                        </span>
                                                    )}
                                                </button>
                                                <button
                                                    className="text-faint hover:bg-fg/[0.07] hover:text-fg/70 w-7 flex-none rounded-md"
                                                    data-testid={`add-${kind}-options`}
                                                    title="Choose size, orientation, and how many"
                                                    onClick={() => {
                                                        setAddDialog(defaultOptions(kind));
                                                        close();
                                                    }}
                                                >
                                                    ⋯
                                                </button>
                                            </div>
                                        ))}
                                        <div className="bg-fg/[0.08] my-1 h-px" />
                                        {(['door', 'drawer'] as const).map((kind) => (
                                            <button
                                                key={kind}
                                                className="hover:bg-fg/[0.07] rounded-md px-2.5 py-2 text-left text-[12.5px]"
                                                data-testid={`add-${kind}`}
                                                title="Sized from the opening the selected parts frame"
                                                onClick={() => {
                                                    openMovableDialog(kind);
                                                    close();
                                                }}
                                            >
                                                {kind === 'door' ? 'Door' : 'Drawer'}
                                                <span className="text-faint">…</span>
                                            </button>
                                        ))}
                                        <div className="bg-fg/[0.08] my-1 h-px" />
                                        <button
                                            className="hover:bg-fg/[0.07] rounded-md px-2.5 py-2 text-left text-[12.5px]"
                                            data-testid="add-hardware-menu"
                                            title="Pulls, hinges, casters, brackets, latches and more"
                                            onClick={() => {
                                                setHardwareDialog({ partId: selected?.id ?? null });
                                                close();
                                            }}
                                        >
                                            Hardware<span className="text-faint">…</span>
                                        </button>
                                    </>
                                )}
                            </Popover>
                            <button
                                className="hover:text-fg-strong text-muted hover:bg-fg/5 flex h-7 w-7 flex-none items-center justify-center rounded-lg"
                                data-testid="dock-toggle"
                                title="Toggle panel"
                                onClick={() => setDockOpen(!dockOpen)}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d={dockOpen ? 'M10 6l6 6-6 6' : 'M14 6l-6 6 6 6'}
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>
                            <ToolbarOverflow
                                canRecenter={offCenter}
                                isFocusMode={focus !== null}
                                onRecenter={recenter}
                                onTools={() => setToolsOpen(true)}
                                extra={props.overflowExtra}
                            />
                        </div>
                    </div>

                    {/* Canvas */}
                    <div className="relative flex-1 overflow-hidden">
                        <canvas ref={canvas} className="block h-full w-full touch-none" />

                        {hiddenPresent.length > 0 && (
                            <div
                                className="border-warn/30 bg-warn/10 text-warn-fg absolute right-4 bottom-4 z-10 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px]"
                                data-testid="hidden-chip"
                            >
                                <span>
                                    {hiddenPresent.length} part{hiddenPresent.length === 1 ? '' : 's'} hidden
                                </span>
                                <button
                                    className="text-warn-fg hover:bg-warn/20 rounded px-1.5 py-0.5 font-semibold"
                                    data-testid="show-all"
                                    title="Show every part (⌥H)"
                                    onClick={showAllParts}
                                >
                                    Show all
                                </button>
                            </div>
                        )}

                        <div
                            className="absolute bottom-4 left-4 z-10 flex items-end gap-1.5"
                            data-testid="linter"
                        >
                            <div className="flex flex-col items-start">
                                {issuesOpen && (issues.length > 0 || structIssues.length > 0) && (
                                    <div className="bg-surface-1/90 border-fg/10 mb-2 max-h-56 w-96 max-w-[70vw] overflow-auto rounded-xl border p-3 text-xs backdrop-blur">
                                        <ul>
                                            {issues.map((issue, i) => (
                                                <li
                                                    key={i}
                                                    className={`hover:text-accent cursor-pointer py-0.5 ${issue.severity === 'error' ? 'text-danger-fg' : 'text-warn-fg'}`}
                                                    onClick={() => revealAndSelect(issue.partId ?? null)}
                                                >
                                                    {issue.severity === 'error' ? '✖' : '⚠'} {issue.message}
                                                </li>
                                            ))}
                                        </ul>
                                        {structIssues.length > 0 && (
                                            <div data-testid="struct-advisories">
                                                {issues.length > 0 && (
                                                    <div className="text-muted pt-1.5 text-[10px] font-semibold tracking-wider uppercase">
                                                        Sturdiness
                                                    </div>
                                                )}
                                                <ul>
                                                    {structIssues.map((issue, i) => (
                                                        <li
                                                            key={i}
                                                            className="hover:text-accent text-warn-fg cursor-pointer py-0.5"
                                                            onClick={() =>
                                                                revealAndSelect(issue.partId ?? null)
                                                            }
                                                        >
                                                            ⚠ {issue.message}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5">
                                    <button
                                        className={`bg-surface-1/85 border-fg/[0.08] flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold backdrop-blur ${errorCount > 0 ? 'text-danger-fg' : 'text-ok-fg'}`}
                                        data-testid="lint-badge"
                                        onClick={() => setIssuesOpen(!issuesOpen)}
                                    >
                                        {errorCount === 0 && (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                                <path
                                                    d="M20 6L9 17l-5-5"
                                                    stroke="currentColor"
                                                    strokeWidth="3"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        )}
                                        {errorCount > 0 ? `${errorCount} error(s)` : 'Buildable'}
                                        {errorCount === 0 && advisoryCount > 0 && (
                                            <span className="text-warn-fg font-medium">
                                                · {advisoryCount}{' '}
                                                {advisoryCount === 1 ? 'advisory' : 'advisories'}
                                            </span>
                                        )}
                                    </button>
                                    <span
                                        className="bg-surface-1/85 border-fg/[0.08] text-muted rounded-lg border px-2.5 py-1.5 text-[12.5px] backdrop-blur"
                                        data-testid="parts-count"
                                    >
                                        {spec.parts.length} parts
                                    </span>
                                </div>
                            </div>
                        </div>

                        {dragBlocked !== null ? (
                            // A press on a part orbits instead of dragging in these states; say so,
                            // or it looks like the part is stuck.
                            <div
                                className="bg-surface-1/90 border-fg/[0.08] absolute right-5 bottom-4 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] backdrop-blur"
                                data-testid="drag-blocked"
                            >
                                <span className="text-muted">{dragBlocked.reason}</span>
                                <button
                                    className="text-accent font-medium hover:underline"
                                    onClick={dragBlocked.fix}
                                >
                                    {dragBlocked.action}
                                </button>
                            </div>
                        ) : (
                            hiddenPresent.length === 0 && (
                                <div className="text-muted pointer-events-none absolute right-5 bottom-4 text-[11.5px]">
                                    click a part to inspect · drag to move · shift to lift · ⌘Z undo
                                </div>
                            )
                        )}

                        {placing && (
                            <Chip testId="placement-chip">
                                <span className="text-fg/80">
                                    {placing.kind === 'hardware' ? (
                                        <>
                                            Placing {findItem(placing.item)?.name ?? 'hardware'} — click a
                                            face of a part
                                        </>
                                    ) : (
                                        <>
                                            Placing {placing.kind} —{' '}
                                            {placing.kind === 'dado'
                                                ? 'click a face to set the offset'
                                                : 'click a face to drill'}
                                        </>
                                    )}
                                    <span className="text-muted">
                                        {placing.kind === 'hardware' ? ' · R to turn' : ''} · Esc to finish
                                    </span>
                                </span>
                                {placementLabel && (
                                    <span className="text-accent font-semibold whitespace-nowrap">
                                        {placementLabel}
                                    </span>
                                )}
                                {placing.kind === 'hardware' && (
                                    <button
                                        className="border-fg/15 text-fg/75 hover:bg-fg/5 rounded-md border px-2 py-0.5 text-[11.5px]"
                                        data-testid="placement-turn"
                                        onClick={turnPlacing}
                                    >
                                        Turn 90°
                                    </button>
                                )}
                                <button
                                    className="border-fg/15 text-fg/75 hover:bg-fg/5 min-h-6 rounded-lg border px-2 py-0.5"
                                    data-testid="placement-done"
                                    onClick={stopPlacing}
                                >
                                    ✕ Done
                                </button>
                            </Chip>
                        )}

                        {measureLabels.map((label, i) => (
                            <div
                                key={`measure-${i}`}
                                className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap backdrop-blur ${measureChipClass(label)}`}
                                style={{ left: `${label.x}px`, top: `${label.y}px` }}
                                data-testid="measure-label"
                            >
                                {measureText(label)}
                            </div>
                        ))}

                        {focus && (
                            <Chip testId="focus-banner" className="border-info/50">
                                <span className="text-info font-medium">Focusing on group</span>
                                <button
                                    className="bg-info text-accent-ink hover:bg-info/80 h-7 rounded-lg px-3 text-xs font-semibold"
                                    data-testid="focus-done"
                                    onClick={() => exitFocus(true)}
                                >
                                    Done
                                </button>
                                <button
                                    className="text-muted hover:text-fg h-7 rounded-lg px-2 text-xs font-medium"
                                    data-testid="focus-cancel"
                                    onClick={() => exitFocus(false)}
                                >
                                    Cancel
                                </button>
                            </Chip>
                        )}

                        {measuring && (
                            <Chip testId="measure-chip">
                                <div className="border-fg/10 flex flex-none overflow-hidden rounded-lg border">
                                    {(['parts', 'points'] as const).map((m) => (
                                        <button
                                            key={m}
                                            className={`min-h-6 px-2 text-[11px] font-semibold capitalize ${measureMode === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-fg/5'}`}
                                            data-testid={`measure-mode-${m}`}
                                            onClick={() => setMeasureMode(m)}
                                        >
                                            {m}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-fg/75">
                                    {measureMode === 'parts'
                                        ? 'Click two parts for the gap'
                                        : 'Click two points for the distance'}
                                    <span className="text-muted"> · Esc to finish</span>
                                </span>
                                <button
                                    className="border-fg/15 text-fg/75 hover:bg-fg/5 min-h-6 flex-none rounded-lg border px-2"
                                    data-testid="measure-done"
                                    onClick={toggleMeasure}
                                >
                                    ✕ Done
                                </button>
                            </Chip>
                        )}

                        {dragLabel && (
                            <div
                                className={`pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg px-3 py-1 text-sm font-medium backdrop-blur ${dragInfo?.snapped ? 'bg-ok/25 text-ok-fg' : 'bg-surface-1/85 text-fg-strong'}`}
                                data-testid="drag-label"
                            >
                                {dragLabel}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right dock */}
                <div
                    className={`bg-surface-1 border-fg/[0.07] flex-none overflow-hidden border-l transition-[width] duration-150 ${dockOpen ? 'w-[360px]' : 'w-0 border-l-0'}`}
                >
                    <div className="flex h-full w-[360px] flex-col">
                        <div className="flex flex-none items-center gap-0.5 px-2.5 pt-2">
                            <button
                                className={tabClass('cutlist')}
                                data-testid="cutlist-toggle"
                                onClick={() => setActiveTab('cutlist')}
                            >
                                Cut list
                            </button>
                            <button
                                className={tabClass('inspector')}
                                data-testid="inspector-tab"
                                onClick={() => setActiveTab('inspector')}
                            >
                                Inspector
                            </button>
                            {props.notes && (
                                <button
                                    className={tabClass('notes')}
                                    data-testid="notes-tab"
                                    onClick={() => setActiveTab('notes')}
                                >
                                    Notes
                                </button>
                            )}
                        </div>
                        {activeTab === 'cutlist' && (
                            <CutListPanel
                                spec={spec}
                                kerf={props.kerf}
                                onKerfChange={props.onKerfChange}
                                selectedIds={selectedIds}
                                hiddenIds={hiddenIds}
                                onMaterial={(id, patch) => doc.execute(new SetMaterial(id, patch))}
                                onDeleteMaterial={(id) => doc.execute(new DeleteMaterial(id))}
                                onSelect={revealAndPick}
                                onToggleHidden={toggleHidden}
                                actions={
                                    props.cutListActions
                                        ? (cl) => props.cutListActions!(cl, props.kerf)
                                        : undefined
                                }
                            />
                        )}
                        {activeTab === 'inspector' && (
                            <div className="flex-1 overflow-y-auto p-4">{inspector}</div>
                        )}
                        {/* Notes stays mounted: a half-typed note must survive a trip to another tab. */}
                        {props.notes && (
                            <div
                                className={`min-h-0 flex-1 flex-col ${activeTab === 'notes' ? 'flex' : 'hidden'}`}
                            >
                                {props.notes}
                            </div>
                        )}
                    </div>
                </div>

                {contextMenu && (
                    <div
                        className="fixed inset-0 z-30"
                        onClick={() => setContextMenu(null)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu(null);
                        }}
                    >
                        <div
                            className="bg-surface-3 border-fg/10 absolute min-w-40 overflow-hidden rounded-xl border text-sm shadow-xl"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                            data-testid="context-menu"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {[
                                {
                                    label: selectedGroup ? 'Duplicate group' : 'Duplicate',
                                    run: duplicate,
                                    show: true,
                                },
                                {
                                    label: selectedGroup ? 'Rotate group 90°' : 'Rotate 90°',
                                    run: () => rotateBy(1, 90),
                                    show: true,
                                },
                                {
                                    label: `Group ${selectedIds.length} parts`,
                                    run: group,
                                    show: canGroup,
                                    testId: 'context-group',
                                },
                                {
                                    label: 'Ungroup',
                                    run: ungroup,
                                    show: selectedGroup !== null,
                                    testId: 'context-ungroup',
                                },
                                { label: 'Hide', run: hideSelection, show: true },
                                {
                                    label: selectedGroup ? 'Delete group' : 'Delete',
                                    run: remove,
                                    show: true,
                                    danger: true,
                                },
                            ]
                                .filter((item) => item.show)
                                .map((item) => (
                                    <button
                                        key={item.label}
                                        className={`hover:bg-fg/[0.07] block w-full px-4 py-2.5 text-left ${item.danger ? 'text-danger-fg' : ''}`}
                                        data-testid={item.testId}
                                        onClick={() => {
                                            item.run();
                                            setContextMenu(null);
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                        </div>
                    </div>
                )}

                {addDialog && (
                    <AddPartDialog
                        options={addDialog}
                        onAdd={(o) => {
                            setAddDialog(null);
                            addPart(o);
                        }}
                        onClose={() => setAddDialog(null)}
                    />
                )}
                {movableDialog && (
                    <AddMovableDialog
                        options={movableDialog.options}
                        detected={movableDialog.detected}
                        onAdd={confirmMovableDialog}
                        onClose={() => setMovableDialog(null)}
                    />
                )}
                {hardwareDialog && (
                    <HardwareDialog
                        parts={spec.parts.map((p) => ({ id: p.id, name: p.name }))}
                        partId={hardwareDialog.partId}
                        onAdd={addHardware}
                        canPlace={explode === 0 && doorsOpen === 0}
                        onPlace={(itemId) => {
                            setHardwareDialog(null);
                            placeOp({ kind: 'hardware', item: itemId, rot: 0 });
                        }}
                        onClose={() => setHardwareDialog(null)}
                    />
                )}
                {toolsOpen && <ToolsOverlay onClose={() => setToolsOpen(false)} />}
            </div>
        );
    },
);

function Chip({
    testId,
    className = 'border-fg/10',
    children,
}: {
    testId: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={`bg-surface-1/90 absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur ${className}`}
            data-testid={testId}
        >
            {children}
        </div>
    );
}
