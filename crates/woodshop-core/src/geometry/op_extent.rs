//! Where an op sits on its part, as a box in the part's local frame. Resolves every datum the
//! schema names but cannot show (`offset` to a channel centreline, `from`/`to` along an edge from
//! the low perpendicular edge, corner-origin hole `x`/`y`).

use super::Aabb;
use crate::spec::{Axis, Curve, Edge, Face, Op, Part};

fn edge_facts(edge: Edge, l: f64, w: f64) -> (bool, f64, f64, bool) {
    let on_length = edge.is_l_edge();
    let chord = if on_length { l } else { w };
    let span = if on_length { w } else { l };
    let low = matches!(edge, Edge::L0 | Edge::W0);
    (on_length, chord, span, low)
}

fn boxed(on_length: bool, run: (f64, f64), across: (f64, f64), z: (f64, f64)) -> Aabb {
    if on_length {
        Aabb {
            min: [run.0, across.0, z.0],
            max: [run.1, across.1, z.1],
        }
    } else {
        Aabb {
            min: [across.0, run.0, z.0],
            max: [across.1, run.1, z.1],
        }
    }
}

/// The op's footprint as a local-frame box.
pub fn local_box(op: &Op, part: &Part, thickness: f64) -> Option<Aabb> {
    let (l, w) = (part.size.l, part.size.w);
    let ht = thickness / 2.0;
    Some(match op {
        Op::Notch(n) => edge_span(n.edge, n.depth, Some(n.from), Some(n.to), l, w, ht),
        Op::Curve(c) => {
            let (depth, from, to) = match c {
                Curve::Arc { height, from, to, .. } => (*height, *from, *to),
                Curve::Round { radius, .. } => (*radius, None, None),
                Curve::Ramp { height, .. } => (*height, None, None),
            };
            edge_span(c.edge(), depth, from, to, l, w, ht)
        }
        Op::Hole(h) => {
            let cx = -l / 2.0 + h.x;
            let cy = -w / 2.0 + h.y;
            let r = h.diameter / 2.0;
            let depth = h.depth.unwrap_or(thickness);
            let z = if h.face == Face::Front {
                (ht - depth, ht)
            } else {
                (-ht, -ht + depth)
            };
            Aabb {
                min: [cx - r, cy - r, z.0],
                max: [cx + r, cy + r, z.1],
            }
        }
        Op::Dado(c) | Op::Groove(c) => {
            let along = c.axis == Axis::L;
            let (span, run) = if along { (w, l) } else { (l, w) };
            let centre = -span / 2.0 + c.offset;
            let half = c.width / 2.0;
            let run_lo = -run / 2.0 + c.from.unwrap_or(0.0);
            let run_hi = -run / 2.0 + c.to.unwrap_or(run);
            let z = if c.face == Face::Front {
                (ht - c.depth, ht)
            } else {
                (-ht, -ht + c.depth)
            };
            boxed(along, (run_lo, run_hi), (centre - half, centre + half), z)
        }
        Op::Rabbet(r) => {
            // Always cut from the front face (§3.1 — flip the part for a back-face rabbet).
            let (on_length, _, span, low) = edge_facts(r.edge, l, w);
            let across = if low {
                (-span / 2.0, -span / 2.0 + r.width)
            } else {
                (span / 2.0 - r.width, span / 2.0)
            };
            let run = if on_length {
                (-l / 2.0, l / 2.0)
            } else {
                (-w / 2.0, w / 2.0)
            };
            boxed(on_length, run, across, (ht - r.depth, ht))
        }
        Op::Ease(e) => {
            let (from, to) = e.run();
            edge_line(e.edge(), from, to, l, w, ht)
        }
        Op::PocketHoles(p) => edge_line(p.edge, p.from, p.to, l, w, ht),
        Op::Miter(m) => edge_line(m.edge, None, None, l, w, ht),
        Op::Screws(s) => {
            let along = s.axis == Axis::L;
            let (span, run) = if along { (w, l) } else { (l, w) };
            let line = -span / 2.0 + s.offset;
            let run_lo = -run / 2.0 + s.from.unwrap_or(0.0);
            let run_hi = -run / 2.0 + s.to.unwrap_or(run);
            boxed(along, (run_lo, run_hi), (line, line), (-ht, ht))
        }
    })
}

/// A run along the named edge biting `depth` inward. No `from`/`to` = the whole edge.
fn edge_span(edge: Edge, depth: f64, from: Option<f64>, to: Option<f64>, l: f64, w: f64, ht: f64) -> Aabb {
    let (on_length, chord, span, low) = edge_facts(edge, l, w);
    let run = (-chord / 2.0 + from.unwrap_or(0.0), -chord / 2.0 + to.unwrap_or(chord));
    let bite = if low {
        (-span / 2.0, -span / 2.0 + depth)
    } else {
        (span / 2.0 - depth, span / 2.0)
    };
    boxed(on_length, run, bite, (-ht, ht))
}

/// An op on an edge that does not bite into the face (ease, pocket row, miter).
fn edge_line(edge: Edge, from: Option<f64>, to: Option<f64>, l: f64, w: f64, ht: f64) -> Aabb {
    let (on_length, chord, span, low) = edge_facts(edge, l, w);
    let at = if low { -span / 2.0 } else { span / 2.0 };
    let run = (-chord / 2.0 + from.unwrap_or(0.0), -chord / 2.0 + to.unwrap_or(chord));
    boxed(on_length, run, (at, at), (-ht, ht))
}

/// The datum an op's `from`/`to` count along, in words.
pub fn datum_note(op: &Op) -> Option<String> {
    let edge = op.edge()?;
    let (from, towards) = if edge.is_l_edge() {
        ("w0 (local x = -l/2)", "+X")
    } else {
        ("l0 (local y = -w/2)", "+Y")
    };
    Some(format!(
        "`from`/`to` on {} count from {from}, running {towards}.",
        edge.as_str()
    ))
}
