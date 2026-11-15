//! Every part as a flat DXF drawing, for CNC: the outline a router cuts out, the holes it drills
//! and the channels it pockets, each on a layer that names the operation and its depth, so CAM
//! software can assign a toolpath per layer.
//!
//! R12 (AC1009) DXF: the oldest dialect every CAM package still reads, and the simplest: no
//! handles, no object tree. Outlines are closed POLYLINEs with arcs kept as true arcs (bulges);
//! holes are CIRCLEs; channels are closed rectangles. Parts lie flat in rows, front face up,
//! one copy each (the label carries the quantity).
//!
//! Coordinates are §3.1 local with the datum moved to the blank's w0 × l0 corner, the same datum
//! every op's `x`/`y` counts from, so a hole's position in the DXF reads straight off the spec.

use std::f64::consts::PI;

use super::op_extent::local_box;
use super::outline::{self, Segment};
use super::outline_svg::swept_angle;
use crate::movables::derived_borings;
use crate::spec::{Face, MaterialType, Op, Part, Spec};
use crate::units::Units;

/// Gap between parts in the layout, and the row width parts wrap at (inches).
const GAP: f64 = 1.0;
const ROW: f64 = 96.0;
const LABEL_HEIGHT: f64 = 0.25;

pub const LAYER_CUT: &str = "CUT_OUTSIDE";
pub const LAYER_LABEL: &str = "LABELS";

/// One drawable entity, in drawing units, already placed in the layout.
enum Entity {
    Polyline {
        layer: String,
        points: Vec<(f64, f64, f64)>,
    },
    Circle {
        layer: String,
        x: f64,
        y: f64,
        r: f64,
    },
    Text {
        x: f64,
        y: f64,
        height: f64,
        text: String,
    },
}

/// The whole design's parts as one DXF, sized in the reader's units (millimetres for metric,
/// inches otherwise).
pub fn spec_dxf(spec: &Spec, units: Units) -> String {
    let scale = if units == Units::Metric { 25.4 } else { 1.0 };
    let borings = derived_borings(spec);

    let mut entities = Vec::new();
    let (mut x, mut y, mut row_height) = (0.0_f64, 0.0_f64, 0.0_f64);
    for part in &spec.parts {
        let Some(material) = spec.material(&part.material_id) else {
            continue;
        };
        // A dowel is turned, not routed.
        if material.kind == MaterialType::Round {
            continue;
        }
        let (l, w) = (part.size.l, part.size.w);
        if x > 0.0 && x + l > ROW.max(l) {
            x = 0.0;
            y -= row_height + GAP + LABEL_HEIGHT * 2.0;
            row_height = 0.0;
        }
        // The blank's w0 × l0 corner sits at (x, y - w): rows grow downward, labels above.
        let origin = (x, y - w);
        let mut ops: Vec<Op> = part.ops().to_vec();
        ops.extend(
            borings
                .iter()
                .filter(|b| b.part_id == part.id)
                .map(|b| Op::Hole(b.hole.clone())),
        );
        part_entities(part, &ops, material.thickness, origin, scale, units, &mut entities);
        entities.push(Entity::Text {
            x: x * scale,
            y: (y + LABEL_HEIGHT * 0.6) * scale,
            height: LABEL_HEIGHT * scale,
            text: label(part, material.thickness, &material.name, units),
        });
        x += l + GAP;
        row_height = row_height.max(w);
    }
    write(&entities, units)
}

fn part_entities(
    part: &Part,
    ops: &[Op],
    thickness: f64,
    origin: (f64, f64),
    scale: f64,
    units: Units,
    out: &mut Vec<Entity>,
) {
    let (l, w) = (part.size.l, part.size.w);
    // Local (centred) inches → placed drawing units.
    let at = |px: f64, py: f64| ((origin.0 + px + l / 2.0) * scale, (origin.1 + py + w / 2.0) * scale);

    let shape = outline::for_part(part);
    out.push(Entity::Polyline {
        layer: LAYER_CUT.into(),
        points: polyline(&shape.segments, &at),
    });

    for op in ops {
        // Notches and curves ARE the outline; fasteners, eases and miters are not router work.
        let Some(b) = local_box(op, part, thickness) else {
            continue;
        };
        let depth = (b.max[2] - b.min[2]).min(thickness);
        let through = depth >= thickness - 1e-9;
        match op {
            Op::Hole(h) => {
                let (cx, cy) = at((b.min[0] + b.max[0]) / 2.0, (b.min[1] + b.max[1]) / 2.0);
                out.push(Entity::Circle {
                    layer: layer("HOLE", depth, through, h.face, scale, units),
                    x: cx,
                    y: cy,
                    r: h.diameter / 2.0 * scale,
                });
            }
            Op::Dado(c) | Op::Groove(c) => {
                out.push(rect(layer("POCKET", depth, through, c.face, scale, units), &b, &at))
            }
            // A rabbet is always cut from the front (§3.1).
            Op::Rabbet(_) => out.push(rect(
                layer("POCKET", depth, through, Face::Front, scale, units),
                &b,
                &at,
            )),
            _ => {}
        }
    }
}

