/**
 * EditorEngine — framework-agnostic Three.js editor core (CLAUDE.md §4.1). No Vue imports.
 * Owns the scene, camera, OrbitControls, lighting and ground grid, and renders a spec as
 * placed boxes. Rendering is on-demand (dirty flag), never a constant rAF loop, for phone
 * battery (CLAUDE.md). Phase 1a scope: render & orbit only — commands/snapping come later.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Spec, Part, Material } from '../spec/types';
import { buildSpecGroup } from './buildScene';
import { woodMaterialProvider, createGrainTexture, type MaterialProvider } from './materials';
import { computeSnap, clampAnchorToWorkspace, aabbFromPart, type AABB, type Vec3 } from './snapping';
import { DEFAULT_SNAP_CONFIG, WORKSPACE_POS_BOUND, type SnapConfig } from './config';
import { explodedPositions } from './explode';
import { openedPoses } from './open';
import { faceHitToOpCoords, faceHitToEdge, type Edge } from './placement';
import {
    heightDimension,
    gapDimension,
    sizeDimensions,
    pointDimension,
    midpoint,
    type Dimension,
} from './measure';
import { PartCsg, type CsgWorkerFactory } from './PartCsg';
import type { ChannelSpec, HoleSpec } from './geometry/subtract';
import { isChannel } from './geometry/partGeometry';
import { DARK_SCENE, type ScenePalette } from './theme';

/** Name on both halves of a selection outline, so they can be found and freed as a set. */
const SELECTION_OUTLINE = 'selection-outline';

export interface EditorEngineOptions {
    /** Override the material factory (tests inject a flat one). Defaults to textured grain. */
    materialProvider?: MaterialProvider;
    /** Scene colours (D74). Defaults to the dark theme; the Vue layer swaps it on theme change. */
    scenePalette?: ScenePalette;
    /**
     * How to spawn the CSG worker. Required, because the two hosts load it differently — the app
     * as a chunk (engine/csgWorker.ts), the exported plan viewer inlined (D85) — and defaulting
     * it here would drag one of those into both bundles.
     */
    csgWorkerFactory: CsgWorkerFactory;
}

/** Measurement sub-mode: measure between whole parts, or between two freeform surface points. */
export type MeasureMode = 'parts' | 'points';

/**
 * A ruler readout the UI positions over the canvas. `x`/`y` are canvas pixels (re-projected
 * each render as the camera moves); `distance` is inches; the UI formats it via lib/fraction.
 */
export interface MeasureLabel {
    x: number;
    y: number;
    distance: number;
    /** Short qualifier: 'L'/'W'/'T' for a size edge, '' for height/gap/point. */
    prefix: string;
    kind: 'height' | 'gap' | 'size' | 'point';
}

/** State emitted while dragging, for the UI to render dimension labels/hints. */
export interface DragInfo {
    partId: string;
    pos: Vec3;
    snapped: boolean;
    /** Signed gap to the nearest neighbour face on the drag axes, in inches (null if none). */
    nearestGap: number | null;
}

/** What the user is placing in the 3D view (values come from the Inspector form). */
export type PlacementRequest =
    | {
          kind: 'hole';
          diameter: number;
          depth?: number;
          purpose: 'dowel' | 'shelfPin' | 'hardware' | 'other';
      }
    | { kind: 'dado'; axis: 'l' | 'w'; width: number; depth: number }
    | { kind: 'pocket'; count: number };

/** A live (or committed) placement position in §3.1 op coordinates. */
export interface PlacementPreview {
    partId: string;
    face: 'front' | 'back';
    x: number;
    y: number;
    /** Dado only: channel centreline from the low edge (y for axis l, x for axis w). */
    offset: number | null;
    /** Pocket only: the nearest edge the click resolved to. */
    edge: Edge | null;
}

interface DragState {
    partId: string;
    halfExtents: Vec3;
    others: AABB[];
    /** Horizontal grab offset (pointer hit − centre) on the X/Z axes. */
    grabX: number;
    grabZ: number;
    /** Vertical grab offset (pointer hit.y − centre.y); captured on entering lift mode. */
    grabY: number | null;
    /** Which plane the last move used, so we recapture the grab offset when it switches. */
    mode: 'horizontal' | 'vertical';
    /** Every part moving in this drag (the grabbed part first) — a group moves as a unit. */
    memberIds: string[];
    /** The grabbed part's world centre at drag start; commit reports the delta from here. */
    anchorStart: Vec3;
    /** Ghosts for the OTHER cohort members, each keeping a fixed offset from the anchor. */
    memberGhosts: { ghost: THREE.Mesh; offset: THREE.Vector3 }[];
    /** Per-axis extremes of member offsets from the anchor (zeros for a lone part), so the
     *  anchor can be clamped keeping every member's centre inside the workspace bound. */
    offsetMin: Vec3;
    offsetMax: Vec3;
}

/** Modifier state threaded from pointer events to the app's selection logic. */
export interface PickModifiers {
    /** Shift/Cmd/Ctrl was held — additive (toggle) selection. */
    additive: boolean;
    /** The pick came from a drag start, never a deliberate click (no drill-in). */
    fromDrag?: boolean;
}

export class EditorEngine {
    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera;

    private readonly canvas: HTMLCanvasElement;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;
    private readonly materialProvider: MaterialProvider;
    private readonly grain: THREE.Texture | null;
    private readonly resizeObserver: ResizeObserver;

    private partsGroup: THREE.Group | null = null;
    private renderScheduled = false;
    private disposed = false;

    // Selection / picking. Multi-select (1.6): the app pushes the full selected id set for
    // highlighting; picks carry modifier state so the document can run its click state machine.
    private selectedIds = new Set<string>();
    private readonly raycaster = new THREE.Raycaster();
    /** Part ids hidden from view (presentation only — never written to the spec). */
    private hiddenIds = new Set<string>();
    private readonly pointer = new THREE.Vector2();
    private pointerDownAt: { x: number; y: number } | null = null;
    /** Called when the user clicks a part (id) or empty space (null). */
    pickHandler: ((partId: string | null, modifiers: PickModifiers) => void) | null = null;

    // Drag & snapping.
    snapConfig: SnapConfig = { ...DEFAULT_SNAP_CONFIG };
    /** Parts that move together when one of them is dragged (the selected group), or null. */
    private dragCohort: string[] | null = null;
    /** Called on drop with the moved ids + snapped delta; the app turns this into MoveParts. */
    dragCommitHandler: ((partIds: string[], delta: Vec3) => void) | null = null;
    /** Called each frame during a drag with live position/snap info for UI labels. */
    dragUpdateHandler: ((info: DragInfo | null) => void) | null = null;
    private armedDragId: string | null = null;
    private drag: DragState | null = null;
    private ghost: THREE.Mesh | null = null;
    private readonly guides = new THREE.Group();

    // Amber outlines over parts an AI edit added/changed (§5 visual diff); cleared on interaction.
    private readonly highlights = new THREE.Group();
    private highlightIds: string[] = [];

    // Exploded view (presentation only, hard rule 1): meshes are offset radially from the
    // assembly centre; the spec is never touched and dragging is disabled while exploded so
    // a drop can't commit an exploded position as a MovePart.
    private explodeFactor = 0;

    /**
     * How far doors and drawers stand open (0 = shut, 1 = fully open). Like the exploded view
     * this is presentation only (§3.3): the spec keeps the closed transforms. Mutually exclusive
     * with explode — an exploded door has no hinge line to swing on.
     */
    private openFactor = 0;

    /** The spec the current meshes were built from; `openedPoses` needs the movables. */
    private currentSpec: Spec | null = null;

