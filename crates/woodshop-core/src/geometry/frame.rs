//! Part frames. §3.1: every part has a local frame — length along +X, width along +Y, thickness
//! along +Z, origin at the centre — and `transform.rot` (intrinsic Euler XYZ degrees, as three.js)
//! turns it into the assembly.

use serde::Serialize;

use crate::geometry::outline::{self, Segment};
use crate::geometry::outline_svg::swept_angle;
use crate::spec::{Op, Part, Spec, Vec3};

/// Parts closer than this (inches) count as touching.
pub const TOUCH_TOL: f64 = 0.02;

pub const DEG2RAD: f64 = std::f64::consts::PI / 180.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Aabb {
    pub min: Vec3,
    pub max: Vec3,
}

impl Aabb {
    pub const EMPTY: Aabb = Aabb {
        min: [f64::INFINITY; 3],
        max: [f64::NEG_INFINITY; 3],
    };

    pub fn include(&mut self, p: Vec3) {
        for ((lo, hi), v) in self.min.iter_mut().zip(self.max.iter_mut()).zip(p) {
            *lo = lo.min(v);
            *hi = hi.max(v);
        }
    }

    pub fn union(&mut self, other: &Aabb) {
        self.include(other.min);
        self.include(other.max);
    }

    pub fn size(&self) -> Vec3 {
        [
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        ]
    }
}

pub type Mat3 = [[f64; 3]; 3];

/// Rows of the Euler-'XYZ' rotation matrix (matches three.js `makeRotationFromEuler`).
pub fn rotation_rows(rot: Vec3) -> Mat3 {
    let (s1, c1) = (rot[0] * DEG2RAD).sin_cos();
    let (s2, c2) = (rot[1] * DEG2RAD).sin_cos();
    let (s3, c3) = (rot[2] * DEG2RAD).sin_cos();
    [
        [c2 * c3, -c2 * s3, s2],
        [c1 * s3 + c3 * s1 * s2, c1 * c3 - s1 * s2 * s3, -c2 * s1],
        [s1 * s3 - c1 * c3 * s2, c3 * s1 + c1 * s2 * s3, c1 * c2],
    ]
}

/// World directions of a part's local X/Y/Z axes (the matrix columns).
pub fn local_axes_world(part: &Part) -> [Vec3; 3] {
    let m = rotation_rows(part.transform.rot());
    [
        [m[0][0], m[1][0], m[2][0]],
        [m[0][1], m[1][1], m[2][1]],
        [m[0][2], m[1][2], m[2][2]],
    ]
}

/// One local-frame point in world inches.
pub fn to_world(part: &Part, m: &Mat3, local: Vec3) -> Vec3 {
    let pos = part.transform.pos;
    std::array::from_fn(|i| pos[i] + m[i][0] * local[0] + m[i][1] * local[1] + m[i][2] * local[2])
}

/// One local-frame point in world inches (computes the matrix).
pub fn local_to_world(part: &Part, local: Vec3) -> Vec3 {
    to_world(part, &rotation_rows(part.transform.rot()), local)
}

/// The eight box corners in world inches.
pub fn corners(part: &Part, thickness: f64) -> [Vec3; 8] {
    let m = rotation_rows(part.transform.rot());
    let h = [part.size.l / 2.0, part.size.w / 2.0, thickness / 2.0];
    let mut out = [[0.0; 3]; 8];
    let mut k = 0;
    for sx in [-h[0], h[0]] {
        for sy in [-h[1], h[1]] {
            for sz in [-h[2], h[2]] {
                out[k] = to_world(part, &m, [sx, sy, sz]);
                k += 1;
            }
        }
    }
    out
}

/// Whether a curve or notch reshapes the part's face, so its solid is less than its blank.
fn is_shaped(part: &Part) -> bool {
    part.ops().iter().any(|op| matches!(op, Op::Curve(_) | Op::Notch(_)))
}

