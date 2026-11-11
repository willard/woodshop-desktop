/** Public surface of the framework-agnostic editor engine. */
export { EditorEngine } from './EditorEngine';
export type {
    EditorEngineOptions,
    DragInfo,
    PickModifiers,
    PlacementRequest,
    PlacementPreview,
    MeasureLabel,
    MeasureMode,
} from './EditorEngine';
export { DARK_SCENE, LIGHT_SCENE, scenePalette } from './theme';
export type { ScenePalette, ThemeName } from './theme';
export type { Dimension } from './measure';
export { faceHitToOpCoords } from './placement';
export type { FaceHit } from './placement';
export { EditorDocument } from './EditorDocument';
export type { DocumentListener } from './EditorDocument';
export { computeSnap, aabbFromPart, halfExtentsOf, pushOutDelta } from './snapping';
export type { AABB, Vec3, SnapResult, AxisSnap, SnapKind } from './snapping';
export { detectDadoJoints, detectPocketScrewJoints, detectScrewJoints, mergeJoints } from './joints';
export { planDowels, touchingParts } from './dowels';
export type { DowelPlan, DowelResult } from './dowels';
export { planScrews, planPocketScrews } from './screws';
export type { ScrewPlan, PocketScrewPlan, ScrewResult } from './screws';
export { overlappingParts, notchForOverlap } from './notch';
export type { OverlapCandidate } from './notch';
export { enterFocusMode, exitFocusMode } from './focus';
export type { FocusState } from './focus';
export { explodedPositions, EXPLODE_SPREAD } from './explode';
export type { ExplodeSource } from './explode';
export { openedPoses, doorHinge, hingeLineLocal } from './open';
export type { OpenPose } from './open';
export {
    detectOpening,
    planMovable,
    defaultMovableOptions,
    hingeEdgeFor,
    frontAllowance,
} from './movablePresets';
export type { Opening, MovableOptions, MovablePlan, HingeSide, MovableStyle } from './movablePresets';
export {
    DEFAULT_SNAP_CONFIG,
    DEFAULT_NOTCH_CONFIG,
    DEFAULT_DOWEL_CONFIG,
    DEFAULT_SCREW_CONFIG,
    DEFAULT_EASE_CONFIG,
    DEFAULT_NUDGE_CONFIG,
    DEFAULT_OPEN_CONFIG,
    GRID_SIZES,
    SNAP_GAPS,
    METRIC_GRID_SIZES,
    METRIC_SNAP_GAPS,
    WORKSPACE_POS_BOUND,
} from './config';
export { cohortOf, cohortsOf } from './cohort';
export { screenAxes, nudgeStep, nudgeDelta, clampToWorkspace } from './nudge';
export type { ScreenAxes } from './nudge';
export { easeLabel, easeSize, easeFaces, maxEaseSize } from './ease';
export type { EaseOp, EaseSample, EdgeEase } from './ease';
export type { NotchConfig, DowelConfig, ScrewConfig, EaseConfig, NudgeConfig, OpenConfig } from './config';
export type { SnapConfig } from './config';
export { buildSpecGroup, buildPartMesh } from './buildScene';
export {
    woodMaterialProvider,
    createFlatWoodMaterial,
    createGrainTexture,
    woodColorFor,
    type MaterialProvider,
} from './materials';
export {
    AddPart,
    AddParts,
    RemovePart,
    DuplicatePart,
    ResizePart,
    RotatePart,
    MovePart,
    AddOp,
    AddDowelJoint,
    AddScrewJoint,
    RemoveOp,
    SetMaterial,
    DeleteMaterial,
    SetPartSpecies,
    SetPartStock,
    SetPartRoundStock,
    SetGrainAxis,
    SetJoints,
    MakeMovable,
    AddMovable,
    DissolveMovable,
    UpdateMovable,
    movableOf,
    uniqueMovableId,
    AddHardware,
    UpdateHardware,
    RemoveHardware,
    uniqueHardwareId,
    GroupParts,
    UngroupParts,
    MoveParts,
    RotateParts,
    RemoveParts,
    DuplicateGroup,
    groupOf,
    RecenterAssembly,
    RenamePart,
    RenameGroup,
    ApplyFocusEdits,
    makePart,
    uniquePartId,
    uniquePartIdFrom,
    uniqueGroupId,
    type Command,
    type NewPartOptions,
    type HardwarePatch,
} from './commands';
export {
    PART_KINDS,
    PART_PRESETS,
    defaultOptions,
    planParts,
    rotationFor,
    type PartKind,
    type Orientation,
    type PartPreset,
    type AddPartOptions,
    type PartPlan,
} from './presets';
