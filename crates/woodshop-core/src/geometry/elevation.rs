//! The whole piece drawn from the front, the side or the top, with its sizes: the drawings a
//! hobbyist builds from. Each part is projected as cut (its face hull through its thickness, so a
//! tapered leg draws true) and filled, nearest last, so a part in front covers what is behind it
//! and no hidden line shows. The front view also measures the clear openings between shelves.
//!
//! One SVG user unit is one inch of the piece; the root is sized for a page, not 1:1.

use super::frame::{convex_hull, local_axes_world, local_to_world, shape_points};
use super::outline_svg::{esc, n};
use crate::spec::{Op, Spec, Vec3};
use crate::units::{Units, format_length};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    /// From the front (+z), looking back: width across, height up.
    Front,
    /// From the right (+x), looking left: depth across (front on the left), height up.
    Side,
    /// From above, looking down: width across, depth up (back at the top).
    Top,
}

impl View {
    pub fn parse(name: &str) -> Option<View> {
        match name {
            "front" => Some(View::Front),
            "side" => Some(View::Side),
            "top" => Some(View::Top),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            View::Front => "front",
            View::Side => "side",
            View::Top => "top",
        }
    }

    /// A world point on the drawing (x right, y up), and how near the viewer it is.
    fn project(self, p: Vec3) -> ([f64; 2], f64) {
        match self {
            View::Front => ([p[0], p[1]], p[2]),
            View::Side => ([-p[2], p[1]], p[0]),
            View::Top => ([p[0], -p[2]], p[1]),
        }
    }
}

/// One part as the view sees it.
struct Silhouette {
    name: String,
    hull: Vec<[f64; 2]>,
    depth: f64,
    min: [f64; 2],
    max: [f64; 2],
    /// A fixed panel lying flat (a shelf, top or bottom), whose openings the front view measures.
    /// A drawer's bottom is not one: drawers and doors are what the openings hold.
    flat: bool,
    /// Through cutouts seen face-on (a saw well in a top, from above), as closed outlines.
    cutouts: Vec<Vec<[f64; 2]>>,
}

/// A through cutout's outline in the view, when the view looks at the face it is cut in; its
/// rounded corners as short runs of points.
fn cutout_outline(
    part: &crate::spec::Part,
    thickness: f64,
    c: &crate::spec::Cutout,
    view: View,
) -> Option<Vec<[f64; 2]>> {
    let normal = local_axes_world(part)[2];
    let facing = match view {
        View::Front => normal[2],
        View::Side => normal[0],
        View::Top => normal[1],
    };
    if facing.abs() < 0.9 {
        return None;
    }
    let (x0, y0, x1, y1) = c.footprint(part.size.l, part.size.w);
    let r = c.corner();
    let z = thickness / 2.0;
    let mut local = Vec::new();
    let corners = [
        (x1 - r, y0 + r, -90.0),
        (x1 - r, y1 - r, 0.0),
        (x0 + r, y1 - r, 90.0),
        (x0 + r, y0 + r, 180.0),
    ];
    for (cx, cy, start) in corners {
        let steps = if r > 0.0 { 6 } else { 0 };
        for i in 0..=steps {
            let a = (start + 90.0 * i as f64 / steps.max(1) as f64).to_radians();
            local.push([cx + r * a.cos(), cy + r * a.sin(), z]);
        }
    }
    Some(
        local
            .into_iter()
            .map(|p| view.project(local_to_world(part, p)).0)
            .collect(),
    )
}

/// A dimension: from `a` to `b` along x or y, drawn `offset` away (in the drawing's units).
struct Dimension {
    vertical: bool,
    from: f64,
    to: f64,
    /// Where the line runs: a y for a horizontal dimension, an x for a vertical one.
    at: f64,
    /// Extension lines run from here to the line (None: the line is drawn in place).
    witness: Option<f64>,
    label: String,
}

