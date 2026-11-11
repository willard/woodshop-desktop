//! A part drawn as an SVG shop template: full size, printable, and readable by an agent.
//!
//! Coordinates inside the drawing group are literally §3.1 local inches. One SVG user unit is one
//! inch and the root carries `in` dimensions, so printing at 100% gives a 1:1 pattern.

use std::f64::consts::PI;

use super::Aabb;
use super::op_extent::local_box;
use super::outline::{self, Segment};
use crate::spec::{Op, Part};
use crate::units::{Units, format_length};

/// Paper margin around the blank, in inches.
const MARGIN: f64 = 1.0;
/// Cut line: the heaviest thing on the page — it is the line you saw to.
const CUT_WIDTH: &str = "0.025";
const THIN_WIDTH: &str = "0.012";
const FONT: f64 = 0.18;

pub fn render(part: &Part, thickness: f64, material_name: &str, notes: &[String]) -> String {
    render_in(part, thickness, material_name, notes, Units::Fraction)
}

/// [`render`], with the sizes written in the reader's units. The drawing itself is always 1:1.
pub fn render_in(part: &Part, thickness: f64, material_name: &str, notes: &[String], units: Units) -> String {
    let (l, w) = (part.size.l, part.size.w);
    let m = MARGIN;
    let width = l + 2.0 * m;
    let drawn = w + 2.0 * m;

    // The title block gets its own strip BELOW the drawing rather than sharing the margin.
    let lines = captions(part, l, w, thickness, material_name, notes, units);
    let height = drawn + FONT * 1.35 * (lines.len() as f64 + 1.0);

    let mut body = vec![
        // Y-flipped so path coordinates are local inches. Text must NOT live in here.
        format!(
            "<g transform=\"translate({} {}) scale(1 -1)\">",
            n(m + l / 2.0),
            n(m + w / 2.0)
        ),
        blank(l, w),
        cut_path(part),
    ];
    let op_marks = ops(part, thickness);
    if !op_marks.is_empty() {
        body.push(op_marks);
    }
    body.push("</g>".into());
    body.push(labels(&lines, l, w, m, drawn, units));

    [
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\"".to_string(),
        format!("  width=\"{}in\" height=\"{}in\"", n(width), n(height)),
        format!("  viewBox=\"0 0 {} {}\"", n(width), n(height)),
        format!("  data-part-id=\"{}\"", esc(&part.id)),
        format!("  data-blank-length=\"{}\" data-blank-width=\"{}\">", n(l), n(w)),
        format!("<title>{} — 1:1 shop template</title>", esc(&part.name)),
        format!(
            "<rect width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>",
            n(width),
            n(height)
        ),
        body.join("\n"),
        "</svg>".into(),
    ]
    .join("\n")
}

fn blank(l: f64, w: f64) -> String {
    format!(
        "<rect data-role=\"blank\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"#a8a29e\" stroke-width=\"{THIN_WIDTH}\" stroke-dasharray=\"0.12 0.08\"/>",
        n(-l / 2.0),
        n(-w / 2.0),
        n(l),
        n(w)
    )
}

fn cut_path(part: &Part) -> String {
    let outline = outline::for_part(part);
    format!(
        "<path data-role=\"cut\" d=\"{}\" fill=\"none\" stroke=\"#1c1917\" stroke-width=\"{CUT_WIDTH}\" stroke-linejoin=\"round\"/>",
        path_data(&outline.segments)
    )
}

/// Segment list → SVG path data. A `THREE.Path` line-tos an arc's start implicitly, so this does
/// too; arc flags come from the swept angle computed as `THREE.EllipseCurve` does.
pub fn path_data(segments: &[Segment]) -> String {
    let mut d: Vec<String> = Vec::new();
    let mut cur: Option<(f64, f64)> = None;

    for segment in segments {
        match *segment {
            Segment::Line { x, y, .. } => {
                d.push(format!("{} {} {}", if cur.is_none() { "M" } else { "L" }, n(x), n(y)));
                cur = Some((x, y));
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
                let (sx, sy) = (cx + r * a0.cos(), cy + r * a0.sin());
                match cur {
                    None => d.push(format!("M {} {}", n(sx), n(sy))),
                    Some((x, y)) if (sx - x).hypot(sy - y) > 1e-9 => d.push(format!("L {} {}", n(sx), n(sy))),
                    _ => {}
                }
                let delta = swept_angle(a0, a1, clockwise);
                let (ex, ey) = (cx + r * a1.cos(), cy + r * a1.sin());
                let large = u8::from(delta.abs() > PI);
                let sweep = u8::from(delta > 0.0);
                d.push(format!("A {} {} 0 {large} {sweep} {} {}", n(r), n(r), n(ex), n(ey)));
                cur = Some((ex, ey));
            }
        }
    }
    d.push("Z".into());
    d.join(" ")
}

/// The angle actually swept, matching `THREE.EllipseCurve.getPoint`.
pub fn swept_angle(a0: f64, a1: f64, clockwise: bool) -> f64 {
    let two_pi = 2.0 * PI;
    let mut delta = a1 - a0;
    let same = delta.abs() < f64::EPSILON;
    while delta < 0.0 {
        delta += two_pi;
    }
    while delta > two_pi {
        delta -= two_pi;
    }
    if delta < f64::EPSILON {
        delta = if same { 0.0 } else { two_pi };
    }
    if clockwise && !same {
        delta = if delta == two_pi { -two_pi } else { delta - two_pi };
    }
    delta
}