/// The convex hull of the part's face in its local XY frame, counter-clockwise: the blank's four
/// corners, or for a shaped part the outline's corners and points along its arcs. A notch is
/// concave, so the hull still covers it; a taper or a curve is cut away.
pub fn face_hull(part: &Part) -> Vec<[f64; 2]> {
    let (l, w) = (part.size.l / 2.0, part.size.w / 2.0);
    if !is_shaped(part) {
        return vec![[-l, -w], [l, -w], [l, w], [-l, w]];
    }
    let mut points: Vec<[f64; 2]> = Vec::new();
    for segment in outline::for_part(part).segments {
        match segment {
            Segment::Line { x, y, .. } => points.push([x, y]),
            Segment::Arc {
                cx,
                cy,
                r,
                a0,
                a1,
                clockwise,
                ..
            } => {
                let sweep = swept_angle(a0, a1, clockwise);
                for i in 0..=16 {
                    let a = a0 + sweep * f64::from(i) / 16.0;
                    points.push([cx + r * a.cos(), cy + r * a.sin()]);
                }
            }
        }
    }
    convex_hull(points)
}

/// Andrew's monotone chain; counter-clockwise, no repeated or collinear points.
pub(crate) fn convex_hull(mut points: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    points.retain(|p| p[0].is_finite() && p[1].is_finite());
    points.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    points.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
    if points.len() < 3 {
        return points;
    }
    let turn = |o: [f64; 2], a: [f64; 2], b: [f64; 2]| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut hull: Vec<[f64; 2]> = Vec::with_capacity(points.len() * 2);
    for pass in [false, true] {
        let start = hull.len();
        let ordered: Box<dyn Iterator<Item = &[f64; 2]>> = if pass {
            Box::new(points.iter().rev())
        } else {
            Box::new(points.iter())
        };
        for &p in ordered {
            while hull.len() >= start + 2 && turn(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 1e-12 {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
    }
    hull
}

/// The part's solid as world points: its face hull on both faces.
pub fn shape_points(part: &Part, thickness: f64) -> Vec<Vec3> {
    let m = rotation_rows(part.transform.rot());
    let h = thickness / 2.0;
    face_hull(part)
        .into_iter()
        .flat_map(|[x, y]| [to_world(part, &m, [x, y, -h]), to_world(part, &m, [x, y, h])])
        .collect()
}

/// The world box around what is left of the part once its curves are cut.
pub fn world_aabb(part: &Part, thickness: f64) -> Aabb {
    let mut b = Aabb::EMPTY;
    for c in shape_points(part, thickness) {
        b.include(c);
    }
    b
}

/// Per-axis intersection interval of two boxes; `max - min` < 0 means separated on that axis.
pub fn overlap_extents(a: &Aabb, b: &Aabb) -> [(f64, f64); 3] {
    std::array::from_fn(|i| (a.min[i].max(b.min[i]), a.max[i].min(b.max[i])))
}

/// Largest per-axis gap: > 0 separated, ≤ 0 touching or overlapping.
pub fn separation(a: &Aabb, b: &Aabb) -> f64 {
    (0..3).fold(f64::NEG_INFINITY, |sep, i| {
        sep.max(a.min[i] - b.max[i]).max(b.min[i] - a.max[i])
    })
}

fn dot(u: Vec3, v: Vec3) -> f64 {
    u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
}

fn cross(u: Vec3, v: Vec3) -> Vec3 {
    [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ]
}

/// Minimum penetration depth between two parts' solids (separating-axis theorem): each is its
/// face hull extruded through its thickness, so a plain part is its oriented box and a tapered or
/// curved one is what is left once it is cut. ≤ 0 = separated or touching face-to-face; > 0 =
/// interpenetration by that depth.
pub fn obb_penetration(a: &Part, ta: f64, b: &Part, tb: f64) -> f64 {
    let solid = |part: &Part, t: f64| {
        let m = rotation_rows(part.transform.rot());
        let hull = face_hull(part);
        let normal = to_world_dir(&m, [0.0, 0.0, 1.0]);
        // Each hull edge's direction; its in-plane normal is a face of the prism.
        let edges: Vec<Vec3> = (0..hull.len())
            .map(|i| {
                let (p, q) = (hull[i], hull[(i + 1) % hull.len()]);
                to_world_dir(&m, [q[0] - p[0], q[1] - p[1], 0.0])
            })
            .collect();
        let faces: Vec<Vec3> = edges.iter().map(|e| cross(*e, normal)).chain([normal]).collect();
        let directions: Vec<Vec3> = edges.into_iter().chain([normal]).collect();
        let h = t / 2.0;
        let points: Vec<Vec3> = hull
            .iter()
            .flat_map(|&[x, y]| [to_world(part, &m, [x, y, -h]), to_world(part, &m, [x, y, h])])
            .collect();
        (faces, directions, points)
    };
    let (faces_a, dirs_a, points_a) = solid(a, ta);
    let (faces_b, dirs_b, points_b) = solid(b, tb);

    let mut candidates: Vec<Vec3> = faces_a.iter().chain(&faces_b).copied().collect();
    for u in &dirs_a {
        for v in &dirs_b {
            candidates.push(cross(*u, *v));
        }
    }
    let project = |points: &[Vec3], axis: Vec3| {
        points.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            let d = dot(*p, axis);
            (lo.min(d), hi.max(d))
        })
    };

    let mut min_overlap = f64::INFINITY;
    for axis in candidates {
        let len = dot(axis, axis).sqrt();
        if len < 1e-6 {
            continue; // parallel edges: degenerate cross product
        }
        let axis = [axis[0] / len, axis[1] / len, axis[2] / len];
        let (a_lo, a_hi) = project(&points_a, axis);
        let (b_lo, b_hi) = project(&points_b, axis);
        let overlap = (a_hi - b_lo).min(b_hi - a_lo);
        if overlap <= 0.0 {
            return overlap;
        }
        min_overlap = min_overlap.min(overlap);
    }
    min_overlap
}

/// A local direction turned into the world (no translation).
fn to_world_dir(m: &Mat3, v: Vec3) -> Vec3 {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// The finished piece's overall size in world inches (x = width, z = depth, y = height).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct OverallSize {
    pub width: f64,
    pub depth: f64,
    pub height: f64,
}

pub fn round_to(n: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (n * f).round() / f
}

/// `None` for a design with no parts (0 × 0 × 0 would read as an answer).
pub fn overall_size(spec: &Spec) -> Option<OverallSize> {
    if spec.parts.is_empty() {
        return None;
    }
    let mut total = Aabb::EMPTY;
    for part in &spec.parts {
        total.union(&world_aabb(part, spec.thickness_of(part).unwrap_or(0.0)));
    }
    // Hardware that stands proud of the piece counts too: a workbench on casters is as tall as
    // it stands, and a pull sets how close the piece can sit to a wall.
    for mount in spec.hardware() {
        let (Some(part), Some(item)) = (spec.part(&mount.part_id), crate::hardware::find(&mount.item)) else {
            continue;
        };
        // A folding bracket counts locked out, as the wing it holds does.
        let reach = ["height", "projection", "arm"]
            .iter()
            .find_map(|k| item.model.get(*k).and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        let frame = crate::hardware::mount_frame(part, spec.thickness_of(part).unwrap_or(0.0), mount);
        let tip: Vec3 = std::array::from_fn(|i| frame.point[i] + frame.normal[i] * reach);
        total.include(local_to_world(part, frame.point));
        total.include(local_to_world(part, tip));
    }
    let s = total.size();
    Some(OverallSize {
        width: round_to(s[0], 4),
        depth: round_to(s[2], 4),
        height: round_to(s[1], 4),
    })
}

const AXES: [&str; 3] = ["x", "y", "z"];

fn direction_word(signed: &str) -> &'static str {
    match signed {
        "+x" => "right",
        "-x" => "left",
        "+y" => "up",
        "-y" => "down",
        "+z" => "front",
        _ => "back",
    }
}

/// `"+x (right)"`, or the components with `(oblique)` when not within ~1° of a world axis.
/// Directions are named from the editor's default camera (viewer at +Z, +X to the right).
pub fn describe_axis(axis: Vec3) -> String {
    let mut best = 0;
    for i in 1..3 {
        if axis[i].abs() > axis[best].abs() {
            best = i;
        }
    }
    if axis[best].abs() < 0.9998 {
        let c = axis.map(|v| php_float(round_to(v, 4)));
        return format!("[{}, {}, {}] (oblique)", c[0], c[1], c[2]);
    }
    let signed = format!("{}{}", if axis[best] < 0.0 { "-" } else { "+" }, AXES[best]);
    let word = direction_word(&signed);
    format!("{signed} ({word})")
}

/// Which world axis each local axis lands on: `(length, width, thickness)`.
pub fn axis_map(part: &Part) -> (String, String, String) {
    let [x, y, z] = local_axes_world(part);
    (describe_axis(x), describe_axis(y), describe_axis(z))
}

/// Which world direction the local front (+Z) and back (−Z) faces point.
pub fn face_map(part: &Part) -> (String, String) {
    let [_, _, z] = local_axes_world(part);
    (describe_axis(z), describe_axis([-z[0], -z[1], -z[2]]))
}

/// Shortest decimal rendering of a float, integral values without a decimal point (as PHP and
/// JS print numbers in messages): 2 → "2", 0.5 → "0.5", -0 → "0".
pub fn php_float(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    if v.fract() == 0.0 && v.abs() < 1e15 {
        return format!("{}", v as i64);
    }
    format!("{v}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{Size2, Transform};

    fn part(l: f64, w: f64, pos: Vec3, rot: Vec3) -> Part {
        Part {
            id: "p".into(),
            name: "P".into(),
            material_id: "m".into(),
            size: Size2 { l, w },
            grain_axis: None,
            transform: Transform { pos, rot: Some(rot) },
            ops: None,
            qty: None,
            locked: None,
            edge_band: None,
        }
    }

    #[test]
    fn rot_y_90_maps_length_to_minus_z() {
        let p = part(10.0, 4.0, [0.0; 3], [0.0, 90.0, 0.0]);
        assert_eq!(axis_map(&p).0, "-z (back)");
        let b = world_aabb(&p, 1.0);
        assert!((b.max[2] - 5.0).abs() < 1e-9 && (b.max[0] - 0.5).abs() < 1e-9);
    }

    #[test]
    fn touching_boxes_do_not_penetrate() {
        let a = part(10.0, 10.0, [0.0; 3], [0.0; 3]);
        let b = part(10.0, 10.0, [0.0, 0.0, 1.0], [0.0; 3]);
        assert!(obb_penetration(&a, 1.0, &b, 1.0) <= 1e-12);
        let c = part(10.0, 10.0, [0.0, 0.0, 0.5], [0.0; 3]);
        assert!((obb_penetration(&a, 1.0, &c, 1.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn a_tapered_part_is_what_is_left_after_the_cut() {
        use crate::spec::{Curve, Edge, Op};
        // A 10 × 4 board with its right end cut at an angle: the top-right corner moves in 3".
        let mut board = part(10.0, 4.0, [0.0; 3], [0.0; 3]);
        board.ops = Some(vec![Op::Curve(Curve::Taper {
            edge: Edge::W1,
            height: 3.0,
            low: Edge::L1,
            from: None,
        })]);
        let hull = face_hull(&board);
        assert_eq!(hull.len(), 4, "{hull:?}");
        assert!(hull.contains(&[2.0, 2.0]) && hull.contains(&[5.0, -2.0]), "{hull:?}");
        // The box no longer reaches the corner that was cut off…
        let b = world_aabb(&board, 1.0);
        assert_eq!((b.min[0], b.max[0], b.max[1]), (-5.0, 5.0, 2.0));
        // …so a block sitting in the cut-away corner does not run into it, though it would
        // into the uncut blank.
        let block = part(1.0, 1.0, [4.4, 1.4, 0.0], [0.0; 3]);
        assert!(obb_penetration(&board, 1.0, &block, 1.0) <= 0.0);
        board.ops = None;
        assert!(obb_penetration(&board, 1.0, &block, 1.0) > 0.5);
    }
}

#[cfg(test)]
mod overall_with_hardware {
    use crate::spec::parse;
    use serde_json::json;

    #[test]
    fn casters_count_toward_the_height() {
        let spec = |hardware| {
            parse(json!({
                "specVersion": "1.22", "units": "in", "name": "T",
                "materials": [{ "id": "m_2x4", "type": "lumber", "name": "2x4", "thickness": 1.5, "stockWidth": 3.5 }],
                // A leg standing on end, its w0 end at 4" off the floor.
                "parts": [{ "id": "p_leg", "name": "Leg", "materialId": "m_2x4", "size": { "l": 30, "w": 3.5 },
                            "transform": { "pos": [0, 19, 0], "rot": [0, 0, 90] } }],
                "hardware": hardware,
            }))
            .unwrap()
        };
        assert_eq!(super::overall_size(&spec(json!([]))).unwrap().height, 30.0);
        let caster = json!([{ "id": "hw_c", "item": "caster.locking-3in", "partId": "p_leg", "side": "w0", "x": 1.75, "y": 0.75 }]);
        assert_eq!(super::overall_size(&spec(caster)).unwrap().height, 33.9);
    }
}