    // Click-to-place (build-plan: manual ops): while active, hovering a front/back face
    // previews the op as a translucent ghost and a tap commits it. Dragging never arms,
    // orbit stays available, and Esc (via cancelPlacement) exits. Blocked while exploded.
    private placement: PlacementRequest | null = null;
    private placementGhost: THREE.Mesh | null = null;
    /** Live preview for UI labels (null when the pointer is off any valid face). */
    placementUpdateHandler: ((preview: PlacementPreview | null) => void) | null = null;
    /** Called on a tap over a valid face; the app turns this into an AddOp. */
    placementCommitHandler: ((preview: PlacementPreview) => void) | null = null;
    /** Part dims (l/w/thickness) captured at loadSpec for placement math + ghost sizing. */
    private readonly partDims = new Map<string, { l: number; w: number; thickness: number }>();
    /** Authored parts by id, for measurement math that needs the full transform. */
    private readonly partById = new Map<string, Part>();

    // Measurement / ruler (presentation only, hard rule 1): draws dimension lines and emits
    // screen-space labels; never a Command, never touches the spec. `measuring` is the tool
    // toggle; auto height for the current selection shows even with the tool off.
    private measuring = false;
    private measureMode: MeasureMode = 'parts';
    /** The single selected part id (from the app) — drives the always-on height readout. */
    private autoMeasureId: string | null = null;
    /** First tap of a two-tap measurement: a part ('parts' mode) or a world point ('points'). */
    private measureAnchor: { partId: string } | { point: Vec3 } | null = null;
    /** The completed gap/point-to-point result of the last two-tap measurement, if any. */
    private measureResult: Dimension | null = null;
    private readonly measurements = new THREE.Group();
    /** The dimensions currently drawn, kept so their labels re-project as the camera moves. */
    private liveDimensions: { dim: Dimension; prefix: string; kind: MeasureLabel['kind'] }[] = [];
    /** Emits ruler label placements (canvas px) whenever the drawn dimensions or camera change. */
    measureUpdateHandler: ((labels: MeasureLabel[]) => void) | null = null;

    // Interaction mode (build-plan §4.3). View: orbit/tap-select, no dragging. Edit: one
    // finger drags a part, two fingers orbit. Default edit so desktop mouse drag is unchanged.
    private mode: 'view' | 'edit' = 'edit';
    /** Long-press (or right-click) on a part opens a context menu at screen (x, y). */
    contextMenuHandler: ((partId: string, x: number, y: number) => void) | null = null;
    private longPressTimer: ReturnType<typeof setTimeout> | null = null;
    private suppressTap = false;

    // Part CSG (hard rule 11): lazily-created worker; `csgGeneration` invalidates in-flight
    // results after a reload so stale geometry is never swapped in.
    private partCsg: PartCsg | null = null;
    private readonly csgWorkerFactory: CsgWorkerFactory;
    private csgGeneration = 0;

    // Theme (D74). Held as data so `engine/` stays free of CSS/DOM knowledge. The grid and lights
    // are kept so `setScenePalette` can retint in place rather than rebuild the scene.
    private palette: ScenePalette;
    /** Edge geometries behind the selection outlines, held so disposal frees each exactly once. */
    private selectionOutlineGeometries: THREE.BufferGeometry[] = [];
    private grid: THREE.GridHelper | null = null;
    private hemiLight: THREE.HemisphereLight | null = null;
    private keyLight: THREE.DirectionalLight | null = null;
    private fillLight: THREE.DirectionalLight | null = null;

    constructor(canvas: HTMLCanvasElement, options: EditorEngineOptions) {
        this.canvas = canvas;
        this.palette = options.scenePalette ?? DARK_SCENE;
        this.grain = createGrainTexture();
        this.materialProvider = options.materialProvider ?? woodMaterialProvider(this.grain);
        this.csgWorkerFactory = options.csgWorkerFactory;

        // preserveDrawingBuffer lets us grab a PNG thumbnail from the canvas reliably (§7.2).
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.palette.background);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
        this.camera.position.set(48, 42, 64);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.addEventListener('change', this.requestRender);

        this.addLighting();
        this.addGrid();
        this.guides.name = 'snap-guides';
        this.scene.add(this.guides);
        this.highlights.name = 'ai-highlights';
        this.scene.add(this.highlights);
        this.measurements.name = 'measurements';
        this.scene.add(this.measurements);

        // Capture phase: disable orbit before OrbitControls' own (bubble) handler runs, so
        // pressing a part drags it instead of orbiting.
        canvas.addEventListener('pointerdown', this.onPointerDown, true);
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointercancel', this.onPointerUp);
        canvas.addEventListener('contextmenu', this.onContextMenu);