/// The view as an SVG drawing, sized in `units`. Empty designs draw an empty page.
pub fn elevation_svg(spec: &Spec, view: View, units: Units) -> String {
    let mut parts = silhouettes(spec, view);
    parts.sort_by(|a, b| a.depth.total_cmp(&b.depth));
    let (min, max) = parts
        .iter()
        .fold(([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]), |(lo, hi), p| {
            (
                [lo[0].min(p.min[0]), lo[1].min(p.min[1])],
                [hi[0].max(p.max[0]), hi[1].max(p.max[1])],
            )
        });
    if parts.is_empty() || !min[0].is_finite() {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"/>".into();
    }
    let (width, height) = (max[0] - min[0], max[1] - min[1]);
    let size = width.max(height).max(1.0);
    // Type and lines scale with the piece, so a stool and a wardrobe read the same on the page.
    let font = (size / 24.0).max(0.5);
    let gap = font * 1.6;
    let line = size / 450.0;

    let mut dims = vec![
        Dimension {
            vertical: false,
            from: min[0],
            to: max[0],
            at: min[1] - gap * 1.6,
            witness: Some(min[1]),
            label: format_length(width, units),
        },
        Dimension {
            vertical: true,
            from: min[1],
            to: max[1],
            at: max[0] + gap * 1.6,
            witness: Some(max[0]),
            label: format_length(height, units),
        },
    ];
    if view == View::Front {
        dims.extend(openings(&parts, units));
    }

    // The page: the drawing plus room for the overall sizes below and to the right.
    let pad = gap * 1.2;
    let left = min[0] - pad;
    let right = max[0] + gap * 1.6 + font * 1.6 + pad;
    let top = max[1] + pad;
    let bottom = min[1] - gap * 1.6 - font * 1.6 - pad;
    let (page_w, page_h) = (right - left, top - bottom);
    // SVG y runs down: flip about the page.
    let y = |v: f64| top - v;
    let x = |v: f64| v - left;

    let mut body = Vec::new();
    for part in &parts {
        let points: Vec<String> = part
            .hull
            .iter()
            .map(|p| format!("{},{}", n(x(p[0])), n(y(p[1]))))
            .collect();
        body.push(format!(
            "<polygon data-part=\"{}\" points=\"{}\" fill=\"#ffffff\" stroke=\"#1c1917\" stroke-width=\"{}\" stroke-linejoin=\"round\"/>",
            esc(&part.name),
            points.join(" "),
            n(line * 1.6)
        ));
        for outline in &part.cutouts {
            let points: Vec<String> = outline
                .iter()
                .map(|p| format!("{},{}", n(x(p[0])), n(y(p[1]))))
                .collect();
            body.push(format!(
                "<polygon data-cutout=\"{}\" points=\"{}\" fill=\"#f5f5f4\" stroke=\"#1c1917\" stroke-width=\"{}\" stroke-linejoin=\"round\"/>",
                esc(&part.name),
                points.join(" "),
                n(line * 1.6)
            ));
        }
    }
    let ink = "#b45309";
    for d in &dims {
        let tick = font * 0.35;
        let (x1, y1, x2, y2) = if d.vertical {
            (d.at, d.from, d.at, d.to)
        } else {
            (d.from, d.at, d.to, d.at)
        };
        let mut parts = vec![format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\"/>",
            n(x(x1)),
            n(y(y1)),
            n(x(x2)),
            n(y(y2))
        )];
        // Architectural ticks at both ends, and witness lines back to the piece.
        for (px, py) in [(x1, y1), (x2, y2)] {
            parts.push(format!(
                "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\"/>",
                n(x(px - tick)),
                n(y(py - tick)),
                n(x(px + tick)),
                n(y(py + tick))
            ));
            if let Some(w) = d.witness {
                let (wx1, wy1, wx2, wy2) = if d.vertical {
                    (w + gap * 0.25, py, d.at + tick, py)
                } else {
                    (px, w - gap * 0.25, px, d.at - tick)
                };
                parts.push(format!(
                    "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke-width=\"{}\"/>",
                    n(x(wx1)),
                    n(y(wy1)),
                    n(x(wx2)),
                    n(y(wy2)),
                    n(line * 0.6)
                ));
            }
        }
        let mid = (d.from + d.to) / 2.0;
        let text = if d.vertical {
            let (tx, ty) = (x(d.at) - font * 0.35, y(mid));
            format!(
                "<text x=\"{}\" y=\"{}\" transform=\"rotate(-90 {} {})\" text-anchor=\"middle\">{}</text>",
                n(tx),
                n(ty),
                n(tx),
                n(ty),
                text_esc(&d.label)
            )
        } else {
            format!(
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\">{}</text>",
                n(x(mid)),
                n(y(d.at) - font * 0.35),
                text_esc(&d.label)
            )
        };
        body.push(format!(
            "<g data-dimension=\"{}\" stroke=\"{ink}\" stroke-width=\"{}\" fill=\"{ink}\">{}{}</g>",
            if d.vertical { "vertical" } else { "horizontal" },
            n(line),
            parts.join(""),
            text.replace("<text", "<text stroke=\"none\"")
        ));
    }

    // Wide enough to print on a page; the viewBox keeps the proportions.
    let px = 900.0;
    [
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\"".to_string(),
        format!("  width=\"{}\" height=\"{}\"", n(px), n(px * page_h / page_w)),
        format!("  viewBox=\"0 0 {} {}\"", n(page_w), n(page_h)),
        format!(
            "  data-view=\"{}\" data-width=\"{}\" data-height=\"{}\"",
            view.as_str(),
            n(width),
            n(height)
        ),
        format!(
            "  font-family=\"Helvetica, Arial, sans-serif\" font-size=\"{}\">",
            n(font)
        ),
        format!("<title>{} — {} view</title>", esc(&spec.name), view.as_str()),
        format!(
            "<rect width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>",
            n(page_w),
            n(page_h)
        ),
        body.join("\n"),
        "</svg>".into(),
    ]
    .join("\n")
}

