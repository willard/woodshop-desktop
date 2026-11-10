//! A part's face outline: the blank rectangle reshaped by `curve` ops (whole-edge dome, partial
//! span scallop, corner round, one-sided ramp) and `notch` cutouts. The renderer extrudes it, the
//! SVG shop template draws it — one implementation, so a printed full-size pattern always matches
//! the part on screen.
//!
//! §3.1 local frame: origin at the part centre, length along +X, width along +Y. Scallops and
//! notches resolve per run, so they only conflict where their spans actually overlap. Nothing here
//! changes the blank.

use serde::{Deserialize, Serialize};

use crate::spec::{Curve, Edge, Notch, Op, Part};

/// One step of the closed contour. A `line` names the point it ends at; an `arc` carries what both
/// `THREE.Path.absarc` and an SVG `A` command need. `edge` is provenance: which named edge the walk
/// was on when it emitted this step (a corner round belongs to the edge it turns off).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Segment {
    Line {
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        edge: Option<Edge>,
    },
    Arc {
        cx: f64,
        cy: f64,
        r: f64,
        a0: f64,
        a1: f64,
        clockwise: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        edge: Option<Edge>,
    },
}

impl Segment {
    fn line(p: P) -> Self {
        Segment::Line {
            x: p[0],
            y: p[1],
            edge: None,
        }
    }

    fn arc(c: P, r: f64, a0: f64, a1: f64, clockwise: bool) -> Self {
        Segment::Arc {
            cx: c[0],
            cy: c[1],
            r,
            a0,
            a1,
            clockwise,
            edge: None,
        }
    }

    fn set_edge(&mut self, e: Edge) {
        match self {
            Segment::Line { edge, .. } | Segment::Arc { edge, .. } => *edge = Some(e),
        }
    }

    fn as_point(&self) -> Option<P> {
        match self {
            Segment::Line { x, y, .. } => Some([*x, *y]),
            Segment::Arc { .. } => None,
        }
    }