        this.applyTouchMapping();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
        this.resize();
    }

    /** Switches interaction mode and remaps touch gestures accordingly. */
    setMode(mode: 'view' | 'edit'): void {
        this.mode = mode;
        this.applyTouchMapping();
        this.cancelLongPress();
    }

    getMode(): 'view' | 'edit' {
        return this.mode;
    }

    /**
     * View: one finger orbits, two fingers pan/zoom. Edit: one finger drags a part (handled
     * by our pointer logic) or pans empty space, two fingers orbit/zoom (build-plan §4.3).
     */
    private applyTouchMapping(): void {
        if (this.mode === 'view') {
            this.controls.touches.ONE = THREE.TOUCH.ROTATE;
            this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
        } else {
            this.controls.touches.ONE = THREE.TOUCH.PAN;
            this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
        }
    }

    /** Right-click on a part opens the context menu (desktop parity with long-press). */
    private onContextMenu = (event: MouseEvent): void => {
        const id = this.pickAt(event);
        if (id !== null && this.contextMenuHandler !== null) {
            event.preventDefault();
            this.contextMenuHandler(id, event.clientX, event.clientY);
        }
    };

    private cancelLongPress(): void {
        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    /**
     * Edit mode: pressing a part arms a drag and suppresses orbit; empty space orbits/pans.
     * View mode: never arms a drag — a press orbits, and a tap (no move) selects on release.
     * Any press on a part starts a long-press timer that opens the context menu.
     */
    private onPointerDown = (event: PointerEvent): void => {
        this.pointerDownAt = { x: event.clientX, y: event.clientY };
        this.suppressTap = false;
        this.clearHighlight(); // dismiss the AI diff outlines once the user starts working
        const id = this.pickAt(event);

        if (id !== null) {
            this.longPressTimer = setTimeout(() => {
                this.longPressTimer = null;
                this.suppressTap = true;
                this.cancelDrag();
                this.contextMenuHandler?.(id, event.clientX, event.clientY);
            }, 500);
        }

        if (
            this.mode === 'edit' &&
            id !== null &&
            this.explodeFactor === 0 &&
            this.openFactor === 0 &&
            this.placement === null &&
            !this.measuring
        ) {
            this.armedDragId = id;
            this.controls.enabled = false; // don't orbit while dragging a part
        } else {
            this.armedDragId = null;
        }
    };

    /** Aborts an in-progress or armed drag (e.g. when a long-press wins). */
    private cancelDrag(): void {
        this.armedDragId = null;
        if (this.drag !== null) {
            this.clearDrag();
        }
        this.controls.enabled = true;
    }

    /** Once the pointer moves past a small threshold on an armed part, start dragging it. */
    private onPointerMove = (event: PointerEvent): void => {
        if (this.pointerDownAt !== null) {
            const moved = Math.hypot(
                event.clientX - this.pointerDownAt.x,
                event.clientY - this.pointerDownAt.y,
            );
            if (moved > 4) {
                this.cancelLongPress(); // movement means it's a drag/orbit, not a long-press
            }
        }
        if (this.placement !== null) {
            this.updatePlacementPreview(event);
            return;
        }
        if (this.drag !== null) {
            this.updateDrag(event);
            return;
        }
        if (this.armedDragId === null || this.pointerDownAt === null) {
            return;
        }
        const moved = Math.hypot(event.clientX - this.pointerDownAt.x, event.clientY - this.pointerDownAt.y);
        if (moved > 4) {
            this.startDrag(this.armedDragId, event);
        }
    };

    /** A drop commits the move; a press that never became a drag is a tap → select. */
    private onPointerUp = (event: PointerEvent): void => {
        const down = this.pointerDownAt;
        this.pointerDownAt = null;
        this.cancelLongPress();
        this.controls.enabled = true;

        if (this.drag !== null) {
            this.endDrag();
            this.armedDragId = null;
            return;
        }

        this.armedDragId = null;
        if (this.suppressTap) {
            this.suppressTap = false;
            return; // a long-press already handled this gesture
        }
        if (down === null) {
            return;
        }
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (moved > 5) {
            return; // an orbit, not a selection/placement
        }
        // A tap while placing commits the op (and stays in placement mode for the next one —
        // shelf-pin rows are drilled in runs). Touch has no hover, so the tap itself computes
        // the position. Taps on empty space or edge faces do nothing.
        if (this.placement !== null) {
            const preview = this.previewAt(event);
            if (preview !== null) {
                this.placementCommitHandler?.(preview);
            }
            return;
        }
        // A tap while measuring records a measurement point instead of selecting.
        if (this.measuring) {
            this.handleMeasureTap(event);
            return;
        }
        // Shift-click is additive selection; shift only means "lift" once a drag has actually
        // started (>4px of motion), so the two never collide on a clean tap.
        this.pickHandler?.(this.pickAt(event), {
            additive: event.shiftKey || event.metaKey || event.ctrlKey,
        });
    };

    // --- click-to-place ---

    /** Enters placement mode. No-op while exploded (coords would mislead); cancels any drag. */
    startPlacement(request: PlacementRequest): boolean {
        if (this.explodeFactor > 0 || this.openFactor > 0) {
            return false;
        }
        this.cancelDrag();
        this.placement = request;
        return true;
    }

    /** Leaves placement mode and removes the ghost. Safe to call when not placing. */
    cancelPlacement(): void {
        if (this.placement === null) {
            return;
        }
        this.placement = null;
        this.disposePlacementGhost();
        this.placementUpdateHandler?.(null);
        this.requestRender();
    }

    isPlacing(): boolean {
        return this.placement !== null;
    }

    /** Raycasts the pointer against the parts and maps the hit to op coords, or null. */
    private previewAt(event: MouseEvent): PlacementPreview | null {
        if (this.partsGroup === null || this.placement === null) {
            return null;
        }
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObjects(this.pickableParts(), false)[0];
        const partId = hit?.object.name ?? '';
        const dims = this.partDims.get(partId);
        if (hit?.face === undefined || hit.face === null || dims === undefined) {
            return null;
        }
        // Raycaster reports the point in world space but the face normal in object space.
        const local = (hit.object as THREE.Mesh).worldToLocal(hit.point.clone());
        const normal = hit.face.normal;
        const coords = faceHitToOpCoords(
            dims,
            [local.x, local.y, local.z],
            [normal.x, normal.y, normal.z],
            this.snapConfig.gridSize,
        );
        if (coords === null) {
            return null;
        }
        const offset =
            this.placement.kind === 'dado' ? (this.placement.axis === 'l' ? coords.y : coords.x) : null;
        const edge =
            this.placement.kind === 'pocket'
                ? faceHitToEdge(dims, [local.x, local.y, local.z], [normal.x, normal.y, normal.z])
                : null;
        return { partId, face: coords.face, x: coords.x, y: coords.y, offset, edge };
    }

    /** Moves/rebuilds the translucent op ghost to follow the pointer. */
    private updatePlacementPreview(event: PointerEvent): void {
        const preview = this.previewAt(event);
        this.placementUpdateHandler?.(preview);
        if (preview === null) {
            this.disposePlacementGhost();
            this.requestRender();
            return;
        }
        const request = this.placement;
        const mesh = this.partsGroup?.getObjectByName(preview.partId) as THREE.Mesh | undefined;
        const dims = this.partDims.get(preview.partId);
        if (request === null || mesh === undefined || dims === undefined) {
            return;
        }

        this.disposePlacementGhost();
        const material = new THREE.MeshStandardMaterial({
            color: this.palette.snap,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
        });
        const front = preview.face === 'front';
        let geometry: THREE.BufferGeometry;
        const local = new THREE.Vector3();
        if (request.kind === 'hole') {
            const depth = Math.min(request.depth ?? dims.thickness, dims.thickness);
            geometry = new THREE.CylinderGeometry(request.diameter / 2, request.diameter / 2, depth, 24);
            geometry.rotateX(Math.PI / 2); // cylinder axis Y → local Z (§3.1 thickness)
            local.set(
                preview.x - dims.l / 2,
                preview.y - dims.w / 2,
                front ? dims.thickness / 2 - depth / 2 : -dims.thickness / 2 + depth / 2,
            );
        } else if (request.kind === 'dado') {
            const depth = Math.min(request.depth, dims.thickness);
            const alongL = request.axis === 'l';
            geometry = new THREE.BoxGeometry(
                alongL ? dims.l : request.width,
                alongL ? request.width : dims.w,
                depth,
            );
            local.set(
                alongL ? 0 : preview.x - dims.l / 2,
                alongL ? preview.y - dims.w / 2 : 0,
                front ? dims.thickness / 2 - depth / 2 : -dims.thickness / 2 + depth / 2,
            );
        } else {
            // Pocket: highlight the resolved edge as a thin bar on the hit face (markers only).
            const BAR = 0.2;
            const onFace = front ? dims.thickness / 2 : -dims.thickness / 2;
            const edge = preview.edge ?? 'w1';
            if (edge === 'l0' || edge === 'l1') {
                geometry = new THREE.BoxGeometry(dims.l, BAR, BAR);
                local.set(0, edge === 'l0' ? -dims.w / 2 : dims.w / 2, onFace);
            } else {
                geometry = new THREE.BoxGeometry(BAR, dims.w, BAR);
                local.set(edge === 'w0' ? -dims.l / 2 : dims.l / 2, 0, onFace);
            }
        }

        const ghost = new THREE.Mesh(geometry, material);
        mesh.updateMatrixWorld(true);
        ghost.position.copy(mesh.localToWorld(local));
        ghost.quaternion.copy(mesh.quaternion);
        ghost.name = 'placement-ghost';
        this.placementGhost = ghost;
        this.scene.add(ghost);
        this.requestRender();
    }

    private disposePlacementGhost(): void {
        if (this.placementGhost !== null) {
            this.scene.remove(this.placementGhost);
            this.placementGhost.geometry.dispose();
            (this.placementGhost.material as THREE.Material).dispose();
            this.placementGhost = null;
        }
    }

    /** Sets which parts move together when one of them is dragged (the selected group). */
    setDragCohort(ids: readonly string[] | null): void {
        this.dragCohort = ids === null ? null : [...ids];
    }

    /**
     * Begins dragging `partId`. Default motion is on a horizontal work plane at the part's
     * height; holding Shift switches to vertical (lift) motion on a camera-facing plane.
     * When the grabbed part belongs to the drag cohort (the selected group), every member
     * moves with it: the grabbed part's ghost is the snap anchor, the rest follow at fixed
     * offsets, and the commit reports one shared delta.
     */
    private startDrag(partId: string, event: PointerEvent): void {
        const mesh = this.partsGroup?.getObjectByName(partId) as THREE.Mesh | undefined;
        if (mesh === undefined || this.partsGroup === null) {
            return;
        }
        // fromDrag: grabbing a member of the selected group must select, never drill into it.
        this.pickHandler?.(partId, { additive: false, fromDrag: true });

        const cohort =
            this.dragCohort !== null && this.dragCohort.includes(partId)
                ? [partId, ...this.dragCohort.filter((id) => id !== partId)]
                : [partId];
        const memberSet = new Set(cohort);

        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const hit = this.raycastPlane(event, this.horizontalPlane(center.y));
        const grabX = hit === null ? 0 : hit.x - center.x;
        const grabZ = hit === null ? 0 : hit.z - center.z;

        // Snapshot the non-moving parts' world AABBs once. Every cohort member is excluded —
        // a group must not snap against itself mid-drag.
        const others: AABB[] = [];
        if (this.currentSpec !== null) {
            for (const part of this.currentSpec.parts) {
                if (memberSet.has(part.id)) {
                    continue;
                }
                const material = this.currentSpec.materials.find((m) => m.id === part.materialId);
                if (material !== undefined) {
                    others.push(aabbFromPart(part, material.thickness));
                }
            }
        }

        // Ghosts for the other members, keeping their offsets from the anchor.
        const memberGhosts: { ghost: THREE.Mesh; offset: THREE.Vector3 }[] = [];
        for (const id of cohort.slice(1)) {
            const memberMesh = this.partsGroup.getObjectByName(id) as THREE.Mesh | undefined;
            if (memberMesh === undefined) {
                continue;
            }
            const memberCenter = new THREE.Box3().setFromObject(memberMesh).getCenter(new THREE.Vector3());
            const ghost = this.buildGhost(memberMesh);
            ghost.position.copy(memberCenter);
            this.scene.add(ghost);
            memberMesh.visible = false;
            memberGhosts.push({ ghost, offset: memberCenter.clone().sub(center) });
        }

        const offsetMin: Vec3 = [0, 0, 0];
        const offsetMax: Vec3 = [0, 0, 0];
        for (const { offset } of memberGhosts) {
            const o = [offset.x, offset.y, offset.z];
            for (let axis = 0; axis < 3; axis += 1) {
                offsetMin[axis] = Math.min(offsetMin[axis], o[axis]);
                offsetMax[axis] = Math.max(offsetMax[axis], o[axis]);
            }
        }

        this.drag = {
            partId,
            halfExtents: [size.x / 2, size.y / 2, size.z / 2],
            others,
            grabX,
            grabZ,
            grabY: null,
            mode: 'horizontal',
            memberIds: cohort,
            anchorStart: [center.x, center.y, center.z],
            memberGhosts,
            offsetMin,
            offsetMax,
        };
        this.ghost = this.buildGhost(mesh);
        this.ghost.position.copy(center);
        this.scene.add(this.ghost);
        mesh.visible = false;
        this.updateDrag(event);
    }

    /** A horizontal plane (normal +Y) at height `y`. */
    private horizontalPlane(y: number): THREE.Plane {
        return new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    }

    /** Moves the ghost to the snapped position and refreshes guides + drag info. */
    private updateDrag(event: PointerEvent): void {
        const drag = this.drag;
        if (drag === null || this.ghost === null) {
            return;
        }
        const ghost = this.ghost;
        const vertical = event.shiftKey;

        let candidate: Vec3;
        let dragAxes: readonly number[];

        if (vertical) {
            // Vertical plane through the ghost, facing the camera, so pointer Y maps to world Y.
            const normal = new THREE.Vector3().subVectors(this.camera.position, ghost.position).setY(0);
            if (normal.lengthSq() < 1e-6) {
                normal.set(0, 0, 1);
            }
            normal.normalize();
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, ghost.position);
            const hit = this.raycastPlane(event, plane);
            if (hit === null) {
                return;
            }
            if (drag.mode !== 'vertical' || drag.grabY === null) {
                drag.grabY = hit.y - ghost.position.y; // recapture so the part doesn't jump
                drag.mode = 'vertical';
            }
            candidate = [ghost.position.x, hit.y - drag.grabY, ghost.position.z];
            dragAxes = [1];
        } else {
            const hit = this.raycastPlane(event, this.horizontalPlane(ghost.position.y));
            if (hit === null) {
                return;
            }
            if (drag.mode !== 'horizontal') {
                drag.grabX = hit.x - ghost.position.x; // recapture on switching back
                drag.grabZ = hit.z - ghost.position.z;
                drag.mode = 'horizontal';
            }
            candidate = [hit.x - drag.grabX, ghost.position.y, hit.z - drag.grabZ];
            dragAxes = [0, 2];
        }

        // Clamp before snapping (a near-horizon raycast can land the plane hit hundreds of
        // inches out) and again after (grid rounding at the boundary can overshoot) — the
        // committed spec pos must stay within schema bounds for every cohort member.
        candidate = clampAnchorToWorkspace(candidate, drag.offsetMin, drag.offsetMax, WORKSPACE_POS_BOUND);
        const result = computeSnap(candidate, drag.halfExtents, drag.others, this.snapConfig, dragAxes);
        result.center = clampAnchorToWorkspace(
            result.center,
            drag.offsetMin,
            drag.offsetMax,
            WORKSPACE_POS_BOUND,
        );
        ghost.position.set(result.center[0], result.center[1], result.center[2]);
        const snapped = result.snaps.length > 0;
        (ghost.material as THREE.MeshStandardMaterial).color.setHex(
            snapped ? this.palette.snap : this.palette.ghost,
        );
        // Cohort members ride along at their fixed offsets from the anchor.
        for (const { ghost: member, offset } of drag.memberGhosts) {
            member.position.copy(ghost.position).add(offset);
            (member.material as THREE.MeshStandardMaterial).color.setHex(
                snapped ? this.palette.snap : this.palette.ghost,
            );
        }
        this.drawGuides(result.snaps.map((s) => ({ axis: s.axis, at: s.at })));

        this.dragUpdateHandler?.({
            partId: drag.partId,
            pos: result.center,
            snapped,
            nearestGap: this.nearestGap(result.center, drag),
        });
        this.requestRender();
    }

    /** Commits the drag as one shared delta over every moved part, and tears down visuals. */
    private endDrag(): void {
        const drag = this.drag;
        const ghost = this.ghost;
        try {
            if (drag !== null && ghost !== null) {
                const delta: Vec3 = [
                    ghost.position.x - drag.anchorStart[0],
                    ghost.position.y - drag.anchorStart[1],
                    ghost.position.z - drag.anchorStart[2],
                ];
                this.dragCommitHandler?.([...drag.memberIds], delta);
            }
        } finally {
            // A commit rejected by spec validation must still tear the drag visuals down,
            // or the ghost sticks and the real mesh stays hidden.
            this.clearDrag();
            this.dragUpdateHandler?.(null);
        }
    }

    private clearDrag(): void {
        if (this.ghost !== null) {
            this.scene.remove(this.ghost);
            this.ghost.geometry.dispose();
            (this.ghost.material as THREE.Material).dispose();
            this.ghost = null;
        }
        if (this.drag !== null) {
            for (const { ghost: member } of this.drag.memberGhosts) {
                this.scene.remove(member);
                // buildGhost shares the mesh geometry — dispose only the ghost's material.
                (member.material as THREE.Material).dispose();
            }
            for (const id of this.drag.memberIds) {
                const mesh = this.partsGroup?.getObjectByName(id) as THREE.Mesh | undefined;
                if (mesh !== undefined) {
                    mesh.visible = true;
                }
            }
        }
        this.clearGuides();
        this.drag = null;
        this.requestRender();
    }

    /** Translucent copy of the dragged mesh that follows the pointer. */
    private buildGhost(mesh: THREE.Mesh): THREE.Mesh {
        const material = new THREE.MeshStandardMaterial({
            color: this.palette.ghost,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
        });
        const ghost = new THREE.Mesh(mesh.geometry, material);
        ghost.quaternion.copy(mesh.quaternion);
        ghost.name = 'drag-ghost';
        return ghost;
    }

    /** Light guide lines through each engaged snap plane (X/Z on the ground, Y as a height line). */
    private drawGuides(lines: { axis: number; at: number }[]): void {
        this.clearGuides();
        const span = 120;
        const ghostZ = this.ghost?.position.z ?? 0;
        for (const { axis, at } of lines) {
            const a = new THREE.Vector3();
            const b = new THREE.Vector3();
            if (axis === 0) {
                a.set(at, 0.02, -span);
                b.set(at, 0.02, span);
            } else if (axis === 2) {
                a.set(-span, 0.02, at);
                b.set(span, 0.02, at);
            } else {
                // Y snap: a horizontal height line at the ghost's depth.
                a.set(-span, at, ghostZ);
                b.set(span, at, ghostZ);
            }
            const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
            const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: this.palette.snap }));
            this.guides.add(line);
        }
    }

    private clearGuides(): void {
        for (const child of this.guides.children) {
            (child as THREE.Line).geometry.dispose();
            ((child as THREE.Line).material as THREE.Material).dispose();
        }
        this.guides.clear();
    }

    // --- measurement / ruler (presentation only) ---

    /** Toggles the measure tool. No-op enter while exploded (offset positions would mislead). */
    setMeasuring(on: boolean): boolean {
        if (on && (this.explodeFactor > 0 || this.openFactor > 0)) {
            return false;
        }
        this.measuring = on;
        if (on) {
            this.cancelPlacement();
            this.cancelDrag();
        }
        this.measureAnchor = null;
        this.measureResult = null;
        this.refreshMeasurements();
        return true;
    }

    isMeasuring(): boolean {
        return this.measuring;
    }

    /** Switches between whole-part and freeform-point measuring; resets the in-progress tap. */
    setMeasureMode(mode: MeasureMode): void {
        this.measureMode = mode;
        this.measureAnchor = null;
        this.measureResult = null;
        this.refreshMeasurements();
    }

    /** The app's current single selection — drives the always-on height readout (tool off too). */
    setAutoMeasure(partId: string | null): void {
        if (partId === this.autoMeasureId) {
            return;
        }
        this.autoMeasureId = partId;
        this.refreshMeasurements();
    }

    /** World AABB (min/max arrays) of a live part mesh, or null if it isn't in the scene. */
    private partBox(id: string): { min: Vec3; max: Vec3 } | null {
        const mesh = this.partsGroup?.getObjectByName(id) as THREE.Mesh | undefined;
        if (mesh === undefined) {
            return null;
        }
        const b = new THREE.Box3().setFromObject(mesh);
        return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    }

    /** Projects a world point to canvas pixels; null when it sits behind the camera. */
    private worldToScreen(v: Vec3): { x: number; y: number } | null {
        const ndc = new THREE.Vector3(v[0], v[1], v[2]).project(this.camera);
        if (ndc.z > 1) {
            return null; // behind the camera
        }
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (ndc.x * 0.5 + 0.5) * rect.width,
            y: (-ndc.y * 0.5 + 0.5) * rect.height,
        };
    }

    /**
     * Rebuilds the set of dimensions to show from the current selection + tool state, redraws
     * the 3D lines, and re-emits the labels. Presentation only — never touches the spec.
     */
    private refreshMeasurements(): void {
        const dims: { dim: Dimension; prefix: string; kind: MeasureLabel['kind'] }[] = [];

        // The focused part: the tool's anchor while measuring, else the app's selection.
        const focusId =
            this.measuring && this.measureAnchor !== null && 'partId' in this.measureAnchor
                ? this.measureAnchor.partId
                : this.autoMeasureId;
        if (focusId !== null) {
            const box = this.partBox(focusId);
            if (box !== null) {
                dims.push({ dim: heightDimension(box), prefix: '', kind: 'height' });
            }
            // Size (L×W×T) shows only inside the measure tool, to keep plain selection uncluttered.
            const part = this.partById.get(focusId);
            if (this.measuring && part !== undefined) {
                const t = this.partDims.get(focusId)?.thickness ?? 0;
                const size = sizeDimensions(part, t);
                dims.push({ dim: size.length, prefix: 'L', kind: 'size' });
                dims.push({ dim: size.width, prefix: 'W', kind: 'size' });
                dims.push({ dim: size.thickness, prefix: 'T', kind: 'size' });
            }
        }

        if (this.measureResult !== null) {
            const kind: MeasureLabel['kind'] = this.measureMode === 'points' ? 'point' : 'gap';
            dims.push({ dim: this.measureResult, prefix: '', kind });
        }

        this.liveDimensions = dims;
        this.drawDimensionObjects();
        this.emitMeasureLabels();
        this.requestRender();
    }

    /** Draws each live dimension as a line (with end caps) into the measurements group. */
    private drawDimensionObjects(): void {
        this.clearDimensionObjects();
        for (const { dim, kind } of this.liveDimensions) {
            const color =
                kind === 'gap'
                    ? this.palette.ghost
                    : kind === 'size'
                      ? this.palette.dimensionSize
                      : this.palette.dimensionPoint;
            const a = new THREE.Vector3(dim.a[0], dim.a[1], dim.a[2]);
            const b = new THREE.Vector3(dim.b[0], dim.b[1], dim.b[2]);
            const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
            const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
            line.renderOrder = 999; // draw over parts so a dimension is never hidden inside a body
            (line.material as THREE.LineBasicMaterial).depthTest = false;
            this.measurements.add(line);
        }
    }

    private clearDimensionObjects(): void {
        for (const child of this.measurements.children) {
            (child as THREE.Line).geometry.dispose();
            ((child as THREE.Line).material as THREE.Material).dispose();
        }
        this.measurements.clear();
    }

    /** Projects each live dimension's midpoint to canvas pixels and emits the label set. */
    private emitMeasureLabels(): void {
        if (this.measureUpdateHandler === null) {
            return;
        }
        const labels: MeasureLabel[] = [];
        for (const { dim, prefix, kind } of this.liveDimensions) {
            const screen = this.worldToScreen(midpoint(dim));
            if (screen !== null) {
                labels.push({ x: screen.x, y: screen.y, distance: dim.distance, prefix, kind });
            }
        }
        this.measureUpdateHandler(labels);
    }

    /** Resolves a tap to a world point on a part surface, or on the ground plane (y=0). */
    private measureWorldPoint(event: PointerEvent): Vec3 | null {
        if (this.partsGroup !== null) {
            const rect = this.canvas.getBoundingClientRect();
            this.pointer.set(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1,
            );
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hit = this.raycaster.intersectObjects(this.pickableParts(), false)[0];
            if (hit !== undefined) {
                return [hit.point.x, hit.point.y, hit.point.z];
            }
        }
        const ground = this.raycastPlane(event, this.horizontalPlane(0));
        return ground === null ? null : [ground.x, ground.y, ground.z];
    }

    /** Handles one tap of the two-tap measurement gesture (called from onPointerUp). */
    private handleMeasureTap(event: PointerEvent): void {
        if (this.measureMode === 'parts') {
            const id = this.pickAt(event);
            if (id === null) {
                this.measureAnchor = null; // tapping empty space clears the in-progress measurement
                this.measureResult = null;
            } else if (this.measureAnchor !== null && 'partId' in this.measureAnchor) {
                const a = this.partBox(this.measureAnchor.partId);
                const b = this.partBox(id);
                this.measureResult =
                    a !== null && b !== null && id !== this.measureAnchor.partId ? gapDimension(a, b) : null;
                this.measureAnchor = { partId: id }; // chain: the tapped part anchors the next gap
            } else {
                this.measureAnchor = { partId: id };
                this.measureResult = null;
            }
        } else {
            const point = this.measureWorldPoint(event);
            if (point === null) {
                return;
            }
            if (this.measureAnchor !== null && 'point' in this.measureAnchor) {
                this.measureResult = pointDimension(this.measureAnchor.point, point);
                this.measureAnchor = { point };
            } else {
                this.measureAnchor = { point };
                this.measureResult = null;
            }
        }
        this.refreshMeasurements();
    }

    /** Smallest signed gap from the moving part's faces to any neighbour, over all axes. */
    private nearestGap(center: Vec3, drag: DragState): number | null {
        let best: number | null = null;
        for (const axis of [0, 1, 2]) {
            const half = drag.halfExtents[axis];
            const min = center[axis] - half;
            const max = center[axis] + half;
            for (const other of drag.others) {
                for (const gap of [other.min[axis] - max, min - other.max[axis]]) {
                    if (best === null || Math.abs(gap) < Math.abs(best)) {
                        best = gap;
                    }
                }
            }
        }
        return best;
    }

    /** Raycasts the pointer against a plane, returning the world hit point or null. */
    private raycastPlane(event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = new THREE.Vector3();
        return this.raycaster.ray.intersectPlane(plane, hit) === null ? null : hit;
    }

    /** Returns the id of the front-most part under the pointer, or null. */
    private pickAt(event: MouseEvent): string | null {
        if (this.partsGroup === null) {
            return null;
        }
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.partsGroup.children, false);
        return hits.length > 0 ? hits[0].object.name || null : null;
    }

    /** Amber-keyed workshop lighting. Colours and intensities come from the theme (D74). */
    private addLighting(): void {
        const light = this.palette.lighting;
        this.hemiLight = new THREE.HemisphereLight(light.hemiSky, light.hemiGround, light.hemiIntensity);
        this.scene.add(this.hemiLight);

        this.keyLight = new THREE.DirectionalLight(light.keyColor, light.keyIntensity);
        this.keyLight.position.set(60, 90, 40);
        this.scene.add(this.keyLight);

        this.fillLight = new THREE.DirectionalLight(light.fillColor, light.fillIntensity);
        this.fillLight.position.set(-50, 30, -40);
        this.scene.add(this.fillLight);
    }

    /** Ground grid in inches, muted so parts read as the focus. */
    private addGrid(): void {
        this.grid = new THREE.GridHelper(240, 40, this.palette.gridMajor, this.palette.gridMinor);
        (this.grid.material as THREE.Material).transparent = true;
        (this.grid.material as THREE.Material).opacity = 0.5;
        this.grid.name = 'ground-grid';
        this.scene.add(this.grid);
    }

    /**
     * Swaps the scene's theme colours in place (D74). Retints rather than rebuilds, so a theme
     * flip never moves the camera or re-runs CSG. Transient objects (drag ghost, snap guides,
     * placement preview) are not touched: they are rebuilt from the palette on the next pointer
     * move, and none of them outlive the gesture that drew them.
     */
    setScenePalette(palette: ScenePalette): void {
        this.palette = palette;
        (this.scene.background as THREE.Color).setHex(palette.background);

        if (this.grid !== null) {
            // GridHelper bakes its two colours into vertex colours, so retinting means rebuilding
            // its geometry — cheap, and it owns no state worth preserving.
            this.scene.remove(this.grid);
            this.grid.geometry.dispose();
            (this.grid.material as THREE.Material).dispose();
            this.grid = null;
            this.addGrid();
        }

        const light = palette.lighting;
        if (this.hemiLight !== null) {
            this.hemiLight.color.setHex(light.hemiSky);
            this.hemiLight.groundColor.setHex(light.hemiGround);
            this.hemiLight.intensity = light.hemiIntensity;
        }
        if (this.keyLight !== null) {
            this.keyLight.color.setHex(light.keyColor);
            this.keyLight.intensity = light.keyIntensity;
        }
        if (this.fillLight !== null) {
            this.fillLight.color.setHex(light.fillColor);
            this.fillLight.intensity = light.fillIntensity;
        }

        // The persistent, palette-coloured overlays have to be redrawn from current state.
        this.applyHighlight();
        this.applyAiHighlights();
        this.drawDimensionObjects();
        this.requestRender();
    }

    /**
     * Replaces the rendered design. Disposes the previous parts first. Framing is opt-in
     * (frame on first load / fixture switch, not on every property edit — that would jerk
     * the camera). Re-applies the current selection highlight after rebuilding.
     */
    loadSpec(spec: Spec, options: { frame?: boolean } = {}): void {
        this.clearParts();
        this.partDims.clear();
        this.partById.clear();
        const thicknessById = new Map(spec.materials.map((m) => [m.id, m.thickness]));
        for (const part of spec.parts) {
            this.partDims.set(part.id, {
                l: part.size.l,
                w: part.size.w,
                thickness: thicknessById.get(part.materialId) ?? 0.75,
            });
            this.partById.set(part.id, part);
        }
        // A spec reload can drop/rename measured parts — rebuild the ruler against the new scene.
        this.refreshMeasurements();
        this.partsGroup = buildSpecGroup(spec, this.materialProvider);
        // Meshes are built at their authored (spec) pose; remember it so the view transforms
        // (explode, open) can offset from — and return exactly to — it.
        for (const child of this.partsGroup.children) {
            child.userData.basePos = [child.position.x, child.position.y, child.position.z];
            const q = child.quaternion;
            child.userData.baseQuat = [q.x, q.y, q.z, q.w];
        }
        this.scene.add(this.partsGroup);
        this.currentSpec = spec;
        this.applyPose();
        this.applyVisibility(); // hidden ids are keyed by part id, so they outlive a rebuild
        if (options.frame === true) {
            this.frameToParts();
        }
        this.applyHighlight();
        this.applyAiHighlights(); // re-outline diffed parts after a rebuild (ids persist)
        this.requestRender();
        this.applyCsgOps(spec);
    }

    /**
     * Sets the exploded-view factor (0 = assembled, 1 = fully exploded). Presentation only:
     * meshes translate away from the assembly centre; the spec keeps its authored transforms.
     */
    setExplode(factor: number): void {
        const clamped = Math.min(1, Math.max(0, factor));
        if (clamped === this.explodeFactor) {
            return;
        }
        this.explodeFactor = clamped;
        this.cancelDrag(); // a live drag would otherwise commit an exploded position
        if (clamped > 0) {
            this.openFactor = 0; // an exploded door has no hinge line to swing on
            this.cancelPlacement(); // placement coords through separated parts would mislead
            if (this.measuring) {
                this.setMeasuring(false); // measured distances through separated parts would mislead
            }
        }
        this.applyPose();
        this.applyAiHighlights(); // BoxHelpers wrap moved meshes — rebuild so they follow
        this.requestRender();
    }

    getExplode(): number {
        return this.explodeFactor;
    }

    /**
     * Swings doors and slides drawers open (0 = shut, 1 = fully open). Presentation only (§3.3):
     * the spec keeps the closed transforms, so a design is never saved mid-swing.
     */
    setOpen(factor: number): void {
        const clamped = Math.min(1, Math.max(0, factor));
        if (clamped === this.openFactor) {
            return;
        }
        this.openFactor = clamped;
        this.cancelDrag(); // a drop mid-swing would commit the opened position
        if (clamped > 0) {
            this.explodeFactor = 0; // the two views are mutually exclusive
            this.cancelPlacement(); // an op placed on a swung door would land at the wrong spot
            if (this.measuring) {
                this.setMeasuring(false);
            }
        }
        this.applyPose();
        this.applyAiHighlights();
        this.requestRender();
    }

    getOpen(): number {
        return this.openFactor;
    }

    /**
     * Hides part meshes so the user can see past them — a back panel out of the way of the shelf
     * behind it. Presentation only, and the strictest sense of it: hiding changes what is drawn
     * and nothing else. The spec is untouched, so the cut list still lists a hidden part, the
     * linter still judges it, and it is still built. Ids that are not in the spec are kept
     * anyway — a part hidden before an AI edit that briefly drops it comes back hidden.
     */
    setHidden(ids: Iterable<string>): void {
        const next = new Set(ids);
        const same = next.size === this.hiddenIds.size && [...next].every((id) => this.hiddenIds.has(id));
        if (same) {
            return;
        }
        this.hiddenIds = next;
        this.cancelDrag(); // dragging something invisible is how a part ends up somewhere absurd
        this.applyVisibility();
        this.applyAiHighlights(); // a BoxHelper around a hidden mesh would outline nothing
        this.requestRender();
    }

    /** The ids currently hidden (a copy — callers must not reach into the engine's state). */
    getHidden(): Set<string> {
        return new Set(this.hiddenIds);
    }

    /** Hides these on top of whatever is already hidden. */
    hide(ids: Iterable<string>): void {
        this.setHidden([...this.hiddenIds, ...ids]);
    }

    /** Shows only these: everything else in the spec goes away (the "look at this one" gesture). */
    isolate(ids: Iterable<string>): void {
        const keep = new Set(ids);
        if (keep.size === 0 || this.currentSpec === null) {
            return;
        }
        this.setHidden(this.currentSpec.parts.map((p) => p.id).filter((id) => !keep.has(id)));
    }

    showAll(): void {
        this.setHidden([]);
    }

    /**
     * The meshes a click may land on. A hidden part is not merely undrawn — it is out of the way,
     * so a click reaches whatever stands behind it, which is the entire point of hiding it.
     */
    private pickableParts(): THREE.Object3D[] {
        return this.partsGroup === null
            ? []
            : this.partsGroup.children.filter((child) => !this.hiddenIds.has(child.name));
    }

    /** Applies the hidden set to the meshes. Called on every rebuild so it survives a spec change. */
    private applyVisibility(): void {
        if (this.partsGroup === null) {
            return;
        }
        for (const child of this.partsGroup.children) {
            child.visible = !this.hiddenIds.has(child.name);
        }
    }

    /**
     * Puts every part mesh where the active view says it goes: back at its authored pose first,
     * then exploded or opened. Resetting first is what makes both views exactly reversible and
     * lets one replace the other without the offsets compounding.
     */
    private applyPose(): void {
        if (this.partsGroup === null) {
            return;
        }
        for (const child of this.partsGroup.children) {
            const basePos = child.userData.basePos as Vec3 | undefined;
            if (basePos !== undefined) {
                child.position.set(basePos[0], basePos[1], basePos[2]);
            }
            const baseQuat = child.userData.baseQuat as [number, number, number, number] | undefined;
            if (baseQuat !== undefined) {
                child.quaternion.set(baseQuat[0], baseQuat[1], baseQuat[2], baseQuat[3]);
            }
        }

        if (this.explodeFactor > 0) {
            const sources = this.partsGroup.children.map((child) => ({
                id: child.name,
                pos: (child.userData.basePos ?? [
                    child.position.x,
                    child.position.y,
                    child.position.z,
                ]) as Vec3,
            }));
            const positions = explodedPositions(sources, this.explodeFactor);
            for (const child of this.partsGroup.children) {
                const pos = positions.get(child.name);
                if (pos !== undefined) {
                    child.position.set(pos[0], pos[1], pos[2]);
                }
            }
            return;
        }

        if (this.openFactor > 0 && this.currentSpec !== null) {
            const poses = openedPoses(this.currentSpec, this.openFactor);
            for (const child of this.partsGroup.children) {
                const pose = poses.get(child.name);
                if (pose !== undefined) {
                    child.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
                    child.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
                }
            }
        }
    }

    /**
     * Cuts the boolean ops asynchronously via the CSG worker (never on the main thread), swapping
     * in the cut geometry when it returns. Results after a newer loadSpec are discarded.
     *
     * That is every part's holes, plus the channels of a shaped part — whose mesh came off the
     * outline-extrude path as a full-thickness blank (D72). A rectangular part's channels are
     * already in its mesh, cut procedurally, and must not be sent here.
     */
    private applyCsgOps(spec: Spec): void {
        const generation = (this.csgGeneration += 1);
        const materials = new Map<string, Material>(spec.materials.map((m) => [m.id, m]));

        for (const part of spec.parts) {
            const holes = holeSpecsOf(part);
            const channels = csgChannelsOf(part);
            const material = materials.get(part.materialId);
            const mesh = this.partsGroup?.getObjectByName(part.id) as THREE.Mesh | undefined;
            if (
                (holes.length === 0 && channels.length === 0) ||
                material === undefined ||
                mesh === undefined
            ) {
                continue;
            }
            const dims = { l: part.size.l, w: part.size.w, thickness: material.thickness };
            // The cut geometry is a pure function of the blank and every op on it, so the whole
            // ops array goes into the key — channels included, and in their authored order.
            const key = `${part.id}|${material.thickness}|${part.size.l}x${part.size.w}|${JSON.stringify(part.ops)}`;
            void (this.partCsg ??= new PartCsg(this.csgWorkerFactory))
                .subtract(key, mesh.geometry, holes, channels, dims)
                .then((geometry) => {
                    const current = this.partsGroup?.getObjectByName(part.id) as THREE.Mesh | undefined;
                    if (this.disposed || generation !== this.csgGeneration || current === undefined) {
                        geometry.dispose();
                        return;
                    }
                    current.geometry.dispose();
                    current.geometry = geometry;
                    this.requestRender();
                });
        }
    }

    /** Captures the current 3D view as a downscaled PNG for the project thumbnail (§7.2). */
    async snapshot(maxSize = 512): Promise<Blob | null> {
        if (this.disposed) {
            return null;
        }
        this.renderer.render(this.scene, this.camera); // ensure the buffer holds the latest frame
        const src = this.canvas;
        if (src.width === 0 || src.height === 0) {
            return null;
        }
        const scale = Math.min(1, maxSize / Math.max(src.width, src.height));
        const target = document.createElement('canvas');
        target.width = Math.max(1, Math.round(src.width * scale));
        target.height = Math.max(1, Math.round(src.height * scale));
        const ctx = target.getContext('2d');
        if (ctx === null) {
            return null;
        }
        ctx.drawImage(src, 0, 0, target.width, target.height);
        return new Promise<Blob | null>((resolve) => target.toBlob(resolve, 'image/png'));
    }

    /** Sets which parts are highlighted as selected (a group highlights all its members). */
    setSelected(ids: readonly string[]): void {
        this.selectedIds = new Set(ids);
        this.applyHighlight();
        this.requestRender();
    }

    /** Re-centers and re-frames the camera on the current parts (explicit). */
    frame(): void {
        this.frameToParts();
        this.requestRender();
    }

    /** Outlines the given parts to show what an AI edit changed (§5). Pass [] to clear. */
    setHighlight(ids: string[]): void {
        this.highlightIds = [...ids];
        this.applyAiHighlights();
        this.requestRender();
    }

    private applyAiHighlights(): void {
        this.disposeHighlights();
        if (this.partsGroup === null) {
            return;
        }
        for (const id of this.highlightIds) {
            const mesh = this.partsGroup.getObjectByName(id);
            if (mesh !== undefined) {
                const helper = new THREE.BoxHelper(mesh, this.palette.selection);
                (helper.material as THREE.LineBasicMaterial).depthTest = false;
                this.highlights.add(helper);
            }
        }
    }

    private disposeHighlights(): void {
        for (const child of this.highlights.children) {
            const helper = child as THREE.BoxHelper;
            helper.geometry.dispose();
            (helper.material as THREE.Material).dispose();
        }
        this.highlights.clear();
    }

    /** Dismisses the AI diff outlines (called when the user next interacts). */
    private clearHighlight(): void {
        if (this.highlightIds.length === 0) {
            return;
        }
        this.highlightIds = [];
        this.disposeHighlights();
        this.requestRender();
    }

    /**
     * Marks the selected meshes: an emissive tint plus a two-tone outline (D75).
     *
     * The emissive alone was never a sufficient signal — added to a mid-tone wood it lands around
     * 1.4:1 against the unselected surface, well under the 3:1 WCAG asks of a UI state, and it is
     * weakest on the palest species. The outline carries the signal instead; the tint stays
     * because it still reads at a glance on a part turned away from the light.
     */
    private applyHighlight(): void {
        if (this.partsGroup === null) {
            return;
        }
        for (const child of this.partsGroup.children) {
            const material = (child as THREE.Mesh).material;
            if (Array.isArray(material) || material === undefined) {
                continue;
            }
            const standard = material as THREE.MeshStandardMaterial;
            if (standard.emissive === undefined) {
                continue;
            }
            const selected = this.selectedIds.has(child.name);
            standard.emissive.setHex(selected ? this.palette.selection : 0x000000);
            standard.emissiveIntensity = selected ? 0.4 : 0;
        }
        this.applySelectionOutlines();
    }

    /**
     * Rebuilds the selection outlines. Each is two `LineSegments` over the part's own edges — a
     * casing scaled a hair proud of the core — parented to the mesh so they inherit its transform
     * and follow a drag or a rotation without any per-frame work. Built from the live geometry, so
     * a notch or a curve is outlined as cut rather than boxed.
     */
    private applySelectionOutlines(): void {
        this.disposeSelectionOutlines();
        if (this.partsGroup === null) {
            return;
        }
        for (const child of this.partsGroup.children) {
            const mesh = child as THREE.Mesh;
            if (!this.selectedIds.has(mesh.name) || mesh.geometry === undefined) {
                continue;
            }
            const edges = new THREE.EdgesGeometry(mesh.geometry, 20);
            for (const [color, scale] of [
                [this.palette.selectionCasing, 1.012],
                [this.palette.selectionCore, 1.0],
            ] as const) {
                const line = new THREE.LineSegments(
                    edges,
                    new THREE.LineBasicMaterial({ color, depthTest: true }),
                );
                line.scale.setScalar(scale);
                line.name = SELECTION_OUTLINE;
                // Draw after the parts so the core wins the z-fight with its own casing.
                line.renderOrder = 1;
                mesh.add(line);
            }
            // Both lines share the geometry; tag it so disposal frees it exactly once.
            this.selectionOutlineGeometries.push(edges);
        }
    }

    private disposeSelectionOutlines(): void {
        this.partsGroup?.children.forEach((child) => {
            const outlines = child.children.filter((c) => c.name === SELECTION_OUTLINE);
            for (const outline of outlines) {
                child.remove(outline);
                ((outline as THREE.LineSegments).material as THREE.Material).dispose();
            }
        });
        for (const geometry of this.selectionOutlineGeometries) {
            geometry.dispose();
        }
        this.selectionOutlineGeometries = [];
    }

    /** Positions the camera + orbit target to frame the current parts. */
    private frameToParts(): void {
        if (this.partsGroup === null || this.partsGroup.children.length === 0) {
            return;
        }
        const box = new THREE.Box3().setFromObject(this.partsGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z, 1);
        const distance = radius * 2.2;

        this.controls.target.copy(center);
        this.camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.85, distance));
        this.camera.near = Math.max(radius / 100, 0.5);
        this.camera.far = distance * 12;
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    /** Schedules a single render on the next frame (dirty flag). */
    requestRender = (): void => {
        if (this.renderScheduled || this.disposed) {
            return;
        }
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.renderScheduled = false;
            if (this.disposed) {
                return;
            }
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
            // Re-project ruler labels so they stay pinned to their 3D points as the camera moves.
            if (this.liveDimensions.length > 0) {
                this.emitMeasureLabels();
            }
        });
    };

    /** Matches the drawing buffer to the canvas's CSS size. */
    resize(): void {
        const width = this.canvas.clientWidth || 1;
        const height = this.canvas.clientHeight || 1;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }

    private clearParts(): void {
        if (this.partsGroup === null) {
            return;
        }
        // Before the group goes: `disposeObject` would free the outlines' geometry as it recurses,
        // but the bookkeeping array would keep pointing at it.
        this.disposeSelectionOutlines();
        this.scene.remove(this.partsGroup);
        disposeObject(this.partsGroup);
        this.partsGroup = null;
    }

    /** Releases all GPU/DOM resources. Safe to call once. */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.cancelLongPress();
        this.clearDrag();
        this.placement = null;
        this.disposePlacementGhost();
        this.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
        this.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
        this.canvas.removeEventListener('pointercancel', this.onPointerUp);
        this.canvas.removeEventListener('contextmenu', this.onContextMenu);
        this.resizeObserver.disconnect();
        this.controls.removeEventListener('change', this.requestRender);
        this.controls.dispose();
        this.disposeHighlights();
        this.clearDimensionObjects();
        this.clearParts();
        this.grain?.dispose();
        this.partCsg?.dispose();
        this.renderer.dispose();
    }
}

