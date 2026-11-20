//! Quick build: a sound starting design from a few sizes. Each generator returns an ordinary
//! spec, every part placed, joined and fastened so it passes the design checks, for the user to
//! change from there. Sizes are the finished outside dimensions, in inches.
//!
//! - Shelf unit: plywood sides, top, bottom and evenly spaced shelves, with or without a back.
//! - Box: plywood front, back, ends and bottom, open at the top.
//! - Table: a plywood top on 2x2 legs, with or without a 1x3 apron frame.
//! - Frame: an open 2x4 stand, rails top and bottom on all four sides.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::spec::{self, Spec};
use crate::units::fraction::inch_label;

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QuickBuild {
    #[serde(rename_all = "camelCase")]
    ShelfUnit {
        width: f64,
        height: f64,
        depth: f64,
        shelves: u32,
        back: bool,
    },
    Box {
        width: f64,
        height: f64,
        depth: f64,
    },
    Table {
        width: f64,
        depth: f64,
        height: f64,
        apron: bool,
    },
    Frame {
        width: f64,
        depth: f64,
        height: f64,
    },
}

/// The smallest and largest sizes a quick build takes, inches.
pub const MIN_SIZE: f64 = 8.0;
pub const MAX_SIZE: f64 = 96.0;
pub const MAX_SHELVES: u32 = 12;

const PLY: f64 = 0.75;
/// The plywood sheet every panel is cut from, inches.
const SHEET: (f64, f64) = (96.0, 48.0);

impl QuickBuild {
    /// What is wrong with the sizes, in words a person can act on; None when it can be built.
    pub fn problem(&self) -> Option<String> {
        let sizes: Vec<(&str, f64)> = match *self {
            QuickBuild::ShelfUnit {
                width, height, depth, ..
            }
            | QuickBuild::Box { width, height, depth }
            | QuickBuild::Table {
                width, depth, height, ..
            }
            | QuickBuild::Frame { width, depth, height } => {
                vec![("width", width), ("height", height), ("depth", depth)]
            }
        };
        for (name, value) in sizes {
            if !(MIN_SIZE..=MAX_SIZE).contains(&value) {
                return Some(format!(
                    "The {name} must be between {MIN_SIZE}\" and {MAX_SIZE}\" (it is {value}\")."
                ));
            }
        }
        if let QuickBuild::ShelfUnit { height, shelves, .. } = *self {
            if shelves > MAX_SHELVES {
                return Some(format!("At most {MAX_SHELVES} shelves."));
            }
            // Each opening at least 4" clear.
            let openings = f64::from(shelves + 1);
            if (height - 2.0 * PLY - f64::from(shelves) * PLY) / openings < 4.0 {
                return Some(format!(
                    "{shelves} shelves leave less than 4\" between them in a {height}\" tall unit. Use fewer shelves or make it taller."
                ));
            }
        }
        None
    }

    /// The design, named `name`. Errors when [`QuickBuild::problem`] has one.
    pub fn build(&self, name: &str) -> Result<Spec, String> {
        if let Some(problem) = self.problem() {
            return Err(problem);
        }
        let value = match *self {
            QuickBuild::ShelfUnit {
                width,
                height,
                depth,
                shelves,
                back,
            } => shelf_unit(width, height, depth, shelves, back),
            QuickBuild::Box { width, height, depth } => open_box(width, height, depth),
            QuickBuild::Table {
                width,
                depth,
                height,
                apron,
            } => table(width, depth, height, apron),
            QuickBuild::Frame { width, depth, height } => frame(width, depth, height),
        };
        let mut value = value;
        // Every plywood panel must come out of one sheet.
        for p in value["parts"].as_array().into_iter().flatten() {
            if p["materialId"] != "mat_ply" {
                continue;
            }
            let (l, w) = (
                p["size"]["l"].as_f64().unwrap_or(0.0),
                p["size"]["w"].as_f64().unwrap_or(0.0),
            );
            if l.max(w) > SHEET.0 || l.min(w) > SHEET.1 {
                return Err(format!(
                    "The {} would be {} × {}, bigger than a {} × {} sheet. Make the piece smaller{}.",
                    p["name"].as_str().unwrap_or("panel").to_lowercase(),
                    inch_label(l),
                    inch_label(w),
                    inch_label(SHEET.0),
                    inch_label(SHEET.1),
                    if p["id"] == "p_back" {
                        ", or leave the back off"
                    } else {
                        ""
                    }
                ));
            }
        }
        value["specVersion"] = spec::migrate::CURRENT_SPEC_VERSION.into();
        value["units"] = "in".into();
        value["name"] = name.into();
        spec::parse(value).map_err(|e| e.messages().join("; "))
    }
}