    /// Whether an arc's numbers are all finite (a line always is).
    pub fn is_finite(&self) -> bool {
        match self {
            Segment::Line { x, y, .. } => x.is_finite() && y.is_finite(),
            Segment::Arc { cx, cy, r, a0, a1, .. } => [cx, cy, r, a0, a1].iter().all(|v| v.is_finite()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Outline {
    /// The blank the outline is cut from — unchanged by any op on it.
    pub l: f64,
    pub w: f64,
    /// Closed contour in CCW walk order; the first segment is always a line (replay can moveTo).
    pub segments: Vec<Segment>,
}

type P = [f64; 2];

/// Corner indices in CCW walk order: c0 (-l/2,-w/2) → c1 (+,-) → c2 (+,+) → c3 (-,+).
pub const EDGE_WALK: [(Edge, usize, usize); 4] =
    [(Edge::L0, 0, 1), (Edge::W1, 1, 2), (Edge::L1, 2, 3), (Edge::W0, 3, 0)];

/// Inward unit normal per edge (toward the part centre).
pub fn edge_inward(edge: Edge) -> P {
    match edge {
        Edge::L0 => [0.0, 1.0],
        Edge::L1 => [0.0, -1.0],
        Edge::W0 => [1.0, 0.0],
        Edge::W1 => [-1.0, 0.0],
    }
}

fn walk_for(edge: Edge) -> (Edge, usize, usize) {
    *EDGE_WALK.iter().find(|w| w.0 == edge).expect("every edge is walked")
}

fn edge_slot(edge: Edge) -> usize {
    EDGE_WALK
        .iter()
        .position(|w| w.0 == edge)
        .expect("every edge is walked")
}

/// The corner index two edges share, or `None` when they're parallel.
pub fn shared_corner(a: Edge, b: Edge) -> Option<usize> {
    let (_, af, at) = walk_for(a);
    let (_, bf, bt) = walk_for(b);
    [af, at].into_iter().find(|&i| i == bf || i == bt)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpanKind {
    Notch,
    Scallop,
}

/// A run along one edge that cuts inward, on the stopped-dado datum.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpanFeature {
    pub kind: SpanKind,
    pub lo: f64,
    pub hi: f64,
    pub depth: f64,
}

#[derive(Clone, Copy)]
struct Ramp {
    height: f64,
    low: Edge,
}

/// Per-edge table indexed by walk slot.
type PerEdge<T> = [Option<T>; 4];

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// A part's outline from its own curve and notch ops.
pub fn for_part(part: &Part) -> Outline {
    let mut curves = Vec::new();
    let mut notches = Vec::new();
    for op in part.ops() {
        match op {
            Op::Curve(c) => curves.push(c.clone()),
            Op::Notch(n) => notches.push(n.clone()),
            _ => {}
        }
    }
    build(part.size.l, part.size.w, &curves, &notches)
}

pub fn build(l: f64, w: f64, curves: &[Curve], notches: &[Notch]) -> Outline {
    let corners: [P; 4] = [
        [-l / 2.0, -w / 2.0],
        [l / 2.0, -w / 2.0],
        [l / 2.0, w / 2.0],
        [-l / 2.0, w / 2.0],
    ];

    let mut domes: PerEdge<f64> = [None; 4];
    let mut ramps: PerEdge<Ramp> = [None; 4];
    let mut scallops_by_edge: [Vec<SpanFeature>; 4] = Default::default();
    let mut corner_radius = [0.0f64; 4];

    for op in curves {
        let edge = op.edge();
        let slot = edge_slot(edge);
        let (span, chord) = if edge.is_l_edge() { (w, l) } else { (l, w) };
        match op {
            Curve::Arc {
                height,
                from: None,
                to: None,
                ..
            } => {
                // Defensive clamp — the linter flags out-of-bounds heights; never self-intersect.
                let h = height.min(span * 0.98);
                domes[slot] = Some(domes[slot].unwrap_or(0.0).max(h));
            }
            Curve::Arc { height, from, to, .. } => {
                // A partial-span arc is a dip in a straight edge: it must NOT move the corners.
                let lo = from.unwrap_or(0.0).min(chord).max(0.0);
                let hi = to.unwrap_or(chord).min(chord).max(0.0);
                let run = hi - lo;
                let depth = height.min(span * 0.98).min(run / 2.0);
                if run < 1e-9 || depth <= 0.0 {
                    continue;
                }
                scallops_by_edge[slot].push(SpanFeature {
                    kind: SpanKind::Scallop,
                    lo,
                    hi,
                    depth,
                });
            }
            Curve::Ramp { height, low, .. } => {
                // Invalid `low` (parallel edge) renders square; the linter errors it.
                if shared_corner(edge, *low).is_some() {
                    ramps[slot] = Some(Ramp {
                        height: height.min(span * 0.98),
                        low: *low,
                    });
                }
            }
            Curve::Round { radius, corner, .. } => {
                let radius = radius.min(if corner.is_some() { chord } else { chord / 2.0 }).min(span);
                let (_, from, to) = walk_for(edge);
                let targets: Vec<usize> = match corner {
                    Some(c) => shared_corner(edge, *c).into_iter().collect(),
                    None => vec![from, to],
                };
                for i in targets {
                    corner_radius[i] = corner_radius[i].max(radius);
                }
            }
        }
    }

    // A WHOLE-EDGE curve on the same edge wins outright and the notch is skipped; a scallop
    // only wins over the stretch it actually covers.
    let whole_edge_curve = |edge: Edge| {
        curves
            .iter()
            .any(|c| c.edge() == edge && !matches!(c, Curve::Arc { from, to, .. } if from.is_some() || to.is_some()))
    };

    let mut notches_by_edge: [Vec<SpanFeature>; 4] = Default::default();
    for op in notches {
        if whole_edge_curve(op.edge) {
            continue;
        }
        let (span, chord) = if op.edge.is_l_edge() { (w, l) } else { (l, w) };
        let lo = op.from.min(chord).max(0.0);
        let hi = op.to.min(chord).max(0.0);
        let depth = op.depth.min(span * 0.98);
        if hi - lo < 1e-9 || depth <= 0.0 {
            continue;
        }
        notches_by_edge[edge_slot(op.edge)].push(SpanFeature {
            kind: SpanKind::Notch,
            lo,
            hi,
            depth,
        });
    }
    for list in &mut notches_by_edge {
        list.sort_by(|a, b| cmp_f64(a.lo, b.lo));
        let mut merged: Vec<SpanFeature> = Vec::with_capacity(list.len());
        for interval in list.iter() {
            match merged.last_mut() {
                // Overlapping runs render as their union at the deeper floor (lint warns).
                Some(last) if interval.lo <= last.hi + 1e-9 => {
                    last.hi = last.hi.max(interval.hi);
                    last.depth = last.depth.max(interval.depth);
                }
                _ => merged.push(*interval),
            }
        }
        *list = merged;
    }

    let features_by_edge = resolve_span_features(scallops_by_edge, notches_by_edge);

    // A DOME pulls both of its edge's corners inward; a ramp pulls only its low corner.
    let mut effective = corners;
    for (edge, from, to) in EDGE_WALK {
        let slot = edge_slot(edge);
        let [nx, ny] = edge_inward(edge);
        if let Some(h) = domes[slot] {
            for i in [from, to] {
                effective[i] = [effective[i][0] + nx * h, effective[i][1] + ny * h];
            }
        }
        if let Some(ramp) = ramps[slot]
            && let Some(i) = shared_corner(edge, ramp.low)
        {
            effective[i] = [effective[i][0] + nx * ramp.height, effective[i][1] + ny * ramp.height];
        }
    }

    // A corner is roundable only when neither adjacent edge is shaped.
    for (edge, from, to) in EDGE_WALK {
        let slot = edge_slot(edge);
        if domes[slot].is_some() || ramps[slot].is_some() || !features_by_edge[slot].is_empty() {
            corner_radius[from] = 0.0;
            corner_radius[to] = 0.0;
        }
    }

    // Defensive: two rounds meeting along one edge must not overlap.
    for (_, from, to) in EDGE_WALK {
        let sum = corner_radius[from] + corner_radius[to];
        let length = (effective[to][0] - effective[from][0]).hypot(effective[to][1] - effective[from][1]);
        if sum > length && sum > 0.0 {
            let scale = length / sum;
            corner_radius[from] *= scale;
            corner_radius[to] *= scale;
        }
    }

    let mut segments = walk_edges(
        l,
        w,
        &effective,
        &corners,
        &corner_radius,
        &domes,
        &ramps,
        &features_by_edge,
    );

    // Only the span-feature walk can leave duplicates and zero-area spikes behind.
    if features_by_edge.iter().any(|f| !f.is_empty()) {
        clean_polyline(&mut segments);
        rotate_to_first_line(&mut segments);
    }

    Outline { l, w, segments }
}

/// Half-open, so features that merely abut are not in conflict.
fn overlaps(a: &SpanFeature, b: &SpanFeature) -> bool {
    a.lo.max(b.lo) < a.hi.min(b.hi) - 1e-9
}

/// Scallops and notches merged into one disjoint, ordered list per edge. A notch overlapping a
/// surviving scallop is dropped WHOLE rather than clipped (clipping would move a notch wall off
/// the datum the author gave it).
fn resolve_span_features(
    mut scallops_by_edge: [Vec<SpanFeature>; 4],
    notches_by_edge: [Vec<SpanFeature>; 4],
) -> [Vec<SpanFeature>; 4] {
    let mut resolved: [Vec<SpanFeature>; 4] = Default::default();
    for slot in 0..4 {
        let candidates = &mut scallops_by_edge[slot];
        candidates.sort_by(|a, b| cmp_f64(a.lo, b.lo));

        let mut scallops: Vec<SpanFeature> = Vec::new();
        for s in candidates.iter() {
            if !scallops.iter().any(|kept| overlaps(kept, s)) {
                scallops.push(*s);
            }
        }
        let mut features = scallops.clone();
        for n in &notches_by_edge[slot] {
            if !scallops.iter().any(|s| overlaps(s, n)) {
                features.push(*n);
            }
        }
        features.sort_by(|a, b| cmp_f64(a.lo, b.lo));
        resolved[slot] = features;
    }
    resolved
}

#[allow(clippy::too_many_arguments)]
fn walk_edges(
    l: f64,
    w: f64,
    effective: &[P; 4],
    corners: &[P; 4],
    corner_radius: &[f64; 4],
    domes: &PerEdge<f64>,
    ramps: &PerEdge<Ramp>,
    features_by_edge: &[Vec<SpanFeature>; 4],
) -> Vec<Segment> {
    let mut segments: Vec<Segment> = Vec::new();

    // Corner position pulled back along the edge toward the other end by its round radius.
    let point = |i: usize, pull_towards: usize| -> P {
        let [x, y] = effective[i];
        let [ox, oy] = effective[pull_towards];
        let len = (ox - x).hypot(oy - y);
        let len = if len == 0.0 { 1.0 } else { len };
        let r = corner_radius[i];
        [x + ((ox - x) / len) * r, y + ((oy - y) / len) * r]
    };

    // Point on the ORIGINAL edge line at datum d.
    let datum_point = |edge: Edge, d: f64| -> P {
        let origin = match edge {
            Edge::L0 => [-l / 2.0, -w / 2.0],
            Edge::L1 => [-l / 2.0, w / 2.0],
            Edge::W0 => [-l / 2.0, -w / 2.0],
            Edge::W1 => [l / 2.0, -w / 2.0],
        };
        if edge.is_l_edge() {
            [origin[0] + d, origin[1]]
        } else {
            [origin[0], origin[1] + d]
        }
    };
    let datum_of = |edge: Edge, p: P| -> f64 {
        if edge.is_l_edge() {
            p[0] + l / 2.0
        } else {
            p[1] + w / 2.0
        }
    };

    for (walk_index, (edge, from, to)) in EDGE_WALK.into_iter().enumerate() {
        let emitted_before = segments.len();
        let slot = edge_slot(edge);
        let a = effective[from];
        let b = effective[to];

        match (domes[slot], ramps[slot]) {
            (None, Some(ramp)) => {
                // One-sided sweep, tangent to the original edge line at the high corner.
                let [nx, ny] = edge_inward(edge);
                let low_idx = shared_corner(edge, ramp.low);
                let high_idx = if low_idx == Some(from) { to } else { from };
                let high = effective[high_idx];
                let other = if low_idx == Some(from) { a } else { b };
                let d = [other[0] - high[0], other[1] - high[1]];
                let dn = d[0] * nx + d[1] * ny;
                segments.push(Segment::line(a));
                if dn > 1e-9 {
                    let r = (d[0] * d[0] + d[1] * d[1]) / (2.0 * dn);
                    segments.push(arc_to([high[0] + nx * r, high[1] + ny * r], r, a, b));
                } else {
                    segments.push(Segment::line(b));
                }
            }
            (Some(_), _) => {
                // Arc through both effective corners and the unmoved edge midpoint.
                let apex = [
                    (corners[from][0] + corners[to][0]) / 2.0,
                    (corners[from][1] + corners[to][1]) / 2.0,
                ];
                segments.push(Segment::line(a));
                match circle_from_3_points(a, apex, b) {
                    None => segments.push(Segment::line(b)),
                    Some((cx, cy, r)) => segments.push(Segment::arc(
                        [cx, cy],
                        r,
                        (a[1] - cy).atan2(a[0] - cx),
                        (b[1] - cy).atan2(b[0] - cx),
                        false,
                    )),
                }
            }
            (None, None) => {
                let start = point(from, to);
                let end = point(to, from);
                segments.push(Segment::line(start));

                let features = &features_by_edge[slot];
                if !features.is_empty() {
                    let [nx, ny] = edge_inward(edge);
                    let d_start = datum_of(edge, a);
                    let d_end = datum_of(edge, b);
                    // Adjacent arcs/ramps may have inset the corners — clamp runs to what's left.
                    let d_lo = d_start.min(d_end);
                    let d_hi = d_start.max(d_end);
                    let ascending = d_end > d_start; // l0/w1 walk with the datum; l1/w0 against it
                    let mut ordered = features.clone();
                    if ascending {
                        ordered.sort_by(|p, q| cmp_f64(p.lo, q.lo));
                    } else {
                        ordered.sort_by(|p, q| cmp_f64(q.hi, p.hi));
                    }

                    for f in ordered {
                        let lo = f.lo.max(d_lo);
                        let hi = f.hi.min(d_hi);
                        if hi - lo < 1e-9 {
                            continue;
                        }
                        let p1 = datum_point(edge, if ascending { lo } else { hi });
                        let p4 = datum_point(edge, if ascending { hi } else { lo });
                        segments.push(Segment::line(p1));
                        match f.kind {
                            SpanKind::Notch => {
                                segments.push(Segment::line([p1[0] + nx * f.depth, p1[1] + ny * f.depth]));
                                segments.push(Segment::line([p4[0] + nx * f.depth, p4[1] + ny * f.depth]));
                            }
                            SpanKind::Scallop => {
                                segments.push(scallop_arc([nx, ny], p1, p4, hi - lo, f.depth));
                            }
                        }
                        segments.push(Segment::line(p4));
                    }
                }

                segments.push(Segment::line(end));
                // Quarter-round into the next edge (skipped when radius 0: end == the corner).
                let r = corner_radius[to];
                if r > 0.0 {
                    let (_, nf, nt) = EDGE_WALK[(walk_index + 1) % 4];
                    let c = point(nf, nt);
                    let centre = [end[0] + (c[0] - b[0]), end[1] + (c[1] - b[1])];
                    segments.push(Segment::arc(
                        centre,
                        r,
                        (end[1] - centre[1]).atan2(end[0] - centre[0]),
                        (c[1] - centre[1]).atan2(c[0] - centre[0]),
                        false,
                    ));
                }
            }
        }

        for s in &mut segments[emitted_before..] {
            s.set_edge(edge);
        }
    }
    segments
}

/// The dip a partial-span arc cuts between two points on a straight edge.
fn scallop_arc(inward: P, p1: P, p4: P, chord: f64, depth: f64) -> Segment {
    let [nx, ny] = inward;
    let r = depth / 2.0 + (chord * chord) / (8.0 * depth);
    let mid = [(p1[0] + p4[0]) / 2.0, (p1[1] + p4[1]) / 2.0];
    let cx = mid[0] + nx * (depth - r);
    let cy = mid[1] + ny * (depth - r);
    // Left of travel means the centre is on the right, which is a clockwise sweep.
    let apex = [mid[0] + nx * depth, mid[1] + ny * depth];
    let cross = (p4[0] - p1[0]) * (apex[1] - p1[1]) - (p4[1] - p1[1]) * (apex[0] - p1[0]);
    Segment::arc(
        [cx, cy],
        r,
        (p1[1] - cy).atan2(p1[0] - cx),
        (p4[1] - cy).atan2(p4[0] - cx),
        cross > 0.0,
    )
}

/// An arc oriented so travel leaves `start` toward `end`.
fn arc_to(centre: P, radius: f64, start: P, end: P) -> Segment {
    let a0 = (start[1] - centre[1]).atan2(start[0] - centre[0]);
    let a1 = (end[1] - centre[1]).atan2(end[0] - centre[0]);
    let ccw = [-a0.sin(), a0.cos()];
    let toward_end = ccw[0] * (end[0] - start[0]) + ccw[1] * (end[1] - start[1]);
    Segment::arc(centre, radius, a0, a1, toward_end <= 0.0)
}

/// Circle through three points, or `None` when collinear/coincident.
pub fn circle_from_3_points(a: P, b: P, c: P) -> Option<(f64, f64, f64)> {
    let d = 2.0 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    let scale = (a[0] - b[0])
        .hypot(a[1] - b[1])
        .max((b[0] - c[0]).hypot(b[1] - c[1]))
        .max((c[0] - a[0]).hypot(c[1] - a[1]));
    // Written as a negated `>` so NaN inputs fail it too.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    if !(d.abs() > 1e-9 * scale * scale) {
        return None;
    }
    let sa = a[0] * a[0] + a[1] * a[1];
    let sb = b[0] * b[0] + b[1] * b[1];
    let sc = c[0] * c[0] + c[1] * c[1];
    let cx = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d;
    let cy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
    let r = (a[0] - cx).hypot(a[1] - cy);
    (cx.is_finite() && cy.is_finite() && r.is_finite()).then_some((cx, cy, r))
}

/// Removes cyclic consecutive duplicates and zero-area spikes from the line runs, in place.
/// A corner notch's detour otherwise retraces the neighbouring edge. Arcs are never touched.
pub fn clean_polyline(segments: &mut Vec<Segment>) {
    const EPS: f64 = 1e-9;
    let mut changed = true;
    let mut guard = segments.len() * 3;
    while changed && guard > 0 {
        changed = false;
        guard -= 1;

        let n = segments.len();
        for i in 0..n {
            if let (Some(cur), Some(next)) = (segments[i].as_point(), segments[(i + 1) % n].as_point())
                && n > 2
                && (next[0] - cur[0]).hypot(next[1] - cur[1]) < EPS
            {
                segments.remove((i + 1) % n);
                changed = true;
                break;
            }
        }
        if changed {
            continue;
        }

        let n = segments.len();
        for i in 0..n {
            let (Some(p0), Some(p1), Some(p2)) = (
                segments[(i + n - 1) % n].as_point(),
                segments[i].as_point(),
                segments[(i + 1) % n].as_point(),
            ) else {
                continue;
            };
            let u = [p1[0] - p0[0], p1[1] - p0[1]];
            let v = [p2[0] - p1[0], p2[1] - p1[1]];
            let cross = u[0] * v[1] - u[1] * v[0];
            let dot = u[0] * v[0] + u[1] * v[1];
            if cross.abs() < EPS && dot < 0.0 {
                segments.remove(i); // p1 is the spike tip
                changed = true;
                break;
            }
        }
    }
}

/// Rotates the closed contour so it starts on a vertex.
fn rotate_to_first_line(segments: &mut [Segment]) {
    if let Some(first) = segments.iter().position(|s| matches!(s, Segment::Line { .. }))
        && first > 0
    {
        segments.rotate_left(first);
    }
}
