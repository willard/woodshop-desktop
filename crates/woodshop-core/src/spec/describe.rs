//! The one op vocabulary: each part operation in words a woodworker reads at the bench, with its
//! size and where it goes. The editor's Inspector, the 3D plan and the PDF plan all read it, so the
//! screen and the printed plan cannot disagree. A part is described as drawn face-on: its length
//! runs left to right, the `l0` edge at the bottom.

use super::types::{Curve, Ease, Edge, Face, HolePurpose, Op, Thread};
use crate::units::{Units, format_length};

fn edge_name(edge: Edge) -> &'static str {
    match edge {
        Edge::L0 => "bottom edge",
        Edge::L1 => "top edge",
        Edge::W0 => "left end",
        Edge::W1 => "right end",
    }
}

fn face_name(face: Face) -> &'static str {
    match face {
        Face::Front => "front face",
        Face::Back => "back face",
    }
}

fn many(n: u32, one: &str) -> String {
    if n == 1 {
        format!("{n} {one}")
    } else {
        format!("{n} {one}s")
    }
}

/// A number as JavaScript prints it: `45`, `22.5`.
fn plain(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// One line for `op`: what the cut is, how big, and where, with sizes in `units`.
pub fn op_summary(op: &Op, units: Units) -> String {
    let len = |n: f64| format_length(n, units);
    match op {
        Op::Dado(c) | Op::Groove(c) => {
            let name = if matches!(op, Op::Dado(_)) { "Dado" } else { "Groove" };
            let (runs, from) = match c.axis {
                super::types::Axis::L => ("running the length", "bottom edge"),
                super::types::Axis::W => ("across the width", "left end"),
            };
            let stopped = if c.from.is_some() || c.to.is_some() {
                ", stopped"
            } else {
                ""
            };
            format!(
                "{name} {} wide × {} deep in the {}, {runs}, {} from the {from}{stopped}",
                len(c.width),
                len(c.depth),
                face_name(c.face),
                len(c.offset)
            )
        }
        Op::Rabbet(r) => format!(
            "Rabbet {} wide × {} deep along the {}",
            len(r.width),
            len(r.depth),
            edge_name(r.edge)
        ),
        Op::Hole(h) => {
            let name = match h.purpose {
                Some(HolePurpose::Dowel) => "Dowel hole",
                Some(HolePurpose::ShelfPin) => "Shelf-pin hole",
                _ => "Hole",
            };
            let depth = h
                .depth
                .map_or_else(|| "through".to_owned(), |d| format!("{} deep", len(d)));
            format!(
                "{name} ⌀ {}, {depth}, in the {}, {} from the left end, {} up",
                len(h.diameter),
                face_name(h.face),
                len(h.x),
                len(h.y)
            )
        }
        Op::PocketHoles(p) => {
            let mut s = format!("{} through the {}", many(p.count, "pocket screw"), edge_name(p.edge));
            if let Some(l) = p.length {
                s += &format!(", {}", len(l));
            }
            if let Some(t) = p.thread {
                s += match t {
                    Thread::Coarse => " coarse thread",
                    Thread::Fine => " fine thread",
                };
            }
            s
        }
        Op::Screws(s) => {
            let gauge = s.gauge.map_or("#8", |g| g.as_str());
            let length = s.length.map_or_else(String::new, |l| format!(" × {}", len(l)));
            let from = match s.axis {
                super::types::Axis::L => "bottom edge",
                super::types::Axis::W => "left end",
            };
            format!(
                "{}, {gauge}{length}, through the {}, {} from the {from}",
                many(s.count, "screw"),
                face_name(s.face),
                len(s.offset)
            )
        }
        Op::Miter(m) => format!("Miter {}° on the {}", plain(m.angle), edge_name(m.edge)),
        Op::Curve(Curve::Arc { edge, height, .. }) => {
            format!("Arched {}, {} high", edge_name(*edge), len(*height))
        }
        Op::Curve(Curve::Ramp { edge, height, low }) => format!(
            "The {} sweeps {} down toward the {}",
            edge_name(*edge),
            len(*height),
            edge_name(*low)
        ),
        Op::Curve(Curve::Taper { edge, height, low }) if edge.is_l_edge() => format!(
            "The {} tapers {} in toward the {}",
            edge_name(*edge),
            len(*height),
            edge_name(*low)
        ),
        Op::Curve(Curve::Taper { edge, height, low }) => format!(
            "The {} is cut at an angle, {} shorter along the {}",
            edge_name(*edge),
            len(*height),
            edge_name(*low)
        ),
        Op::Curve(Curve::Round { edge, radius, corner }) => match corner {
            None => format!("Corners of the {} rounded, {} radius", edge_name(*edge), len(*radius)),
            Some(c) => format!(
                "Corner rounded where the {} meets the {}, {} radius",
                edge_name(*edge),
                edge_name(*c),
                len(*radius)
            ),
        },
        Op::Notch(n) => format!(
            "Notch in the {}, {} deep, from {} to {}",
            edge_name(n.edge),
            len(n.depth),
            len(n.from),
            len(n.to)
        ),
        Op::Ease(e) => {
            let (size, face) = match e {
                Ease::Roundover { radius, face, .. } => (format!("{} roundover", len(*radius)), *face),
                Ease::Chamfer { width, face, .. } => (format!("{} chamfer", len(*width)), *face),
                Ease::Bullnose { .. } => ("Bullnose".to_owned(), None),
            };
            let where_ = face.map_or("both faces", face_name);
            let run = match e.run() {
                (None, None) => String::new(),
                (from, to) => format!(
                    ", from {} to {}",
                    len(from.unwrap_or(0.0)),
                    to.map_or_else(|| "the end".to_owned(), len)
                ),
            };
            format!("{size} on the {}, {where_}{run}", edge_name(e.edge()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn says(op: serde_json::Value) -> String {
        op_summary(&serde_json::from_value(op).unwrap(), Units::Fraction)
    }

    #[test]
    fn every_op_reads_as_the_shop_says_it() {
        let cases = [
            (
                json!({ "type": "dado", "face": "front", "axis": "l", "offset": 3, "width": 0.75, "depth": 0.25 }),
                "Dado 3/4\" wide × 1/4\" deep in the front face, running the length, 3\" from the bottom edge",
            ),
            (
                json!({ "type": "groove", "face": "back", "axis": "w", "offset": 1.5, "width": 0.25, "depth": 0.375 }),
                "Groove 1/4\" wide × 3/8\" deep in the back face, across the width, 1 1/2\" from the left end",
            ),
            (
                json!({ "type": "dado", "face": "front", "axis": "l", "offset": 3, "width": 0.75, "depth": 0.25, "to": 8 }),
                "Dado 3/4\" wide × 1/4\" deep in the front face, running the length, 3\" from the bottom edge, stopped",
            ),
            (
                json!({ "type": "rabbet", "edge": "l0", "width": 0.5, "depth": 0.25 }),
                "Rabbet 1/2\" wide × 1/4\" deep along the bottom edge",
            ),
            (
                json!({ "type": "hole", "face": "front", "x": 2, "y": 3, "diameter": 0.25 }),
                "Hole ⌀ 1/4\", through, in the front face, 2\" from the left end, 3\" up",
            ),
            (
                json!({ "type": "hole", "face": "front", "x": 1, "y": 6, "diameter": 0.25, "purpose": "shelfPin", "depth": 0.5 }),
                "Shelf-pin hole ⌀ 1/4\", 1/2\" deep, in the front face, 1\" from the left end, 6\" up",
            ),
            (
                json!({ "type": "pocketHoles", "edge": "w1", "count": 3, "length": 1.25, "thread": "coarse" }),
                "3 pocket screws through the right end, 1 1/4\" coarse thread",
            ),
            (
                json!({ "type": "screws", "face": "back", "axis": "w", "offset": 0.5, "count": 2, "gauge": "#6", "length": 1.5 }),
                "2 screws, #6 × 1 1/2\", through the back face, 1/2\" from the left end",
            ),
            (
                json!({ "type": "miter", "edge": "l1", "angle": 22.5 }),
                "Miter 22.5° on the top edge",
            ),
            (
                json!({ "type": "curve", "edge": "l0", "kind": "ramp", "height": 2, "low": "w0" }),
                "The bottom edge sweeps 2\" down toward the left end",
            ),
            (
                json!({ "type": "curve", "edge": "l1", "kind": "round", "radius": 0.75, "corner": "w0" }),
                "Corner rounded where the top edge meets the left end, 3/4\" radius",
            ),
            (
                json!({ "type": "notch", "edge": "w1", "from": 2, "to": 5.5, "depth": 0.75 }),
                "Notch in the right end, 3/4\" deep, from 2\" to 5 1/2\"",
            ),
            (
                json!({ "type": "ease", "edge": "l0", "profile": "roundover", "radius": 0.25, "from": 3 }),
                "1/4\" roundover on the bottom edge, both faces, from 3\" to the end",
            ),
            (
                json!({ "type": "ease", "edge": "w0", "profile": "bullnose" }),
                "Bullnose on the left end, both faces",
            ),
        ];
        for (op, expected) in cases {
            assert_eq!(says(op), expected);
        }
    }

    #[test]
    fn sizes_follow_the_units() {
        let op: Op =
            serde_json::from_value(json!({ "type": "rabbet", "edge": "l0", "width": 0.5, "depth": 0.25 })).unwrap();
        assert_eq!(
            op_summary(&op, Units::Metric),
            "Rabbet 13 mm wide × 6.3 mm deep along the bottom edge"
        );
    }
}
