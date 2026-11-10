//! Per-part op rules: every op fits the part it is cut into, and ops that compose on one edge or
//! arris do not silently discard each other.

use super::{EPS, LintIssue, Severity};
use crate::geometry::php_float as f;
use crate::spec::{Axis, Curve, Ease, Edge, Face, Material, Op, Part};

fn chord_and_span(part: &Part, edge: Edge) -> (f64, f64) {
    if edge.is_l_edge() {
        (part.size.l, part.size.w)
    } else {
        (part.size.w, part.size.l)
    }
}

/// Every op lies within its part and its material's thickness.
pub(super) fn ops_fit_part(part: &Part, material: &Material, issues: &mut Vec<LintIssue>) {
    let name = &part.name;
    let thickness = material.thickness;
    let ops = part.ops();

    for (op_index, op) in ops.iter().enumerate() {
        let mut fail = |message: String| {
            issues.push(LintIssue::op(
                Severity::Error,
                "op.out-of-bounds",
                message,
                &part.id,
                op_index,
            ));
        };

        match op {
            Op::Dado(c) | Op::Groove(c) => {
                let kind = op.type_name();
                let span = if c.axis == Axis::L { part.size.w } else { part.size.l };
                if -EPS > c.offset - c.width / 2.0 || span + EPS < c.offset + c.width / 2.0 {
                    let edge = if c.axis == Axis::L { "width" } else { "length" };
                    fail(format!(
                        "{kind} on \"{name}\" (offset {}, width {}) runs off the {edge} ({}\").",
                        f(c.offset),
                        f(c.width),
                        f(span)
                    ));
                }
                if c.depth > thickness + EPS {
                    fail(format!(
                        "{kind} on \"{name}\" depth {}\" exceeds thickness {}\".",
                        f(c.depth),
                        f(thickness)
                    ));
                }
                // Stopped channel: from/to measured from the low run edge, within the run.
                let run = if c.axis == Axis::L { part.size.l } else { part.size.w };
                let (from, to) = (c.from.unwrap_or(0.0), c.to.unwrap_or(run));
                if let Some(t) = c.to
                    && t > run + EPS
                {
                    fail(format!(
                        "{kind} on \"{name}\" ends at {}\", past the {}\" run.",
                        f(t),
                        f(run)
                    ));
                }
                if to - from < EPS {
                    fail(format!(
                        "{kind} on \"{name}\" has a zero or negative run (from {}, to {}).",
                        f(from),
                        f(to)
                    ));
                }
            }
            Op::Rabbet(r) => {
                if r.depth > thickness + EPS {
                    fail(format!(
                        "rabbet on \"{name}\" depth {}\" exceeds thickness {}\".",
                        f(r.depth),
                        f(thickness)
                    ));
                }
            }
            Op::Hole(h) => {
                if h.x < -EPS || h.x > part.size.l + EPS || h.y < -EPS || h.y > part.size.w + EPS {
                    fail(format!(
                        "hole on \"{name}\" at ({}, {}) lies off the face ({}×{}\").",
                        f(h.x),
                        f(h.y),
                        f(part.size.l),
                        f(part.size.w)
                    ));
                }
                if let Some(d) = h.depth
                    && d > thickness + EPS
                {
                    fail(format!(
                        "hole on \"{name}\" depth {}\" exceeds thickness {}\".",
                        f(d),
                        f(thickness)
                    ));
                }
            }
            Op::Curve(curve) => {
                let edge = curve.edge();
                let (chord, span) = chord_and_span(part, edge);
                let perpendicular = |other: Edge| edge.is_perpendicular_to(other);
                match curve {
                    Curve::Arc {
                        height,
                        from: arc_from,
                        to: arc_to,
                        ..
                    } => {
                        if *height >= span - EPS {
                            fail(format!(
                                "curve on \"{name}\" height {}\" consumes the whole {}\" span.",
                                f(*height),
                                f(span)
                            ));
                        }
                        if arc_from.is_some() || arc_to.is_some() {
                            // Partial-span arc: a scallop, on the notch/stopped-channel datum.
                            let (from, to) = (arc_from.unwrap_or(0.0), arc_to.unwrap_or(chord));
                            if let Some(t) = arc_to
                                && *t > chord + EPS
                            {
                                fail(format!(
                                    "curve on \"{name}\" ends at {}\", past the {}\" edge.",
                                    f(*t),
                                    f(chord)
                                ));
                            }
                            if to - from < EPS {
                                fail(format!(
                                    "curve on \"{name}\" has a zero or negative span (from {}, to {}).",
                                    f(from),
                                    f(to)
                                ));
                            } else if *height > (to - from) / 2.0 + EPS {
                                // Deeper than a half-circle and the arc undercuts the straight edge.
                                let run = to - from;
                                fail(format!(
                                    "curve on \"{name}\" is a {}\" scallop across a {}\" span — a partial arc can be at most half its span deep ({}\"). Widen the span, or reduce the height.",
                                    f(*height),
                                    f(run),
                                    f(run / 2.0)
                                ));
                            }
                            if from <= EPS && to >= chord - EPS {
                                // A dome and a full-width scallop are different shapes; say which.
                                issues.push(LintIssue::op(
                                    Severity::Warn,
                                    "op.curve-span-full",
                                    format!(
                                        "curve on \"{name}\" spans the whole {} edge, so it cuts as a scallop — the edge dips {}\" in the middle and the corners stay put. Omit from/to for a dome, where the corners drop {}\" instead.",
                                        edge.as_str(),
                                        f(*height),
                                        f(*height)
                                    ),
                                    &part.id,
                                    op_index,
                                ));
                            }
                        }
                    }
                    Curve::Round { radius, corner, .. } => {
                        let max_radius = if corner.is_some() { chord } else { chord / 2.0 };
                        if *radius > max_radius + EPS || *radius > span + EPS {
                            fail(format!(
                                "corner round on \"{name}\" radius {}\" doesn't fit the {}\"-long edge.",
                                f(*radius),
                                f(chord)
                            ));
                        }
                        if let Some(c) = corner
                            && !perpendicular(*c)
                        {
                            fail(format!(
                                "corner round on \"{name}\" names corner \"{}\", which is parallel to edge {} — use one of its adjacent edges.",
                                c.as_str(),
                                edge.as_str()
                            ));
                        }
                    }
                    Curve::Ramp { height, low, .. } => {
                        if *height >= span - EPS {
                            fail(format!(
                                "ramp on \"{name}\" height {}\" consumes the whole {}\" span.",
                                f(*height),
                                f(span)
                            ));
                        }
                        if !perpendicular(*low) {
                            fail(format!(
                                "ramp on \"{name}\" sweeps toward \"{}\", which is parallel to edge {} — use one of its adjacent edges.",
                                low.as_str(),
                                edge.as_str()
                            ));
                        }
                    }
                }
            }
            Op::PocketHoles(p) => {
                // Optional from/to bound the pockets to the stretch that meets the mate.
                let (chord, _) = chord_and_span(part, p.edge);
                let (from, to) = (p.from.unwrap_or(0.0), p.to.unwrap_or(chord));
                if let Some(t) = p.to
                    && t > chord + EPS
                {
                    fail(format!(
                        "pocket screws on \"{name}\" end at {}\", past the {}\" edge.",
                        f(t),
                        f(chord)
                    ));
                }
                if to - from < -EPS {
                    fail(format!(
                        "pocket screws on \"{name}\" have a negative run (from {}, to {}).",
                        f(from),
                        f(to)
                    ));
                }
            }
            Op::Screws(s) => {
                let along = s.axis == Axis::L;
                let (span, run) = if along {
                    (part.size.w, part.size.l)
                } else {
                    (part.size.l, part.size.w)
                };
                if s.offset < -EPS || s.offset > span + EPS {
                    let dimension = if along { "width" } else { "length" };
                    fail(format!(
                        "screws on \"{name}\" sit {}\" from the edge, off the {}\" {dimension}.",
                        f(s.offset),
                        f(span)
                    ));
                }
                let (from, to) = (s.from.unwrap_or(0.0), s.to.unwrap_or(run));
                if let Some(t) = s.to
                    && t > run + EPS
                {
                    fail(format!(
                        "screws on \"{name}\" end at {}\", past the {}\" run.",
                        f(t),
                        f(run)
                    ));
                }
                if to - from < EPS {
                    fail(format!(
                        "screws on \"{name}\" have a zero or negative run (from {}, to {}).",
                        f(from),
                        f(to)
                    ));
                }
            }
            Op::Notch(n) => {
                let (chord, span) = chord_and_span(part, n.edge);
                if n.to > chord + EPS {
                    fail(format!(
                        "notch on \"{name}\" ends at {}\", past the {}\" edge.",
                        f(n.to),
                        f(chord)
                    ));
                }
                if n.to - n.from < EPS {
                    fail(format!(
                        "notch on \"{name}\" has a zero or negative run (from {}, to {}).",
                        f(n.from),
                        f(n.to)
                    ));
                }
                if n.depth >= span - EPS {
                    fail(format!(
                        "notch on \"{name}\" depth {}\" consumes the whole {}\" span.",
                        f(n.depth),
                        f(span)
                    ));
                }
            }
            Op::Ease(e) => {
                // An ease only eats into the thickness. From both faces each arris gets half.
                let both_faces = matches!(e, Ease::Bullnose { .. }) || e.face().is_none();
                let (size, what) = match e {
                    Ease::Roundover { radius, .. } => (*radius, format!("radius {}\"", f(*radius))),
                    Ease::Chamfer { width, .. } => (*width, format!("width {}\"", f(*width))),
                    Ease::Bullnose { .. } => (0.0, String::new()),
                };
                let limit = if both_faces { thickness / 2.0 } else { thickness };
                let profile = e.profile_name();
                if size > limit + EPS {
                    fail(if both_faces {
                        format!(
                            "{profile} on \"{name}\" {what} is more than half the {}\" thickness — eased from both faces, the two cuts pass through each other. Name a face, or use a smaller bit.",
                            f(thickness)
                        )
                    } else {
                        format!(
                            "{profile} on \"{name}\" {what} exceeds the {}\" thickness.",
                            f(thickness)
                        )
                    });
                }
                // Stopped ease: same bounds a stopped channel gets.
                let (chord, _) = chord_and_span(part, e.edge());
                let (ef, et) = e.run();
                let (from, to) = (ef.unwrap_or(0.0), et.unwrap_or(chord));
                if let Some(t) = et
                    && t > chord + EPS
                {
                    fail(format!(
                        "{profile} on \"{name}\" ends at {}\", past the {}\" edge.",
                        f(t),
                        f(chord)
                    ));
                }
                if to - from < EPS {
                    fail(format!(
                        "{profile} on \"{name}\" has a zero or negative run (from {}, to {}).",
                        f(from),
                        f(to)
                    ));
                }
            }
            Op::Miter(_) => {}
        }
    }

    // Two arcs facing each other: once their heights cover the span between them the outline
    // collapses into non-finite geometry. Each passes its own bounds check; only the pair can.
    let mut deepest: [Option<(f64, usize)>; 4] = [None; 4];
    let slot = |e: Edge| Edge::ALL.iter().position(|x| *x == e).unwrap_or(0);
    for (i, op) in ops.iter().enumerate() {
        if let Op::Curve(Curve::Arc { edge, height, .. }) = op {
            let s = slot(*edge);
            if deepest[s].is_none_or(|(h, _)| *height > h) {
                deepest[s] = Some((*height, i));
            }
        }
    }
    for (near, far) in [(Edge::L0, Edge::L1), (Edge::W0, Edge::W1)] {
        let (Some((ha, ia)), Some((hb, ib))) = (deepest[slot(near)], deepest[slot(far)]) else {
            continue;
        };
        let span = if near == Edge::L0 { part.size.w } else { part.size.l };
        if span - EPS <= ha + hb {
            issues.push(LintIssue::op(
                Severity::Error,
                "op.curve-opposed",
                format!(
                    "curves on \"{name}\" drop the {} and {} edges by {}\" and {}\" into a {}\" span — together they consume the whole span and the outline collapses. Make them shallower, or curve only one edge.",
                    near.as_str(),
                    far.as_str(),
                    f(ha),
                    f(hb),
                    f(span)
                ),
                &part.id,
                ia.max(ib),
            ));
        }
    }

    // Composition on a shaped part: combinations that would discard geometry the author asked
    // for are errors — a design that would not be cut the way it is written is not buildable.
    let curve_edges: Vec<Edge> = ops
        .iter()
        .filter_map(|o| if let Op::Curve(c) = o { Some(c.edge()) } else { None })
        .collect();
    let notch_edges: Vec<Edge> = ops
        .iter()
        .filter_map(|o| if let Op::Notch(n) = o { Some(n.edge) } else { None })
        .collect();
    let miter_edges: Vec<Edge> = ops
        .iter()
        .filter_map(|o| if let Op::Miter(m) = o { Some(m.edge) } else { None })
        .collect();

    if !curve_edges.is_empty() {
        for (i, op) in ops.iter().enumerate() {
            if let Op::Miter(m) = op
                && curve_edges.contains(&m.edge)
            {
                issues.push(LintIssue::op(
                    Severity::Error,
                    "op.curve-miter-edge",
                    format!(
                        "\"{name}\" miters edge {}, which is also curved — the miter would not be cut. Remove one of them, or move the miter to another edge.",
                        m.edge.as_str()
                    ),
                    &part.id,
                    i,
                ));
            }
        }
    }

    if !notch_edges.is_empty() {
        for (i, op) in ops.iter().enumerate() {
            if let Op::Miter(m) = op
                && notch_edges.contains(&m.edge)
            {
                issues.push(LintIssue::op(
                    Severity::Error,
                    "op.notch-miter-edge",
                    format!(
                        "\"{name}\" miters edge {}, which is also notched — the miter would not be cut inside the notch. Remove one of them, or move the miter to another edge.",
                        m.edge.as_str()
                    ),
                    &part.id,
                    i,
                ));
            }
            if let Op::Notch(n) = op {
                // A whole-edge curve leaves no straight run to notch into; a partial-span arc
                // only conflicts where the two runs actually overlap.
                let (chord, _) = chord_and_span(part, n.edge);
                let mut whole_edge = false;
                let mut clash: Option<(f64, f64)> = None;
                for other in ops {
                    let Op::Curve(c) = other else { continue };
                    if c.edge() != n.edge {
                        continue;
                    }
                    match c {
                        Curve::Arc { from, to, .. } if from.is_some() || to.is_some() => {
                            let (of, ot) = (from.unwrap_or(0.0), to.unwrap_or(chord));
                            if clash.is_none() && n.from.max(of) < n.to.min(ot) - EPS {
                                clash = Some((of, ot));
                            }
                        }
                        _ => whole_edge = true,
                    }
                }
                let edge = n.edge.as_str();
                if whole_edge {
                    issues.push(LintIssue::op(
                        Severity::Error,
                        "op.notch-curve-edge",
                        format!(
                            "\"{name}\" notches edge {edge}, which is curved along its whole length — the notch would not be cut. Give the curve a from/to span that clears {}\"–{}\", or move the notch.",
                            f(n.from),
                            f(n.to)
                        ),
                        &part.id,
                        i,
                    ));
                } else if let Some((cf, ct)) = clash {
                    issues.push(LintIssue::op(
                        Severity::Error,
                        "op.notch-curve-edge",
                        format!(
                            "\"{name}\" notches edge {edge} from {}\" to {}\", over a curve running {}\"–{}\" — the curve wins and the notch would not be cut. Move one of them so their runs do not overlap.",
                            f(n.from),
                            f(n.to),
                            f(cf),
                            f(ct)
                        ),
                        &part.id,
                        i,
                    ));
                }
            }
        }
    }

    // A miter re-cuts the very arris an ease softened.
    for (i, op) in ops.iter().enumerate() {
        if let Op::Ease(e) = op
            && miter_edges.contains(&e.edge())
        {
            issues.push(LintIssue::op(
                Severity::Error,
                "op.ease-miter-edge",
                format!(
                    "\"{name}\" eases edge {}, which is also mitered — the miter re-cuts that very arris, so the ease would not survive. Remove one of them, or move the ease to another edge.",
                    e.edge().as_str()
                ),
                &part.id,
                i,
            ));
        }
    }
}

