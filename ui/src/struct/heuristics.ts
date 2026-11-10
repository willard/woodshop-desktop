/**
 * Tier-1 heuristics: carpenter rules-of-thumb, not physics. Each is gated to keep the
 * false-positive rate low — a missed warning is cheaper than a nagging wrong one.
 */
import type { Spec } from '../spec/types';
import { formatFraction } from '../lib/fraction';
import type { StructConfig, StructIssue } from './types';
import { extent, unionBox, type PlacedPart } from './placed';

/** Tall assembly on a small footprint — assembly-level, so no partId. */
export function checkTipping(placed: PlacedPart[], config: StructConfig, issues: StructIssue[]): void {
    if (placed.length < 2) {
        return;
    }
    const overall = unionBox(placed);
    if (overall === null) {
        return;
    }
    const height = extent(overall, 1);
    const footprint = Math.min(extent(overall, 0), extent(overall, 2));
    if (footprint > 0 && height / footprint > config.tippingRatio) {
        issues.push({
            severity: 'warn',
            code: 'struct.tipping',
            message: `Assembly is ${formatFraction(height)}" tall on a ${formatFraction(footprint)}" deep footprint — it could tip forward; consider anchoring it to the wall.`,
        });
    }
}

/** Long thin vertical sticks (legs, posts) that may flex under load. */
export function checkSlenderness(placed: PlacedPart[], config: StructConfig, issues: StructIssue[]): void {
    for (const { part, thickness, axes } of placed) {
        const longDim = Math.max(part.size.l, part.size.w);
        const crossA = Math.min(part.size.l, part.size.w);
        if (crossA > config.stickMaxWidth) {
            continue; // panel, not a stick
        }
        const longAxisWorld = part.size.l >= part.size.w ? axes[0] : axes[1];
        if (Math.abs(longAxisWorld[1]) <= 0.95) {
            continue; // not vertical — rails and stretchers don't carry column loads
        }
        const cross = Math.min(crossA, thickness);
        if (cross > 0 && longDim / cross > config.slendernessRatio) {
            issues.push({
                severity: 'warn',
                code: 'struct.slender',
                message: `"${part.name}" is ${formatFraction(longDim)}" long but only ${formatFraction(cross)}" thick — it may flex; use thicker stock.`,
                partId: part.id,
            });
        }
    }
}

/**
 * A rail lying in the racking plane: runs most of the face's width, and is deep enough
 * vertically that its end joints can carry a moment. Shelves and tabletops fail the
 * depth gate (their vertical extent is just stock thickness), so only real aprons,
 * stretchers, and rails count.
 */
function isStretcherInFace(
    { box }: PlacedPart,
    faceInPlaneAxis: number,
    faceWidth: number,
    config: StructConfig,
): boolean {
    return (
        extent(box, faceInPlaneAxis) >= config.rackingStretcherSpanFrac * faceWidth &&
        extent(box, 1) >= config.rackingStretcherMinDepth
    );
}

/**
 * Two stretchers, upper and lower, bracing the same plane — the carpenter's rule of
 * thumb for a rigid screwed frame (a workbench with aprons top and bottom). The pair
 * must be separated vertically (adjacent aprons at one height brace nothing) and must
 * overlap along the face normal, since a front top rail and a back bottom rail stiffen
 * different planes.
 */
function hasPairedStretchers(
    placed: PlacedPart[],
    faceNormalAxis: number,
    faceInPlaneAxis: number,
    faceWidth: number,
    height: number,
    config: StructConfig,
): boolean {
    const rails = placed.filter((p) => isStretcherInFace(p, faceInPlaneAxis, faceWidth, config));
    const centerY = ({ box }: PlacedPart) => (box.min[1] + box.max[1]) / 2;
    for (let i = 0; i < rails.length; i += 1) {
        for (let j = i + 1; j < rails.length; j += 1) {
            const a = rails[i].box;
            const b = rails[j].box;
            if (Math.abs(centerY(rails[i]) - centerY(rails[j])) < config.rackingStretcherRiseFrac * height) {
                continue;
            }
            if (
                a.min[faceNormalAxis] > b.max[faceNormalAxis] ||
                b.min[faceNormalAxis] > a.max[faceNormalAxis]
            ) {
                continue; // different planes
            }
            return true;
        }
    }
    return false;
}

/**
 * Open frame with nothing to resist side-to-side racking. Deliberately conservative —
 * fires only when the assembly is tall, has no interlocking joinery (dado/rabbet), no
 * shear panel covering the largest vertical face, and no upper/lower stretcher pair
 * bracing it. Diagonal braces are not detected as such (tilted parts read as fat
 * AABBs), though a long, deep one may earn stretcher credit — see D38, D56.
 */
export function checkRacking(
    spec: Spec,
    placed: PlacedPart[],
    config: StructConfig,
    issues: StructIssue[],
): void {
    if (placed.length < 4) {
        return;
    }
    const overall = unionBox(placed);
    if (overall === null || extent(overall, 1) < config.rackingMinHeight) {
        return;
    }
    if ((spec.joints ?? []).some((j) => j.type === 'dado' || j.type === 'rabbet')) {
        return;
    }
    // Largest vertical face is perpendicular to the smaller horizontal axis (the depth).
    const faceNormalAxis = extent(overall, 0) <= extent(overall, 2) ? 0 : 2;
    const faceInPlaneAxis = faceNormalAxis === 0 ? 2 : 0;
    const height = extent(overall, 1);
    const faceWidth = extent(overall, faceInPlaneAxis);
    const faceArea = faceWidth * height;
    if (faceArea <= 0) {
        return;
    }
    if (hasPairedStretchers(placed, faceNormalAxis, faceInPlaneAxis, faceWidth, height, config)) {
        return;
    }
    for (const { box, axes } of placed) {
        const thicknessDir = axes[2];
        if (Math.abs(thicknessDir[1]) >= 0.1) {
            continue; // thickness not horizontal — not a vertical panel
        }
        if (Math.abs(thicknessDir[faceNormalAxis]) <= 0.9) {
            continue; // faces the wrong way
        }
        const coverage = (extent(box, faceInPlaneAxis) * extent(box, 1)) / faceArea;
        if (coverage >= config.rackingCoverageFrac) {
            return; // shear panel found
        }
    }
    issues.push({
        severity: 'warn',
        code: 'struct.racking',
        message:
            'Open frame with no back panel or interlocking joinery — it may rack side-to-side; add a back panel, stretchers, or a diagonal brace.',
    });
}