/// Ops the outline does not already show: holes, channels, fastener rows.
fn ops(part: &Part, thickness: f64) -> String {
    let mut out = Vec::new();
    for (index, op) in part.ops().iter().enumerate() {
        // notch and curve ARE the outline — drawing them again would double the cut line.
        if matches!(op, Op::Notch(_) | Op::Curve(_)) {
            continue;
        }
        let Some(b) = local_box(op, part, thickness) else {
            continue;
        };
        let attrs = format!(" data-op-index=\"{index}\" data-op-type=\"{}\"", op.type_name());
        out.push(match op {
            Op::Hole(h) => hole(h.diameter, &b, &attrs),
            Op::PocketHoles(p) => fastener_run(p.count, &b, &attrs),
            Op::Screws(s) => fastener_run(s.count, &b, &attrs),
            _ => footprint(&b, &attrs),
        });
    }
    out.join("\n")
}

fn hole(diameter: f64, b: &Aabb, attrs: &str) -> String {
    let cx = (b.min[0] + b.max[0]) / 2.0;
    let cy = (b.min[1] + b.max[1]) / 2.0;
    let r = diameter / 2.0;
    let tick = r + 0.15;
    format!(
        "<g{attrs}><circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"none\" stroke=\"#1c1917\" stroke-width=\"{THIN_WIDTH}\"/><path d=\"M {} {} L {} {} M {} {} L {} {}\" stroke=\"#dc2626\" stroke-width=\"{THIN_WIDTH}\"/></g>",
        n(cx),
        n(cy),
        n(r),
        n(cx - tick),
        n(cy),
        n(cx + tick),
        n(cy),
        n(cx),
        n(cy - tick),
        n(cx),
        n(cy + tick),
    )
}

fn fastener_run(count: u32, b: &Aabb, attrs: &str) -> String {
    let count = count.max(1);
    let marks: String = (0..count)
        .map(|i| {
            // Evenly spaced along the run, inset half a step from each end.
            let t = if count == 1 { 0.5 } else { (i as f64 + 0.5) / count as f64 };
            let x = b.min[0] + (b.max[0] - b.min[0]) * t;
            let y = b.min[1] + (b.max[1] - b.min[1]) * t;
            format!(
                "<circle cx=\"{}\" cy=\"{}\" r=\"0.06\" fill=\"none\" stroke=\"#dc2626\" stroke-width=\"{THIN_WIDTH}\"/>",
                n(x),
                n(y)
            )
        })
        .collect();
    format!("<g{attrs}>{marks}</g>")
}

fn footprint(b: &Aabb, attrs: &str) -> String {
    let w = b.max[0] - b.min[0];
    let h = b.max[1] - b.min[1];
    // A zero-width footprint (an ease, a miter) draws as a line, not a rectangle.
    if w < 1e-9 || h < 1e-9 {
        return format!(
            "<path{attrs} d=\"M {} {} L {} {}\" stroke=\"#0284c7\" stroke-width=\"{THIN_WIDTH}\" stroke-dasharray=\"0.08 0.06\"/>",
            n(b.min[0]),
            n(b.min[1]),
            n(b.max[0]),
            n(b.max[1])
        );
    }
    format!(
        "<rect{attrs} x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"#0284c7\" stroke-width=\"{THIN_WIDTH}\" stroke-dasharray=\"0.08 0.06\"/>",
        n(b.min[0]),
        n(b.min[1]),
        n(w),
        n(h)
    )
}

fn captions(
    part: &Part,
    l: f64,
    w: f64,
    thickness: f64,
    material_name: &str,
    notes: &[String],
    units: Units,
) -> Vec<String> {
    let mut lines = vec![
        esc(&part.name),
        format!(
            "Blank {} × {} × {}{}",
            format_length(l, units),
            format_length(w, units),
            format_length(thickness, units),
            if material_name.is_empty() {
                String::new()
            } else {
                format!(" — {}", esc(material_name))
            }
        ),
        "SCALE 1:1 — print at 100%, no fit-to-page".into(),
        "Datum (0,0) is the w0 × l0 corner, bottom-left as drawn.".into(),
    ];
    lines.extend(notes.iter().map(|note| esc(note)));
    lines
}

fn labels(lines: &[String], l: f64, w: f64, m: f64, drawn: f64, units: Units) -> String {
    let mut text = vec![
        // Overall dimensions, centred on each edge, just outside the blank.
        text_el(m + l / 2.0, m / 2.0, &esc(&format_length(l, units)), "middle"),
        text_el(m / 2.0, m + w / 2.0, &esc(&format_length(w, units)), "middle"),
    ];
    for (i, line) in lines.iter().enumerate() {
        text.push(text_el(m, drawn + FONT * 1.35 * (i as f64 + 1.0), line, "start"));
    }
    format!(
        "<g data-role=\"labels\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"{FONT}\" fill=\"#44403c\">\n{}\n</g>",
        text.join("\n")
    )
}

fn text_el(x: f64, y: f64, content: &str, anchor: &str) -> String {
    format!(
        "<text x=\"{}\" y=\"{}\" text-anchor=\"{anchor}\">{content}</text>",
        n(x),
        n(y)
    )
}

/// Trimmed decimals — an SVG full of 15-digit floats is four times the size for no gain.
pub fn n(value: f64) -> String {
    let s = format!("{value:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    match s {
        "" | "-0" => "0".into(),
        s => s.into(),
    }
}

pub fn esc(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_numbers() {
        assert_eq!(n(1.5), "1.5");
        assert_eq!(n(2.0), "2");
        assert_eq!(n(-0.0000001), "0");
        assert_eq!(n(0.1234567), "0.123457");
    }
}