fn round(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// A part: `rot` turns the local frame (l along x, w along y, thickness along z) into place.
fn part(id: &str, name: &str, material: &str, l: f64, w: f64, pos: [f64; 3], rot: [f64; 3]) -> Value {
    json!({
        "id": id,
        "name": name,
        "materialId": material,
        "size": { "l": round(l), "w": round(w) },
        // Grain along the long side, as the board or sheet is cut.
        "grainAxis": if w > l { "w" } else { "l" },
        "transform": { "pos": pos.map(round), "rot": rot },
    })
}

fn joint(n: &mut usize, kind: &str, host: &str, insert: &str) -> Value {
    *n += 1;
    json!({ "id": format!("j{n}"), "type": kind, "hostPartId": host, "insertPartId": insert })
}

fn plywood() -> Value {
    json!({ "id": "mat_ply", "type": "sheet", "name": "Plywood 3/4\"", "thickness": PLY, "sheetSize": { "l": 96, "w": 48 } })
}

fn lumber(id: &str, name: &str, thickness: f64, width: f64) -> Value {
    json!({ "id": id, "type": "lumber", "name": name, "thickness": thickness, "stockWidth": width, "stockLengths": [96] })
}

/// Lying flat: length across (x), width front to back (z).
const FLAT: [f64; 3] = [90.0, 0.0, 0.0];
/// Standing at an end: length front to back (z), width up (y).
const END: [f64; 3] = [0.0, 90.0, 0.0];
/// Standing across the front or back: length across (x), width up (y).
const FACE: [f64; 3] = [0.0, 0.0, 0.0];
/// A post: length up (y).
const POST: [f64; 3] = [0.0, 0.0, 90.0];

fn shelf_unit(width: f64, height: f64, depth: f64, shelves: u32, back: bool) -> Value {
    let t = PLY;
    let inside = width - 2.0 * t;
    let x = width / 2.0 - t / 2.0;
    // With a back, it sits inside the case and the shelves stop at it.
    let (shelf_depth, shelf_z) = if back { (depth - t, t / 2.0) } else { (depth, 0.0) };
    let mut parts = vec![
        part(
            "p_side_l",
            "Left Side",
            "mat_ply",
            depth,
            height,
            [-x, height / 2.0, 0.0],
            END,
        ),
        part(
            "p_side_r",
            "Right Side",
            "mat_ply",
            depth,
            height,
            [x, height / 2.0, 0.0],
            END,
        ),
        part(
            "p_bottom",
            "Bottom",
            "mat_ply",
            inside,
            shelf_depth,
            [0.0, t / 2.0, shelf_z],
            FLAT,
        ),
        part(
            "p_top",
            "Top",
            "mat_ply",
            inside,
            shelf_depth,
            [0.0, height - t / 2.0, shelf_z],
            FLAT,
        ),
    ];
    let mut n = 0;
    let mut joints = Vec::new();
    for id in ["p_bottom", "p_top"] {
        joints.push(joint(&mut n, "pocketScrew", id, "p_side_l"));
        joints.push(joint(&mut n, "pocketScrew", id, "p_side_r"));
    }
    // Shelves evenly spaced: equal clear openings between bottom, shelves and top.
    let clear = (height - 2.0 * t - f64::from(shelves) * t) / f64::from(shelves + 1);
    for i in 1..=shelves {
        let id = format!("p_shelf_{i}");
        let y = t + f64::from(i) * clear + (f64::from(i) - 0.5) * t;
        parts.push(part(
            &id,
            &format!("Shelf {i}"),
            "mat_ply",
            inside,
            shelf_depth,
            [0.0, y, shelf_z],
            FLAT,
        ));
        joints.push(joint(&mut n, "pocketScrew", &id, "p_side_l"));
        joints.push(joint(&mut n, "pocketScrew", &id, "p_side_r"));
    }
    if back {
        parts.push(part(
            "p_back",
            "Back",
            "mat_ply",
            inside,
            height - 2.0 * t,
            [0.0, height / 2.0, -depth / 2.0 + t / 2.0],
            FACE,
        ));
        for id in ["p_side_l", "p_side_r"] {
            joints.push(joint(&mut n, "screw", id, "p_back"));
        }
    }
    json!({ "materials": [plywood()], "parts": parts, "joints": joints, "meta": { "difficulty": "beginner" } })
}

fn open_box(width: f64, height: f64, depth: f64) -> Value {
    let t = PLY;
    let z = depth / 2.0 - t / 2.0;
    let x = width / 2.0 - t / 2.0;
    let parts = vec![
        part(
            "p_front",
            "Front",
            "mat_ply",
            width,
            height,
            [0.0, height / 2.0, z],
            FACE,
        ),
        part(
            "p_back",
            "Back",
            "mat_ply",
            width,
            height,
            [0.0, height / 2.0, -z],
            FACE,
        ),
        part(
            "p_end_l",
            "Left End",
            "mat_ply",
            depth - 2.0 * t,
            height,
            [-x, height / 2.0, 0.0],
            END,
        ),
        part(
            "p_end_r",
            "Right End",
            "mat_ply",
            depth - 2.0 * t,
            height,
            [x, height / 2.0, 0.0],
            END,
        ),
        part(
            "p_bottom",
            "Bottom",
            "mat_ply",
            width - 2.0 * t,
            depth - 2.0 * t,
            [0.0, t / 2.0, 0.0],
            FLAT,
        ),
    ];
    let mut n = 0;
    let mut joints = Vec::new();
    for face in ["p_front", "p_back"] {
        for end in ["p_end_l", "p_end_r"] {
            joints.push(joint(&mut n, "screw", face, end));
        }
    }
    for side in ["p_front", "p_back", "p_end_l", "p_end_r"] {
        joints.push(joint(&mut n, "screw", side, "p_bottom"));
    }
    json!({ "materials": [plywood()], "parts": parts, "joints": joints, "meta": { "difficulty": "beginner" } })
}

fn table(width: f64, depth: f64, height: f64, apron: bool) -> Value {
    let (leg, top) = (1.5, PLY);
    // The top overhangs the legs by an inch all round.
    let lx = width / 2.0 - 1.0 - leg / 2.0;
    let lz = depth / 2.0 - 1.0 - leg / 2.0;
    let leg_h = height - top;
    let mut parts = vec![part(
        "p_top",
        "Top",
        "mat_ply",
        width,
        depth,
        [0.0, height - top / 2.0, 0.0],
        FLAT,
    )];
    let legs = [
        ("p_leg_fl", "Leg FL", -1.0, 1.0),
        ("p_leg_fr", "Leg FR", 1.0, 1.0),
        ("p_leg_bl", "Leg BL", -1.0, -1.0),
        ("p_leg_br", "Leg BR", 1.0, -1.0),
    ];
    for (id, name, sx, sz) in legs {
        parts.push(part(
            id,
            name,
            "mat_leg",
            leg_h,
            leg,
            [sx * lx, leg_h / 2.0, sz * lz],
            POST,
        ));
    }
    let mut n = 0;
    let mut joints: Vec<Value> = legs
        .iter()
        .map(|(id, ..)| joint(&mut n, "screw", "p_top", id))
        .collect();
    let mut materials = vec![plywood(), lumber("mat_leg", "Pine 2x2", 1.5, 1.5)];
    if apron {
        materials.push(lumber("mat_apron", "Pine 1x3", 0.75, 2.5));
        let y = leg_h - 1.25;
        let (ix, iz) = (lx - leg / 2.0, lz - leg / 2.0);
        let (ox, oz) = (lx + leg / 2.0 - 0.375, lz + leg / 2.0 - 0.375);
        let aprons = [
            (
                "p_apron_front",
                "Front Apron",
                2.0 * ix,
                [0.0, y, oz],
                FACE,
                ("p_leg_fl", "p_leg_fr"),
            ),
            (
                "p_apron_back",
                "Back Apron",
                2.0 * ix,
                [0.0, y, -oz],
                FACE,
                ("p_leg_bl", "p_leg_br"),
            ),
            (
                "p_apron_left",
                "Left Apron",
                2.0 * iz,
                [-ox, y, 0.0],
                END,
                ("p_leg_fl", "p_leg_bl"),
            ),
            (
                "p_apron_right",
                "Right Apron",
                2.0 * iz,
                [ox, y, 0.0],
                END,
                ("p_leg_fr", "p_leg_br"),
            ),
        ];
        for (id, name, l, pos, rot, (a, b)) in aprons {
            parts.push(part(id, name, "mat_apron", l, 2.5, pos, rot));
            joints.push(joint(&mut n, "pocketScrew", id, a));
            joints.push(joint(&mut n, "pocketScrew", id, b));
            joints.push(joint(&mut n, "pocketScrew", id, "p_top"));
        }
    }
    json!({ "materials": materials, "parts": parts, "joints": joints, "meta": { "difficulty": "beginner" } })
}

fn frame(width: f64, depth: f64, height: f64) -> Value {
    // 2x4 posts at the corners, their wide face to the front; rails between them.
    let (w, t) = (3.5, 1.5);
    let px = width / 2.0 - w / 2.0;
    let pz = depth / 2.0 - t / 2.0;
    let mut parts = Vec::new();
    let posts = [
        ("p_post_fl", "Post FL", -1.0, 1.0),
        ("p_post_fr", "Post FR", 1.0, 1.0),
        ("p_post_bl", "Post BL", -1.0, -1.0),
        ("p_post_br", "Post BR", 1.0, -1.0),
    ];
    for (id, name, sx, sz) in posts {
        parts.push(part(
            id,
            name,
            "mat_2x4",
            height,
            w,
            [sx * px, height / 2.0, sz * pz],
            POST,
        ));
    }
    let mut n = 0;
    let mut joints = Vec::new();
    let long = width - 2.0 * w;
    let short = depth - 2.0 * t;
    for (level, y) in [("top", height - w / 2.0), ("bottom", w / 2.0 + 4.0)] {
        let cap = if level == "top" { "Top" } else { "Lower" };
        let rails = [
            (
                format!("p_{level}_front"),
                format!("{cap} Front Rail"),
                long,
                [0.0, y, pz],
                FACE,
                ("p_post_fl", "p_post_fr"),
            ),
            (
                format!("p_{level}_back"),
                format!("{cap} Back Rail"),
                long,
                [0.0, y, -pz],
                FACE,
                ("p_post_bl", "p_post_br"),
            ),
            (
                format!("p_{level}_left"),
                format!("{cap} Left Rail"),
                short,
                [-px, y, 0.0],
                END,
                ("p_post_fl", "p_post_bl"),
            ),
            (
                format!("p_{level}_right"),
                format!("{cap} Right Rail"),
                short,
                [px, y, 0.0],
                END,
                ("p_post_fr", "p_post_br"),
            ),
        ];
        for (id, name, l, pos, rot, (a, b)) in rails {
            parts.push(part(&id, &name, "mat_2x4", l, w, pos, rot));
            joints.push(joint(&mut n, "pocketScrew", &id, a));
            joints.push(joint(&mut n, "pocketScrew", &id, b));
        }
    }
    json!({ "materials": [lumber("mat_2x4", "2x4 (1.5 x 3.5 actual)", 1.5, 3.5)], "parts": parts, "joints": joints, "meta": { "difficulty": "beginner" } })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{obb_penetration, overall_size};
    use crate::lint;

    /// The design, checked; None when it is refused as too big for a sheet (and says so).
    fn sound(build: QuickBuild) -> Option<Spec> {
        let spec = match build.build("Test") {
            Ok(spec) => spec,
            Err(e) if e.contains("bigger than a 96\" × 48\" sheet") => return None,
            Err(e) => panic!("{build:?}: {e}"),
        };
        let issues: Vec<String> = lint::lint(&spec)
            .into_iter()
            .map(|i| format!("{} {}", i.code, i.message))
            .collect();
        assert!(issues.is_empty(), "{build:?}: {issues:#?}");
        for (i, a) in spec.parts.iter().enumerate() {
            for b in &spec.parts[i + 1..] {
                let depth = obb_penetration(a, spec.thickness_of(a).unwrap(), b, spec.thickness_of(b).unwrap());
                assert!(depth <= 0.03, "{build:?}: {} and {} overlap by {depth}", a.name, b.name);
            }
        }
        Some(spec)
    }

    fn same(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn every_generator_is_sound_across_a_grid_of_sizes() {
        let mut built = 0;
        for &w in &[12.0, 24.0, 48.0, 96.0] {
            for &h in &[12.0, 30.0, 72.0] {
                for &d in &[10.0, 16.0, 30.0] {
                    for back in [false, true] {
                        let shelves = ((h - 1.5) / 14.0) as u32;
                        let unit = QuickBuild::ShelfUnit {
                            width: w,
                            height: h,
                            depth: d,
                            shelves,
                            back,
                        };
                        if let Some(spec) = sound(unit) {
                            let size = overall_size(&spec).unwrap();
                            assert!(same(size.width, w) && same(size.height, h) && same(size.depth, d));
                            built += 1;
                        }
                    }
                    built += usize::from(
                        sound(QuickBuild::Box {
                            width: w,
                            height: h,
                            depth: d,
                        })
                        .is_some(),
                    );
                    for apron in [false, true] {
                        let table = QuickBuild::Table {
                            width: w,
                            depth: d.max(14.0),
                            height: h.max(16.0),
                            apron,
                        };
                        if let Some(spec) = sound(table) {
                            assert!(same(overall_size(&spec).unwrap().height, h.max(16.0)));
                            built += 1;
                        }
                    }
                    let frame = QuickBuild::Frame {
                        width: w.max(12.0),
                        depth: d.max(12.0),
                        height: h.max(16.0),
                    };
                    built += usize::from(sound(frame).is_some());
                }
            }
        }
        // Most of the grid fits a sheet; only the biggest panels are refused.
        assert!(built > 150, "{built}");
    }

    #[test]
    fn sizes_out_of_range_are_refused_in_words() {
        let tiny = QuickBuild::Box {
            width: 2.0,
            height: 10.0,
            depth: 10.0,
        };
        assert_eq!(
            tiny.build("x").unwrap_err(),
            "The width must be between 8\" and 96\" (it is 2\")."
        );
        let crowded = QuickBuild::ShelfUnit {
            width: 24.0,
            height: 20.0,
            depth: 10.0,
            shelves: 6,
            back: false,
        };
        assert!(crowded.problem().unwrap().starts_with("6 shelves leave less than 4\""));
    }

    #[test]
    fn a_panel_bigger_than_a_sheet_is_refused_in_words() {
        let wide = QuickBuild::ShelfUnit {
            width: 96.0,
            height: 72.0,
            depth: 12.0,
            shelves: 4,
            back: true,
        };
        assert_eq!(
            wide.build("x").unwrap_err(),
            "The back would be 94 1/2\" × 70 1/2\", bigger than a 96\" × 48\" sheet. Make the piece smaller, or leave the back off."
        );
        let open = QuickBuild::ShelfUnit {
            width: 96.0,
            height: 72.0,
            depth: 12.0,
            shelves: 4,
            back: false,
        };
        assert!(open.build("x").is_ok());
    }

    #[test]
    fn it_reads_from_json() {
        let b: QuickBuild = serde_json::from_value(
            json!({ "kind": "shelfUnit", "width": 30, "height": 48, "depth": 12, "shelves": 2, "back": true }),
        )
        .unwrap();
        assert!(matches!(
            b,
            QuickBuild::ShelfUnit {
                shelves: 2,
                back: true,
                ..
            }
        ));
    }
}
