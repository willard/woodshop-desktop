/**
 * Editor tunables (CLAUDE.md: config over constants — kerf, snap thresholds, grid sizes).
 * All distances are decimal inches (hard rule 3).
 */
export interface SnapConfig {
    /** Face-to-face snap engages within this gap (build-plan §4.2 default 0.5"). */
    faceThreshold: number;
    /** Edge/center alignment guide engages within this distance. */
    alignThreshold: number;
    /** Grid cell size; 0 disables grid snap. */
    gridSize: number;
    /** Target gap (inches) a face snap holds instead of flush; 0 = flush only (default). */
    faceGap: number;
    /** Master toggles per snap tier (priority order: face → align → grid). */
    faceSnap: boolean;
    alignSnap: boolean;
    gridSnap: boolean;
}

/** Selectable grid sizes for the UI (1/16", 1/8", 1/4"). */
export const GRID_SIZES = [0.0625, 0.125, 0.25] as const;

/** Selectable snap gaps for the UI (0 = flush; 1/16"…1/2"). Slats want a small even gap. */
export const SNAP_GAPS = [0, 0.0625, 0.125, 0.25, 0.375, 0.5] as const;

/** The same choices for someone working in millimetres: 1, 2, 5 and 10 mm grids. */
export const METRIC_GRID_SIZES = [1, 2, 5, 10].map((mm) => mm / 25.4);

/** Metric snap gaps: flush, then 1–10 mm. */
export const METRIC_SNAP_GAPS = [0, 1, 2, 3, 5, 10].map((mm) => mm / 25.4);

/**
 * Workspace bound for part centres: spec.schema.json limits every transform.pos
 * component to ±240". Drags must clamp to this so a commit can never fail validation.
 */
export const WORKSPACE_POS_BOUND = 240;

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
    faceThreshold: 0.5,
    alignThreshold: 0.25,
    gridSize: 0.125, // 1/8" default (build-plan §4.2)
    faceGap: 0, // flush by default; the user picks a gap (e.g. 1/4") for slats
    faceSnap: true,
    alignSnap: true,
    gridSnap: true,
};

/** Dowel-joint ("dowel to part") tunables. */
export interface DowelConfig {
    /** Hole diameter — 3/8" stock dowel. */
    diameter: number;
    /** Target center-to-center spacing along the contact run. */
    spacing: number;
    /** Inset of the end dowels from the contact ends (shrinks on short runs). */
    endInset: number;
    /** Blind depth stops this shy of the show face. */
    reveal: number;
}

export const DEFAULT_DOWEL_CONFIG: DowelConfig = {
    diameter: 0.375,
    spacing: 8,
    endInset: 1,
    reveal: 0.125,
};

/**
 * How fasteners are *spaced* along a joint. What size they are lives in
 * `resources/js/spec/fasteners.ts`, shared with the cut list's hardware list (§3.1 fasteners).
 */
export interface ScrewConfig {
    /** Target centre-to-centre spacing along the joint. */
    spacing: number;
    /** Inset of the end screws from the joint's ends (shrinks on short runs). */
    endInset: number;
    /** A run shorter than this gets a single screw. */
    minRunForTwo: number;
}

export const DEFAULT_SCREW_CONFIG: ScrewConfig = {
    spacing: 6,
    endInset: 1,
    minRunForTwo: 1.25,
};

/** Arrow-key nudge tunables. The base step is the snap grid, so nudging and dragging agree. */
export interface NudgeConfig {
    /** Shift multiplies the grid step — 8 × 1/8" lands on 1". */
    coarseMultiplier: number;
    /** Alt/Option step, for seating a part that is a hair out. */
    fineStep: number;
    /** Step used when grid snap is switched off entirely. */
    fallbackStep: number;
    /** A burst of presses this close together collapses into one undo entry (milliseconds). */
    coalesceMs: number;
}

export const DEFAULT_NUDGE_CONFIG: NudgeConfig = {
    coarseMultiplier: 8,
    fineStep: 0.015625, // 1/64"
    fallbackStep: 0.125,
    coalesceMs: 700,
};

/** Eased-edge (router "soft edge") tunables — spec 1.10. */
export interface EaseConfig {
    /** Facets across a roundover's quarter-circle. Six reads as round at furniture scale. */
    segments: number;
    /** Radius the editor offers first: a 1/4" roundover, the most common bit in the drawer. */
    defaultRadius: number;
    /**
     * Taper at each stopped end of a run, in multiples of the profile size. A bearing-guided bit
     * cannot stop dead — lifting it out leaves a run-out about as long as the cut is deep.
     */
    runOut: number;
}

export const DEFAULT_EASE_CONFIG: EaseConfig = {
    segments: 6,
    defaultRadius: 0.25,
    runOut: 1,
};

/** Open/close view tunables for doors and drawers (§3.3, spec 1.12). */
export interface OpenConfig {
    /** How far a door swings at full open — a typical cup hinge's opening. */
    doorSwingDeg: number;
    /** How much of its own depth a drawer pulls out; short of 1 so it stays in its slides. */
    drawerTravelFraction: number;
}

export const DEFAULT_OPEN_CONFIG: OpenConfig = {
    doorSwingDeg: 105,
    drawerTravelFraction: 0.8,
};

/** Auto-notch ("notch around part") tunables. */
export interface NotchConfig {
    /** Clearance added per side and to depth so the mate actually slides in (slip fit). */
    clearance: number;
}

export const DEFAULT_NOTCH_CONFIG: NotchConfig = {
    clearance: 0.0625, // 1/16"
};