/// `HOLE_0.5`, `POCKET_12.7`, `HOLE_THROUGH`; `_BACK` when it is cut from the back face, which on
/// a CNC means flipping the part.
fn layer(kind: &str, depth: f64, through: bool, face: Face, scale: f64, units: Units) -> String {
    let depth = if through {
        "THROUGH".to_string()
    } else if units == Units::Metric {
        trim(depth * scale, 1)
    } else {
        trim(depth, 4)
    };
    let side = if face == Face::Back && !through { "_BACK" } else { "" };
    format!("{kind}_{depth}{side}")
}

fn rect(layer: String, b: &super::Aabb, at: &impl Fn(f64, f64) -> (f64, f64)) -> Entity {
    let corners = [
        at(b.min[0], b.min[1]),
        at(b.max[0], b.min[1]),
        at(b.max[0], b.max[1]),
        at(b.min[0], b.max[1]),
    ];
    Entity::Polyline {
        layer,
        points: corners.iter().map(|&(x, y)| (x, y, 0.0)).collect(),
    }
}

/// The outline as polyline vertices `(x, y, bulge)`, where a vertex's bulge shapes the segment
/// that leaves it: 0 for a line, tan(sweep / 4) for an arc (positive counter-clockwise).
fn polyline(segments: &[Segment], at: &impl Fn(f64, f64) -> (f64, f64)) -> Vec<(f64, f64, f64)> {
    let mut points: Vec<(f64, f64, f64)> = Vec::new();
    let same = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).hypot(a.1 - b.1) < 1e-9;
    for segment in segments {
        match *segment {
            Segment::Line { x, y, .. } => {
                let p = at(x, y);
                if points.last().is_none_or(|q| !same((q.0, q.1), p)) {
                    points.push((p.0, p.1, 0.0));
                }
            }
            Segment::Arc {
                cx,
                cy,
                r,
                a0,
                a1,
                clockwise,
                ..
            } => {
                if !segment.is_finite() {
                    continue;
                }
                let start = at(cx + r * a0.cos(), cy + r * a0.sin());
                if points.last().is_none_or(|q| !same((q.0, q.1), start)) {
                    points.push((start.0, start.1, 0.0));
                }
                let delta = swept_angle(a0, a1, clockwise);
                // A bulge can't describe a full turn; split one into two halves.
                let steps = if delta.abs() > PI * 1.999 { 2 } else { 1 };
                for i in 1..=steps {
                    let a = a0 + delta * i as f64 / steps as f64;
                    if let Some(last) = points.last_mut() {
                        last.2 = (delta / steps as f64 / 4.0).tan();
                    }
                    let end = at(cx + r * a.cos(), cy + r * a.sin());
                    points.push((end.0, end.1, 0.0));
                }
            }
        }
    }
    // Closed polyline: drop a final vertex that repeats the first.
    if points.len() > 1 {
        let (first, last) = (points[0], points[points.len() - 1]);
        if same((first.0, first.1), (last.0, last.1)) && last.2 == 0.0 {
            points.pop();
        }
    }
    points
}

fn label(part: &Part, thickness: f64, material: &str, units: Units) -> String {
    let t = if units == Units::Metric {
        format!("{} mm", trim(thickness * 25.4, 1))
    } else {
        format!("{} in", trim(thickness, 4))
    };
    let qty = if part.qty() > 1 {
        format!(" x{}", part.qty())
    } else {
        String::new()
    };
    ascii(&format!("{}{qty} - {t} {material}", part.name))
}

/// R12 text is a code page, not UTF-8: keep labels to plain ASCII.
fn ascii(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '×' => 'x',
            '—' | '–' => '-',
            '“' | '”' | '″' => '"',
            '‘' | '’' | '′' => '\'',
            c if c.is_ascii() && !c.is_ascii_control() => c,
            _ => '?',
        })
        .collect()
}