/// Text content needs only `&` and `<` escaped; inch marks stay as they read.
fn text_esc(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;")
}

fn silhouettes(spec: &Spec, view: View) -> Vec<Silhouette> {
    let moving: Vec<&str> = spec
        .movables()
        .iter()
        .flat_map(|m| m.part_ids().iter().map(String::as_str))
        .collect();
    spec.parts
        .iter()
        .map(|part| {
            let thickness = spec.thickness_of(part).unwrap_or(0.75);
            let mut depth = 0.0;
            let mut flat_points = Vec::new();
            let points = shape_points(part, thickness);
            for p in &points {
                let (q, d) = view.project(*p);
                depth += d;
                flat_points.push(q);
            }
            depth /= points.len().max(1) as f64;
            let hull = convex_hull(flat_points);
            let (min, max) = hull
                .iter()
                .fold(([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]), |(lo, hi), p| {
                    ([lo[0].min(p[0]), lo[1].min(p[1])], [hi[0].max(p[0]), hi[1].max(p[1])])
                });
            Silhouette {
                name: part.name.clone(),
                hull,
                depth,
                min,
                max,
                flat: local_axes_world(part)[2][1].abs() > 0.9 && !moving.contains(&part.id.as_str()),
                cutouts: part
                    .ops()
                    .iter()
                    .filter_map(|op| match op {
                        Op::Cutout(c) if c.depth.is_none() => cutout_outline(part, thickness, c, view),
                        _ => None,
                    })
                    .collect(),
            }
        })
        .collect()
}