/// Legal geometry that is probably a mistake: overlapping channels, notches, scallops, eases.
pub(super) fn overlapping_ops(part: &Part, issues: &mut Vec<LintIssue>) {
    let ops = part.ops();
    let name = &part.name;
    let chord_of = |e: Edge| if e.is_l_edge() { part.size.l } else { part.size.w };

    let channels: Vec<(usize, &str, &crate::spec::Channel)> = ops
        .iter()
        .enumerate()
        .filter_map(|(i, o)| match o {
            Op::Dado(c) | Op::Groove(c) => Some((i, o.type_name(), c)),
            _ => None,
        })
        .collect();
    for (a_i, (_, a_type, a)) in channels.iter().enumerate() {
        for (b_idx, b_type, b) in &channels[a_i + 1..] {
            if a.face != b.face || a.axis != b.axis {
                continue;
            }
            if (a.offset - b.offset).abs() < (a.width + b.width) / 2.0 - EPS {
                let axis = if a.axis == Axis::L { "l" } else { "w" };
                issues.push(LintIssue::op(
                    Severity::Warn,
                    "op.overlap",
                    format!("Overlapping {axis}-channels on \"{name}\" ({a_type} + {b_type})."),
                    &part.id,
                    *b_idx,
                ));
            }
        }
    }

    // Same-edge notches whose runs overlap render as their union.
    let notches: Vec<(usize, &crate::spec::Notch)> = ops
        .iter()
        .enumerate()
        .filter_map(|(i, o)| if let Op::Notch(n) = o { Some((i, n)) } else { None })
        .collect();
    for (k, (_, a)) in notches.iter().enumerate() {
        for (j, b) in &notches[k + 1..] {
            if a.edge == b.edge && a.from.max(b.from) < a.to.min(b.to) - EPS {
                issues.push(LintIssue::op(
                    Severity::Warn,
                    "op.overlap",
                    format!("Overlapping notches on edge {} of \"{name}\".", a.edge.as_str()),
                    &part.id,
                    *j,
                ));
            }
        }
    }

    // Two partial-span arcs on one stretch do NOT merge: the later one is dropped.
    let scallops: Vec<(usize, Edge, Option<f64>, Option<f64>)> = ops
        .iter()
        .enumerate()
        .filter_map(|(i, o)| match o {
            Op::Curve(Curve::Arc { edge, from, to, .. }) if from.is_some() || to.is_some() => {
                Some((i, *edge, *from, *to))
            }
            _ => None,
        })
        .collect();
    for (k, (_, ea, fa, ta)) in scallops.iter().enumerate() {
        for (j, eb, fb, tb) in &scallops[k + 1..] {
            if ea != eb {
                continue;
            }
            let chord = chord_of(*ea);
            if fa.unwrap_or(0.0).max(fb.unwrap_or(0.0)) < ta.unwrap_or(chord).min(tb.unwrap_or(chord)) - EPS {
                issues.push(LintIssue::op(
                    Severity::Warn,
                    "op.overlap",
                    format!(
                        "Overlapping curves on edge {} of \"{name}\" — only the first is cut.",
                        ea.as_str()
                    ),
                    &part.id,
                    *j,
                ));
            }
        }
    }

    // Two eases on one arris: where the runs overlap only the deeper profile survives.
    let eases: Vec<(usize, &Ease)> = ops
        .iter()
        .enumerate()
        .filter_map(|(i, o)| if let Op::Ease(e) = o { Some((i, e)) } else { None })
        .collect();
    let arrises = |e: &Ease| -> Vec<Face> {
        match (e, e.face()) {
            (Ease::Bullnose { .. }, _) | (_, None) => vec![Face::Front, Face::Back],
            (_, Some(face)) => vec![face],
        }
    };
    for (k, (_, a)) in eases.iter().enumerate() {
        for (j, b) in &eases[k + 1..] {
            if a.edge() != b.edge() || !arrises(a).iter().any(|x| arrises(b).contains(x)) {
                continue;
            }
            let chord = chord_of(a.edge());
            let ((fa, ta), (fb, tb)) = (a.run(), b.run());
            if fa.unwrap_or(0.0).max(fb.unwrap_or(0.0)) >= ta.unwrap_or(chord).min(tb.unwrap_or(chord)) - EPS {
                continue;
            }
            issues.push(LintIssue::op(
                Severity::Warn,
                "op.overlap",
                format!(
                    "Two eases on the same arris of edge {} on \"{name}\" — where the runs overlap, only the deeper profile is cut.",
                    a.edge().as_str()
                ),
                &part.id,
                *j,
            ));
        }
    }
}