fn trim(v: f64, places: usize) -> String {
    let s = format!("{v:.places$}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

fn num(v: f64) -> String {
    trim(v, 6)
}

fn write(entities: &[Entity], units: Units) -> String {
    let mut layers: Vec<String> = vec![LAYER_CUT.into(), LAYER_LABEL.into()];
    for e in entities {
        let name = match e {
            Entity::Polyline { layer, .. } | Entity::Circle { layer, .. } => layer,
            Entity::Text { .. } => continue,
        };
        if !layers.contains(name) {
            layers.push(name.clone());
        }
    }

    let mut out = Vec::<String>::new();
    let mut pair = |code: i32, value: &str| {
        out.push(code.to_string());
        out.push(value.to_string());
    };

    let metric = units == Units::Metric;
    pair(0, "SECTION");
    pair(2, "HEADER");
    pair(9, "$ACADVER");
    pair(1, "AC1009");
    pair(9, "$INSUNITS");
    pair(70, if metric { "4" } else { "1" });
    pair(9, "$MEASUREMENT");
    pair(70, if metric { "1" } else { "0" });
    pair(0, "ENDSEC");

    pair(0, "SECTION");
    pair(2, "TABLES");
    pair(0, "TABLE");
    pair(2, "LTYPE");
    pair(70, "1");
    pair(0, "LTYPE");
    pair(2, "CONTINUOUS");
    pair(70, "0");
    pair(3, "Solid line");
    pair(72, "65");
    pair(73, "0");
    pair(40, "0.0");
    pair(0, "ENDTAB");
    pair(0, "TABLE");
    pair(2, "LAYER");
    pair(70, &layers.len().to_string());
    for name in &layers {
        // Colours: cut black/white, holes red, pockets blue, labels grey.
        let colour = if name == LAYER_CUT {
            "7"
        } else if name.starts_with("HOLE") {
            "1"
        } else if name.starts_with("POCKET") {
            "5"
        } else {
            "8"
        };
        pair(0, "LAYER");
        pair(2, name);
        pair(70, "0");
        pair(62, colour);
        pair(6, "CONTINUOUS");
    }
    pair(0, "ENDTAB");
    pair(0, "ENDSEC");

    pair(0, "SECTION");
    pair(2, "ENTITIES");
    for e in entities {
        match e {
            Entity::Polyline { layer, points } => {
                pair(0, "POLYLINE");
                pair(8, layer);
                pair(66, "1");
                pair(70, "1");
                pair(10, "0");
                pair(20, "0");
                pair(30, "0");
                for &(x, y, bulge) in points {
                    pair(0, "VERTEX");
                    pair(8, layer);
                    pair(10, &num(x));
                    pair(20, &num(y));
                    pair(30, "0");
                    if bulge != 0.0 {
                        pair(42, &num(bulge));
                    }
                }
                pair(0, "SEQEND");
                pair(8, layer);
            }
            Entity::Circle { layer, x, y, r } => {
                pair(0, "CIRCLE");
                pair(8, layer);
                pair(10, &num(*x));
                pair(20, &num(*y));
                pair(30, "0");
                pair(40, &num(*r));
            }
            Entity::Text { x, y, height, text } => {
                pair(0, "TEXT");
                pair(8, LAYER_LABEL);
                pair(10, &num(*x));
                pair(20, &num(*y));
                pair(30, "0");
                pair(40, &num(*height));
                pair(1, text);
            }
        }
    }
    pair(0, "ENDSEC");
    pair(0, "EOF");
    out.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(mut parts: serde_json::Value) -> Spec {
        for part in parts.as_array_mut().unwrap() {
            part["transform"] = json!({ "pos": [0, 0, 0] });
        }
        let raw = json!({
            "specVersion": crate::spec::migrate::CURRENT_SPEC_VERSION, "name": "T", "units": "in",
            "materials": [
                { "id": "ply", "name": "Birch Plywood", "type": "sheet", "thickness": 0.75 },
                { "id": "dowel", "name": "Oak dowel", "type": "round", "thickness": 1 }
            ],
            "parts": parts,
        });
        crate::spec::from_value(crate::spec::migrate_to_latest(raw).unwrap()).unwrap()
    }

    /// (code, value) pairs, as a DXF reader sees them.
    fn pairs(dxf: &str) -> Vec<(i32, String)> {
        let lines: Vec<&str> = dxf.lines().collect();
        assert_eq!(lines.len() % 2, 0, "pairs come in twos");
        lines
            .chunks(2)
            .map(|c| (c[0].trim().parse().expect("group code"), c[1].to_string()))
            .collect()
    }

    fn entities(dxf: &str, kind: &str) -> Vec<Vec<(i32, String)>> {
        let p = pairs(dxf);
        let mut out = Vec::new();
        let mut i = 0;
        while i < p.len() {
            if p[i] == (0, kind.to_string()) {
                let mut j = i + 1;
                while p[j].0 != 0 {
                    j += 1;
                }
                out.push(p[i + 1..j].to_vec());
                i = j;
            } else {
                i += 1;
            }
        }
        out
    }

    fn value(e: &[(i32, String)], code: i32) -> f64 {
        e.iter().find(|(c, _)| *c == code).unwrap().1.parse().unwrap()
    }

    #[test]
    fn a_plain_panel_is_one_closed_rectangle_on_the_cut_layer() {
        let s = spec(json!([{ "id": "p1", "name": "Side", "materialId": "ply", "size": { "l": 24, "w": 12 } }]));
        let dxf = spec_dxf(&s, Units::Fraction);
        assert!(dxf.starts_with("0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n"));
        assert!(dxf.ends_with("0\nEOF\n"));
        let polylines = entities(&dxf, "POLYLINE");
        assert_eq!(polylines.len(), 1);
        assert_eq!(value(&polylines[0], 70), 1.0, "closed");
        let vertices = entities(&dxf, "VERTEX");
        assert_eq!(vertices.len(), 4);
        let xs: Vec<f64> = vertices.iter().map(|v| value(v, 10)).collect();
        let ys: Vec<f64> = vertices.iter().map(|v| value(v, 20)).collect();
        let span = |v: &[f64]| v.iter().cloned().fold(f64::MIN, f64::max) - v.iter().cloned().fold(f64::MAX, f64::min);
        assert_eq!((span(&xs), span(&ys)), (24.0, 12.0));
        assert!(
            entities(&dxf, "TEXT")[0]
                .iter()
                .any(|(c, v)| *c == 1 && v.contains("Side - 0.75 in Birch Plywood"))
        );
    }

    #[test]
    fn holes_and_dados_land_on_layers_named_by_depth_and_side() {
        let s = spec(
            json!([{ "id": "p1", "name": "Side", "materialId": "ply", "size": { "l": 24, "w": 12 },
            "ops": [
                { "type": "hole", "face": "front", "x": 2, "y": 3, "diameter": 0.25, "depth": 0.5 },
                { "type": "hole", "face": "back", "x": 22, "y": 3, "diameter": 0.375 },
                { "type": "dado", "face": "back", "axis": "w", "offset": 12, "width": 0.75, "depth": 0.375 }
            ] }]),
        );
        let dxf = spec_dxf(&s, Units::Fraction);
        let circles = entities(&dxf, "CIRCLE");
        assert_eq!(circles.len(), 2);
        let layer = |e: &[(i32, String)]| e.iter().find(|(c, _)| *c == 8).unwrap().1.clone();
        assert_eq!(layer(&circles[0]), "HOLE_0.5");
        assert_eq!(
            layer(&circles[1]),
            "HOLE_THROUGH",
            "a through hole is the same from either side"
        );
        // The hole sits where the spec says, from the blank's w0 × l0 corner.
        let (bx, by) = (value(&circles[0], 10), value(&circles[0], 20));
        let corner_y = -12.0;
        assert_eq!((bx, by - corner_y), (2.0, 3.0));
        assert_eq!(value(&circles[0], 40), 0.125);
        let polylines = entities(&dxf, "POLYLINE");
        assert_eq!(layer(&polylines[1]), "POCKET_0.375_BACK");
        // Every layer an entity uses is declared.
        let declared: Vec<String> = entities(&dxf, "LAYER")
            .iter()
            .map(|l| l.iter().find(|(c, _)| *c == 2).unwrap().1.clone())
            .collect();
        for name in ["CUT_OUTSIDE", "HOLE_0.5", "HOLE_THROUGH", "POCKET_0.375_BACK", "LABELS"] {
            assert!(declared.contains(&name.to_string()), "{name} declared: {declared:?}");
        }
    }

    #[test]
    fn a_rounded_corner_is_a_true_arc() {
        let s = spec(
            json!([{ "id": "p1", "name": "Top", "materialId": "ply", "size": { "l": 24, "w": 12 },
            "ops": [{ "type": "curve", "kind": "round", "edge": "l0", "corner": "w0", "radius": 2 }] }]),
        );
        let dxf = spec_dxf(&s, Units::Fraction);
        let bulges: Vec<f64> = entities(&dxf, "VERTEX")
            .iter()
            .filter_map(|v| v.iter().find(|(c, _)| *c == 42).map(|(_, b)| b.parse().unwrap()))
            .collect();
        assert_eq!(bulges.len(), 1, "one arc");
        // A quarter turn: bulge = tan(90° / 4).
        assert!((bulges[0].abs() - (PI / 8.0).tan()).abs() < 1e-6, "{bulges:?}");

        // And it turns the right way: a rounded corner's arc runs between its chord and the
        // corner it replaces. (A flipped bulge would scoop the corner inward instead.)
        let vertices = entities(&dxf, "VERTEX");
        let at = |v: &[(i32, String)]| (value(v, 10), value(v, 20));
        let i = vertices.iter().position(|v| v.iter().any(|(c, _)| *c == 42)).unwrap();
        let (p0, p1) = (at(&vertices[i]), at(&vertices[(i + 1) % vertices.len()]));
        let (dx, dy) = (p1.0 - p0.0, p1.1 - p0.1);
        let chord = dx.hypot(dy);
        let sagitta = bulges[0] * chord / 2.0;
        let mid = ((p0.0 + p1.0) / 2.0, (p0.1 + p1.1) / 2.0);
        // Positive bulge = counter-clockwise: the arc lies to the right of p0 → p1.
        let arc_mid = (mid.0 + sagitta * dy / chord, mid.1 - sagitta * dx / chord);
        let corner = (0.0, -12.0); // the w0 × l0 corner: the first part's blank sits at y = -w
        let dist = |p: (f64, f64)| (p.0 - corner.0).hypot(p.1 - corner.1);
        assert!(dist(arc_mid) < dist(mid), "arc bows toward the corner it rounds");
        assert!(arc_mid.0 > 0.0 && arc_mid.1 > -12.0, "and stays on the blank");
        // Its middle is r(1 - 1/√2) in from each edge, as a 2" radius would put it.
        let inset = 2.0 * (1.0 - 1.0 / 2f64.sqrt());
        assert!(
            (arc_mid.0 - inset).abs() < 1e-6 && (arc_mid.1 + 12.0 - inset).abs() < 1e-6,
            "{arc_mid:?}"
        );
    }

    #[test]
    fn metric_writes_millimetres_and_skips_round_stock() {
        let s = spec(json!([
            { "id": "p1", "name": "Shelf", "materialId": "ply", "size": { "l": 10, "w": 5 },
              "ops": [{ "type": "hole", "face": "front", "x": 1, "y": 1, "diameter": 0.25, "depth": 0.5 }] },
            { "id": "p2", "name": "Handle", "materialId": "dowel", "size": { "l": 12, "w": 1 } }
        ]));
        let dxf = spec_dxf(&s, Units::Metric);
        assert!(dxf.contains("$INSUNITS\n70\n4\n"));
        assert_eq!(entities(&dxf, "POLYLINE").len(), 1, "the dowel is not routed");
        assert_eq!(value(&entities(&dxf, "CIRCLE")[0], 40), 3.175);
        assert!(dxf.contains("\nHOLE_12.7\n"));
        assert!(!dxf.contains("Handle"));
    }

    #[test]
    fn parts_never_overlap_in_the_layout() {
        let parts: Vec<_> = (0..12)
            .map(|i| {
                json!({ "id": format!("p{i}"), "name": format!("Part {i}"), "materialId": "ply",
                "size": { "l": 20.0 + i as f64 * 3.0, "w": 6.0 + (i % 4) as f64 * 4.0 } })
            })
            .collect();
        let s = spec(json!(parts));
        let dxf = spec_dxf(&s, Units::Fraction);
        let p = pairs(&dxf);
        // Bounding box per polyline, from its vertices.
        let mut boxes: Vec<[f64; 4]> = Vec::new();
        let mut current: Option<[f64; 4]> = None;
        let mut i = 0;
        while i < p.len() {
            match (p[i].0, p[i].1.as_str()) {
                (0, "POLYLINE") => current = Some([f64::MAX, f64::MAX, f64::MIN, f64::MIN]),
                (0, "SEQEND") => boxes.extend(current.take()),
                (0, "VERTEX") => {
                    let b = current.as_mut().unwrap();
                    let x: f64 = p[i + 2].1.parse().unwrap();
                    let y: f64 = p[i + 3].1.parse().unwrap();
                    *b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
                }
                _ => {}
            }
            i += 1;
        }
        assert_eq!(boxes.len(), 12);
        for (a, x) in boxes.iter().enumerate() {
            for y in &boxes[a + 1..] {
                let apart = x[2] <= y[0] || y[2] <= x[0] || x[3] <= y[1] || y[3] <= x[1];
                assert!(apart, "{x:?} overlaps {y:?}");
            }
        }
        assert!(boxes.iter().all(|b| b[2] <= ROW + 1e-9), "rows wrap at {ROW}");
    }
}
