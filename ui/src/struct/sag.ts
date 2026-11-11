/**
 * Tier-2 shelf sag: uniform-load simply-supported beam deflection δ = 5wL⁴/384EI
 * (Sagulator-style). AABB-based and conservative: tilted parts are skipped rather than
 * mis-measured, back-panel stiffening is ignored, load is uniform only. Cantilevers and
 * shelves with big overhangs are skipped in v1 — the linter's part.floating already
 * covers truly detached parts.
 */
import { TOUCH_TOL, separation } from '../spec/geometry';
import { deflection, rectangleInertia } from './beam';
import type { ShelfSagRow, StructConfig, StructIssue } from './types';
import { EPS, extent, type PlacedPart } from './placed';
import { getUnits, len } from '@/lib/display';
import { formatFraction } from '@/lib/fraction';

/** Spans shorter than this are trivially stiff — skip to avoid noise, inches. */
const MIN_SPAN = 12;

/** Fraction of the full extent an end overhang may reach before the shelf is treated as a cantilever. */
const MAX_OVERHANG_FRAC = 0.25;

/** Edge members (back panels, front rails) run most of the span but carry little depth. */
const EDGE_MEMBER_SPAN_FRAC = 0.6;

interface Interval {
    start: number;
    end: number;
}

export function checkSag(placed: PlacedPart[], config: StructConfig, issues: StructIssue[]): ShelfSagRow[] {
    const rows: ShelfSagRow[] = [];
    for (const shelf of placed) {
        const row = analyzeShelf(shelf, placed, config);
        if (row === null) {
            continue;
        }
        rows.push(row);
        if (row.deflection > row.allowed) {
            issues.push({
                severity: 'warn',
                code: 'struct.sag',
                message: `Shelf "${shelf.part.name}" may sag ~${getUnits() === 'fraction' ? `${formatFraction(row.deflection, 32)}"` : len(row.deflection)} over its ${len(row.span)} span under ${config.shelfLoadPerFoot} lb/ft — add a center support, use thicker stock, or shorten the span.`,
                partId: shelf.part.id,
            });
        }
    }
    return rows;
}

function analyzeShelf(shelf: PlacedPart, placed: PlacedPart[], config: StructConfig): ShelfSagRow | null {
    if (Math.abs(shelf.axes[2][1]) <= 0.99) {
        return null; // thickness axis not vertical — not a horizontal surface
    }
    if (shelf.box.min[1] <= TOUCH_TOL) {
        return null; // rests on the floor
    }
    const spanAxis = extent(shelf.box, 0) >= extent(shelf.box, 2) ? 0 : 2;
    const depthAxis = spanAxis === 0 ? 2 : 0;
    const fullLength = extent(shelf.box, spanAxis);
    const depth = extent(shelf.box, depthAxis);
    if (fullLength < MIN_SPAN) {
        return null;
    }

    const supports = findSupports(shelf, placed, spanAxis, depthAxis, config);
    if (supports.length === 0) {
        return null; // cantilever / floating — v1 skips
    }
    const merged = mergeIntervals(supports);
    if (
        merged[0].start - shelf.box.min[spanAxis] > MAX_OVERHANG_FRAC * fullLength ||
        shelf.box.max[spanAxis] - merged[merged.length - 1].end > MAX_OVERHANG_FRAC * fullLength
    ) {
        return null; // big overhang — cantilever territory, v1 skips
    }
    let span = 0;
    for (let i = 1; i < merged.length; i += 1) {
        span = Math.max(span, merged[i].start - merged[i - 1].end);
    }
    if (span <= 0) {
        return null; // continuously supported (or a single support with small overhangs)
    }

    const species = shelf.material.species;
    const modulus =
        species !== undefined
            ? config.speciesE[species]
            : shelf.material.type === 'sheet'
              ? config.sheetE
              : config.lumberDefaultE;
    const inertia = rectangleInertia(depth, shelf.thickness);
    return {
        partId: shelf.part.id,
        span,
        deflection: deflection(
            { kind: 'uniform', perFoot: config.shelfLoadPerFoot },
            span,
            modulus,
            inertia,
            'simple',
        ),
        allowed: (config.sagLimitPerFoot * span) / 12,
        modulus,
    };
}

/**
 * A support touches the shelf, extends below it (to carry load down), and is not a
 * longitudinal edge member. Returned as intervals along the span axis, clipped to the
 * shelf — a side panel meeting the shelf end-on yields a zero-length interval at the end.
 */
function findSupports(
    shelf: PlacedPart,
    placed: PlacedPart[],
    spanAxis: number,
    depthAxis: number,
    config: StructConfig,
): Interval[] {
    const fullLength = extent(shelf.box, spanAxis);
    const depth = extent(shelf.box, depthAxis);
    const supports: Interval[] = [];
    for (const other of placed) {
        if (other.part.id === shelf.part.id) {
            continue;
        }
        if (separation(shelf.box, other.box) > TOUCH_TOL) {
            continue;
        }
        if (other.box.min[1] >= shelf.box.min[1] - EPS) {
            continue; // doesn't extend below the shelf
        }
        const start = Math.max(other.box.min[spanAxis], shelf.box.min[spanAxis]);
        const end = Math.min(other.box.max[spanAxis], shelf.box.max[spanAxis]);
        if (end < start - EPS) {
            continue;
        }
        const depthOverlap =
            Math.min(other.box.max[depthAxis], shelf.box.max[depthAxis]) -
            Math.max(other.box.min[depthAxis], shelf.box.min[depthAxis]);
        if (
            end - start > EDGE_MEMBER_SPAN_FRAC * fullLength &&
            depthOverlap < config.supportDepthFrac * depth
        ) {
            continue; // back panel / front rail — runs the span but doesn't hold the shelf up
        }
        supports.push({ start, end: Math.max(start, end) });
    }
    return supports;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const merged: Interval[] = [];
    for (const interval of sorted) {
        const last = merged[merged.length - 1];
        if (last !== undefined && interval.start <= last.end + EPS) {
            last.end = Math.max(last.end, interval.end);
        } else {
            merged.push({ ...interval });
        }
    }
    return merged;
}