/** Extracts a part's hole ops as worker-serializable hole specs (§3.1). */
function holeSpecsOf(part: Part): HoleSpec[] {
    return (part.ops ?? [])
        .filter((op): op is Extract<typeof op, { type: 'hole' }> => op.type === 'hole')
        .map((op) => ({ face: op.face, x: op.x, y: op.y, diameter: op.diameter, depth: op.depth }));
}

/**
 * The channel ops the CSG worker has to cut (D72). Only a shaped part — one carrying a curve or a
 * notch — reaches the renderer as a full-thickness extruded blank; every other part had its
 * channels slabbed procedurally by `buildPartGeometry`, and cutting them a second time would just
 * burn a boolean on material that is already gone.
 */
function csgChannelsOf(part: Part): ChannelSpec[] {
    const ops = part.ops ?? [];
    if (!ops.some((op) => op.type === 'curve' || op.type === 'notch')) {
        return [];
    }
    return ops.filter(isChannel);
}

/** Recursively disposes geometries, materials and their maps under an object. */
function disposeObject(root: THREE.Object3D): void {
    root.traverse((obj) => {
        const mesh = obj as Partial<THREE.Mesh>;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
            material.forEach(disposeMaterial);
        } else if (material) {
            disposeMaterial(material);
        }
    });
}

function disposeMaterial(material: THREE.Material): void {
    const withMap = material as THREE.MeshStandardMaterial;
    withMap.map?.dispose();
    material.dispose();
}