/// The clear height between each pair of flat panels stacked in the same column, measured up the
/// middle of the column: what a shelf holds, or how tall a drawer can be.
fn openings(parts: &[Silhouette], units: Units) -> Vec<Dimension> {
    let flat: Vec<&Silhouette> = parts.iter().filter(|p| p.flat && p.max[0] - p.min[0] >= 3.0).collect();
    // Columns: panels spanning the same stretch of the width.
    let mut columns: Vec<(f64, f64, Vec<&Silhouette>)> = Vec::new();
    for panel in flat {
        let same = |c: &(f64, f64, Vec<&Silhouette>)| {
            let overlap = panel.max[0].min(c.1) - panel.min[0].max(c.0);
            overlap > 0.8 * (panel.max[0] - panel.min[0]).min(c.1 - c.0)
        };
        match columns.iter_mut().find(|c| same(c)) {
            Some(c) => {
                c.0 = c.0.max(panel.min[0]);
                c.1 = c.1.min(panel.max[0]);
                c.2.push(panel);
            }
            None => columns.push((panel.min[0], panel.max[0], vec![panel])),
        }
    }
    let mut dims = Vec::new();
    for (lo, hi, mut stack) in columns {
        stack.sort_by(|a, b| a.min[1].total_cmp(&b.min[1]));
        let at = (lo + hi) / 2.0;
        for pair in stack.windows(2) {
            let (below, above) = (pair[0], pair[1]);
            let clear = above.min[1] - below.max[1];
            if clear > 1.0 {
                dims.push(Dimension {
                    vertical: true,
                    from: below.max[1],
                    to: above.min[1],
                    at,
                    witness: None,
                    label: format_length(clear, units),
                });
            }
        }
    }
    dims
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::overall_size;

    fn template(name: &str) -> Spec {
        crate::templates::find(name).unwrap()
    }

    fn attr(svg: &str, name: &str) -> f64 {
        let key = format!("{name}=\"");
        let start = svg.find(&key).unwrap() + key.len();
        svg[start..].split('"').next().unwrap().parse().unwrap()
    }

    #[test]
    fn each_view_measures_the_overall_size() {
        let spec = template("bookshelf");
        let size = overall_size(&spec).unwrap();
        let front = elevation_svg(&spec, View::Front, Units::Fraction);
        assert!((attr(&front, "data-width") - size.width).abs() < 1e-6);
        assert!((attr(&front, "data-height") - size.height).abs() < 1e-6);
        assert!(
            front.contains(">32\"</text>") && front.contains(">72\"</text>"),
            "{front}"
        );
        let side = elevation_svg(&spec, View::Side, Units::Fraction);
        assert!((attr(&side, "data-width") - size.depth).abs() < 1e-6);
        assert!(side.contains(">11 1/4\"</text>"));
        let top = elevation_svg(&spec, View::Top, Units::Metric);
        assert!((attr(&top, "data-height") - size.depth).abs() < 1e-6);
        assert!(top.contains(">813 mm</text>"), "{top}");
    }

    #[test]
    fn the_front_view_gives_the_clear_height_between_shelves() {
        // Bottom 0–0.75, shelves at 18, 36, 54 (3/4" thick), top 71.25–72: four openings.
        let spec = template("bookshelf");
        let front = elevation_svg(&spec, View::Front, Units::Fraction);
        let labels: Vec<&str> = front
            .split("<text")
            .skip(1)
            .map(|t| t.split('>').nth(1).unwrap().split('<').next().unwrap())
            .collect();
        assert_eq!(labels, ["32\"", "72\"", "16 7/8\"", "17 1/4\"", "17 1/4\"", "16 7/8\""]);
    }

    #[test]
    fn a_drawer_is_not_a_shelf() {
        // The nightstand's opening runs from the open shelf up to the front rail, past the drawer.
        let spec = template("nightstand");
        let front = elevation_svg(&spec, View::Front, Units::Fraction);
        assert_eq!(front.matches("data-dimension=\"vertical\"").count(), 2, "{front}");
    }

    #[test]
    fn nearer_parts_are_drawn_last_so_they_cover_what_is_behind() {
        let spec = template("bookshelf");
        let front = elevation_svg(&spec, View::Front, Units::Fraction);
        let back = front.find("data-part=\"Back Panel\"").unwrap();
        let shelf = front.find("data-part=\"Shelf 1\"").unwrap();
        assert!(back < shelf);
    }

    #[test]
    fn a_saw_well_shows_from_above_and_not_from_the_front() {
        let mut spec = template("bookshelf");
        let top = spec.parts.iter_mut().find(|p| p.name.contains("Top")).expect("a top");
        let (l, w) = (top.size.l, top.size.w);
        top.ops.get_or_insert_with(Vec::new).push(
            serde_json::from_value(serde_json::json!({
                "type": "cutout", "face": "front", "x": l / 2.0, "y": w / 2.0, "length": 8, "width": 4, "radius": 0.5
            }))
            .unwrap(),
        );
        assert_eq!(
            elevation_svg(&spec, View::Top, Units::Fraction)
                .matches("data-cutout")
                .count(),
            1
        );
        assert_eq!(
            elevation_svg(&spec, View::Front, Units::Fraction)
                .matches("data-cutout")
                .count(),
            0
        );
    }

    #[test]
    fn a_tapered_leg_draws_as_cut() {
        // The picnic table's legs are cut at 30° top and bottom: from the side they stand flat on
        // the floor and the drawing is no taller than the table.
        let spec = template("picnic-table");
        let side = elevation_svg(&spec, View::Side, Units::Fraction);
        assert!((attr(&side, "data-height") - 29.0).abs() < 1e-3, "{side}");
    }
}
