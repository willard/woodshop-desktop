//! Mirrored copies (`mirror_parts`): the right side drawn from the left, the back legs from the
//! front ones. The port of the editor's `ui/src/engine/mirror.ts`, on the JSON draft.
//!
//! A reflection is not a rotation, but a board is symmetric: its mirror image is the same board
//! turned over with its cuts reflected across one of its own axes. Never the thickness — rabbets
//! and miters are cut from the front face by convention — so across its length or its width,
//! whichever lies closer to the mirror's direction. The front face stays the front face.

use serde_json::{Map, Value, json};
use woodshop_core::geometry::{Mat3, rotation_rows};

use super::*;
use crate::ctx::{find, ids, plural, text, unique_id};

const DIRECTIONS: &[&str] = &["left_right", "up_down", "front_back"];

pub const MIRROR_PARTS: ToolDef = ToolDef {
    name: "mirror_parts",
    description: "Add a mirrored copy of one or more parts: the right side from the left, the back legs from \
        the front ones. `direction` is what trades places: left_right (world x), up_down (y) or front_back (z). \
        The mirror stands at the middle of the whole design along that direction, so a left side's copy lands \
        where the right side belongs; pass `plane` (a world coordinate in inches) to stand it elsewhere. If the \
        parts straddle the middle, the mirror stands 1\" past their far side instead. Each copy is reflected \
        across its own length or width, never its thickness, so every cut stays on the same face (the inside \
        face of the left side is the inside face of the right) and its rotation changes to suit. Names and ids \
        swap sides (Left Side → Right Side, p_side_l → p_side_r). Joints between the mirrored parts come along, \
        and so do joints to a part centred on the mirror when that part is the insert (the shelf spanning both \
        sides) — not when it is the host of a cut the joint names, since that cut serves only the original. \
        Hardware moves to its mirror-image spot; a door made of the parts hangs from the opposite edge.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_ids": array(json!({ "type": "string" }), "The parts to mirror (from get_design)."),
                "direction": one_of(DIRECTIONS, "What trades places: left_right (x), up_down (y) or front_back (z)."),
                "plane": number("Where the mirror stands, as a world coordinate in inches along `direction`. Default: the middle of the design."),
            }),
            &["project_id", "part_ids", "direction"],
        )
    },
    run: mirror_parts,
};

/// Rounds away floating-point dust and never writes -0.
fn clean(v: f64) -> f64 {
    let r = (v * 1e6).round() / 1e6;
    if r == 0.0 { 0.0 } else { r }
}

fn vec3(v: &Value) -> [f64; 3] {
    std::array::from_fn(|i| v[i].as_f64().unwrap_or(0.0))
}

fn thickness(spec: &Value, part: &Value) -> f64 {
    find(spec, "materials", text(part, "materialId"))
        .and_then(|m| m["thickness"].as_f64())
        .unwrap_or(0.75)
}

fn matrix(part: &Value) -> Mat3 {
    rotation_rows(vec3(&part["transform"]["rot"]))
}

/// A part's world extent along `axis`.
fn extent(spec: &Value, part: &Value, axis: usize) -> (f64, f64) {
    let m = matrix(part);
    let h = [
        part["size"]["l"].as_f64().unwrap_or(0.0) / 2.0,
        part["size"]["w"].as_f64().unwrap_or(0.0) / 2.0,
        thickness(spec, part) / 2.0,
    ];
    let reach: f64 = (0..3).map(|j| m[axis][j].abs() * h[j]).sum();
    let centre = vec3(&part["transform"]["pos"])[axis];
    (centre - reach, centre + reach)
}

fn span(spec: &Value, parts: &[&Value], axis: usize) -> (f64, f64) {
    parts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
        let (a, b) = extent(spec, p, axis);
        (lo.min(a), hi.max(b))
    })
}

/// Where the mirror stands by default: the middle of the design, unless the parts straddle it.
fn default_plane(spec: &Value, sources: &[&Value], axis: usize) -> f64 {
    let all: Vec<&Value> = spec["parts"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let (lo, hi) = span(spec, &all, axis);
    let centre = (lo + hi) / 2.0;
    let (own_lo, own_hi) = span(spec, sources, axis);
    if own_lo < centre - 1e-6 && own_hi > centre + 1e-6 {
        clean(own_hi + 1.0)
    } else {
        clean(centre)
    }
}

/// Which of the part's own axes to reflect: `true` for its length, `false` for its width.
fn flips_length(m: &Mat3, axis: usize) -> bool {
    m[axis][1].abs() <= m[axis][0].abs() + 1e-9
}

/// Euler 'XYZ' degrees of a rotation matrix, as three.js `setFromRotationMatrix`.
fn euler_xyz(r: &Mat3) -> [f64; 3] {
    let y = r[0][2].clamp(-1.0, 1.0).asin();
    let (x, z) = if r[0][2].abs() < 0.999_999_9 {
        ((-r[1][2]).atan2(r[2][2]), (-r[0][1]).atan2(r[0][0]))
    } else {
        (r[2][1].atan2(r[1][1]), 0.0)
    };
    [x, y, z].map(|a| clean(a.to_degrees()))
}

fn flip_edge(edge: &str, length: bool) -> &'static str {
    match (edge, length) {
        ("w0", true) => "w1",
        ("w1", true) => "w0",
        ("l0", false) => "l1",
        ("l1", false) => "l0",
        ("l0", _) => "l0",
        ("l1", _) => "l1",
        ("w0", _) => "w0",
        _ => "w1",
    }
}

/// A `from`/`to` run reflected end for end within `span`; an omitted end stays omitted.
fn flip_run(op: &mut Map<String, Value>, span: f64) {
    let from = op.remove("from").and_then(|v| v.as_f64());
    let to = op.remove("to").and_then(|v| v.as_f64());
    if let Some(to) = to {
        op.insert("from".into(), json!(clean(span - to)));
    }
    if let Some(from) = from {
        op.insert("to".into(), json!(clean(span - from)));
    }
}

/// One cut reflected across the part's length (`length`) or width. Faces never change.
fn flip_op(op: &mut Map<String, Value>, length: bool, l: f64, w: f64) {
    let span = if length { l } else { w };
    if let Some(edge) = op.get("edge").and_then(Value::as_str).map(str::to_owned) {
        let runs_length = edge.starts_with('l');
        if runs_length == length {
            flip_run(op, span);
        }
        op.insert("edge".into(), json!(flip_edge(&edge, length)));
    }
    for key in ["corner", "low"] {
        if let Some(edge) = op.get(key).and_then(Value::as_str).map(str::to_owned) {
            op.insert(key.into(), json!(flip_edge(&edge, length)));
        }
    }
    if let (Some(axis), Some(offset)) = (
        op.get("axis").and_then(Value::as_str).map(str::to_owned),
        op.get("offset").and_then(Value::as_f64),
    ) {
        if (axis == "l") == length {
            flip_run(op, span);
        } else {
            op.insert("offset".into(), json!(clean(span - offset)));
        }
    }
    if op.get("type").and_then(Value::as_str) == Some("hole") {
        let key = if length { "x" } else { "y" };
        if let Some(v) = op.get(key).and_then(Value::as_f64) {
            op.insert(key.into(), json!(clean(span - v)));
        }
    }
}

const PAIRS: [&[(&str, &str)]; 3] = [
    &[("left", "right"), ("l", "r")],
    &[("top", "bottom"), ("upper", "lower")],
    &[("front", "back"), ("rear", "front")],
];

fn swap_word(word: &str, axis: usize, letters: bool) -> Option<&'static str> {
    let lower = word.to_lowercase();
    PAIRS[axis].iter().find_map(|&(a, b)| {
        if a.len() == 1 && !letters {
            None
        } else if lower == a {
            Some(b)
        } else if lower == b {
            Some(a)
        } else {
            None
        }
    })
}

/// "Left Side" → "Right Side"; a name with no side in it gets " (mirrored)".
fn mirror_name(name: &str, axis: usize) -> String {
    let mut out = String::new();
    let mut word = String::new();
    let mut swapped = false;
    let mut flush = |word: &mut String, out: &mut String| {
        if let Some(to) = swap_word(word, axis, false) {
            swapped = true;
            let mut chars = to.chars();
            if word.len() > 1 && word.chars().all(|c| c.is_ascii_uppercase()) {
                out.push_str(&to.to_uppercase());
            } else if word.starts_with(|c: char| c.is_ascii_uppercase()) {
                out.extend(chars.next().map(|c| c.to_ascii_uppercase()));
                out.push_str(chars.as_str());
            } else {
                out.push_str(to);
            }
        } else {
            out.push_str(word);
        }
        word.clear();
    };
    for c in name.chars() {
        if c.is_ascii_alphabetic() {
            word.push(c);
        } else {
            flush(&mut word, &mut out);
            out.push(c);
        }
    }
    flush(&mut word, &mut out);
    if swapped { out } else { format!("{name} (mirrored)") }
}

/// "p_side_l" → "p_side_r"; otherwise "<id>_mirror".
fn mirror_id_base(id: &str, axis: usize) -> String {
    let mut swapped = false;
    let tokens: Vec<String> = id
        .split('_')
        .map(|t| match swap_word(t, axis, true) {
            Some(to) if t.chars().all(|c| c.is_ascii_lowercase()) => {
                swapped = true;
                to.to_owned()
            }
            _ => t.to_owned(),
        })
        .collect();
    if swapped {
        tokens.join("_")
    } else {
        format!("{id}_mirror")
    }
}

/// A mount's point, outward normal and rot-0 long axis, in the part's local frame.
fn mount_frame(side: &str, x: f64, y: f64, hl: f64, hw: f64, ht: f64) -> ([f64; 3], [f64; 3], [f64; 3]) {
    match side {
        "front" => ([-hl + x, -hw + y, ht], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
        "back" => ([-hl + x, -hw + y, -ht], [0.0, 0.0, -1.0], [1.0, 0.0, 0.0]),
        "l0" => ([-hl + x, -hw, -ht + y], [0.0, -1.0, 0.0], [1.0, 0.0, 0.0]),
        "l1" => ([-hl + x, hw, -ht + y], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
        "w0" => ([-hl, -hw + x, -ht + y], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
        _ => ([hl, -hw + x, -ht + y], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    }
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// A mount moved to the mirror-image spot, turned to line its long axis up with the reflected one.
fn mirror_mount(mount: &mut Map<String, Value>, part: &Value, t: f64, length: bool) {
    let (hl, hw, ht) = (
        part["size"]["l"].as_f64().unwrap_or(0.0) / 2.0,
        part["size"]["w"].as_f64().unwrap_or(0.0) / 2.0,
        t / 2.0,
    );
    let side = mount.get("side").and_then(Value::as_str).unwrap_or("front").to_owned();
    let x = mount.get("x").and_then(Value::as_f64).unwrap_or(0.0);
    let y = mount.get("y").and_then(Value::as_f64).unwrap_or(0.0);
    let turn = mount.get("rot").and_then(Value::as_f64).unwrap_or(0.0).to_radians();
    let s = |v: [f64; 3]| -> [f64; 3] {
        if length {
            [-v[0], v[1], v[2]]
        } else {
            [v[0], -v[1], v[2]]
        }
    };
    let (point, normal, along) = mount_frame(&side, x, y, hl, hw, ht);
    let side_of = cross(normal, along);
    let dir: [f64; 3] = std::array::from_fn(|i| along[i] * turn.cos() + side_of[i] * turn.sin());

    let n = s(normal).map(|v| v.round());
    let new_side = match n {
        [_, _, z] if z > 0.5 => "front",
        [_, _, z] if z < -0.5 => "back",
        [_, y, _] if y < -0.5 => "l0",
        [_, y, _] if y > 0.5 => "l1",
        [x, _, _] if x < -0.5 => "w0",
        _ => "w1",
    };
    let p = s(point);
    let (nx, ny) = match new_side {
        "front" | "back" => (p[0] + hl, p[1] + hw),
        "l0" | "l1" => (p[0] + hl, p[2] + ht),
        _ => (p[1] + hw, p[2] + ht),
    };
    let target = s(dir);
    let (_, n2, a2) = mount_frame(new_side, nx, ny, hl, hw, ht);
    let b2 = cross(n2, a2);
    let best = [0.0_f64, 90.0, 180.0, 270.0]
        .into_iter()
        .max_by(|&r1, &r2| {
            let score = |r: f64| {
                let (sn, cs) = r.to_radians().sin_cos();
                (0..3).map(|i| (a2[i] * cs + b2[i] * sn) * target[i]).sum::<f64>()
            };
            score(r1).total_cmp(&score(r2)).then(r2.total_cmp(&r1))
        })
        .unwrap_or(0.0);
    mount.insert("side".into(), json!(new_side));
    mount.insert("x".into(), json!(clean(nx)));
    mount.insert("y".into(), json!(clean(ny)));
    if mount.contains_key("rot") || best != 0.0 {
        mount.insert("rot".into(), json!(best as i64));
    }
}

fn mirror_parts(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let wanted: Vec<String> = args
        .opt_array("part_ids", 200)?
        .ok_or("Provide part_ids: the parts to mirror (see get_design).")?
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or("part_ids must be a list of part ids.")
        })
        .collect::<Result<_, _>>()?;
    if wanted.is_empty() {
        return Err("Provide at least one part id in part_ids.".into());
    }
    let direction = args.enumerated(
        "direction",
        DIRECTIONS,
        "direction must be left_right, up_down or front_back.",
        "Provide the direction: left_right, up_down or front_back.",
    )?;
    let axis = DIRECTIONS.iter().position(|d| *d == direction).unwrap_or(0);
    let plane_arg = args.opt_num("plane", -240.0, 240.0)?;

    let design = w.load_editable(project_id)?;
    let spec = &design.draft;
    let mut sources = Vec::new();
    for id in &wanted {
        let part = find(spec, "parts", id).ok_or_else(|| no_part(id))?;
        if !sources.iter().any(|p: &&Value| p["id"] == part["id"]) {
            sources.push(part);
        }
    }
    let plane = plane_arg.unwrap_or_else(|| default_plane(spec, &sources, axis));

    // The copies, with fresh ids that swap sides where the original's id names one.
    let mut taken = ids(spec, "parts");
    let mut id_map: Vec<(String, String)> = Vec::new();
    let mut copies = Vec::new();
    let mut lengths = Vec::new();
    for part in &sources {
        let id = text(part, "id");
        let base = mirror_id_base(id, axis);
        let new_id = if taken.contains(&base) {
            unique_id(&taken, "", &base)
        } else {
            base
        };
        taken.push(new_id.clone());
        id_map.push((id.to_owned(), new_id.clone()));

        let m = matrix(part);
        let length = flips_length(&m, axis);
        lengths.push(length);
        let (l, wd) = (
            part["size"]["l"].as_f64().unwrap_or(0.0),
            part["size"]["w"].as_f64().unwrap_or(0.0),
        );
        let mut copy = (*part).clone();
        let obj = copy.as_object_mut().ok_or("A part must be an object.")?;
        obj.insert("id".into(), json!(new_id));
        obj.insert("name".into(), json!(mirror_name(text(part, "name"), axis)));
        let mut pos = vec3(&part["transform"]["pos"]);
        pos[axis] = clean(2.0 * plane - pos[axis]);
        let world = std::array::from_fn::<f64, 3, _>(|i| if i == axis { -1.0 } else { 1.0 });
        let local = [if length { -1.0 } else { 1.0 }, if length { 1.0 } else { -1.0 }, 1.0];
        let r: Mat3 = std::array::from_fn(|i| std::array::from_fn(|j| world[i] * m[i][j] * local[j]));
        obj.insert("transform".into(), json!({ "pos": pos, "rot": euler_xyz(&r) }));
        if let Some(ops) = obj.get_mut("ops").and_then(Value::as_array_mut) {
            for op in ops.iter_mut().filter_map(Value::as_object_mut) {
                flip_op(op, length, l, wd);
            }
        }
        if let Some(edges) = obj.get_mut("edgeBand").and_then(Value::as_array_mut) {
            for edge in edges.iter_mut() {
                if let Some(e) = edge.as_str() {
                    *edge = json!(flip_edge(e, length));
                }
            }
        }
        copies.push(copy);
    }
    let lookup = |id: &str| id_map.iter().find(|(a, _)| a == id).map(|(_, b)| b.clone());

    // Joints: between copies, and to an outside part centred on the mirror that is not the host of
    // a cut the joint names.
    let centred = |id: &str| {
        find(spec, "parts", id).is_some_and(|p| {
            let (lo, hi) = extent(spec, p, axis);
            ((lo + hi) / 2.0 - plane).abs() < 1e-3
        })
    };
    let mut joint_ids = ids(spec, "joints");
    let mut joints = Vec::new();
    for joint in spec["joints"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let (host, insert) = (text(joint, "hostPartId"), text(joint, "insertPartId"));
        let (new_host, new_insert) = (lookup(host), lookup(insert));
        if new_host.is_none() && new_insert.is_none() {
            continue;
        }
        if new_host.is_none() && (joint.get("opRef").is_some() || !centred(host)) {
            continue;
        }
        if new_insert.is_none() && !centred(insert) {
            continue;
        }
        let host = new_host.unwrap_or_else(|| host.to_owned());
        let insert = new_insert.unwrap_or_else(|| insert.to_owned());
        let id = unique_id(&joint_ids, "j_", &format!("{host}_{insert}"));
        joint_ids.push(id.clone());
        let mut copy = joint.clone();
        copy["id"] = json!(id);
        copy["hostPartId"] = json!(host);
        copy["insertPartId"] = json!(insert);
        joints.push(copy);
    }

    let mut hardware_ids = ids(spec, "hardware");
    let mut hardware = Vec::new();
    for mount in spec["hardware"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let Some(part_id) = lookup(text(mount, "partId")) else {
            continue;
        };
        let index = sources.iter().position(|p| p["id"] == mount["partId"]).unwrap_or(0);
        let part = sources[index];
        let mut copy = mount.clone();
        let obj = copy.as_object_mut().ok_or("A hardware mount must be an object.")?;
        mirror_mount(obj, part, thickness(spec, part), lengths[index]);
        let id = unique_id(&hardware_ids, "hw_", text(mount, "item"));
        hardware_ids.push(id.clone());
        obj.insert("id".into(), json!(id));
        obj.insert("partId".into(), json!(part_id));
        hardware.push(copy);
    }

    let mut movable_ids = ids(spec, "movables");
    let mut movables = Vec::new();
    for movable in spec["movables"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let parts: Option<Vec<String>> = movable["partIds"]
            .as_array()
            .map(|a| a.iter().map(|v| lookup(v.as_str().unwrap_or_default())).collect())
            .unwrap_or_default();
        let Some(parts) = parts else { continue };
        let kind = text(movable, "kind");
        let id = unique_id(&movable_ids, "mv_", kind);
        movable_ids.push(id.clone());
        let mut copy = movable.clone();
        copy["id"] = json!(id);
        copy["partIds"] = json!(parts);
        if let Some(name) = movable["name"].as_str() {
            copy["name"] = json!(mirror_name(name, axis));
        }
        for key in ["panelPartId", "frontPartId"] {
            if let Some(new) = movable[key].as_str().and_then(lookup) {
                copy[key] = json!(new);
            }
        }
        if let Some(edge) = movable["hingeEdge"].as_str() {
            let panel = text(movable, "panelPartId");
            let length = sources
                .iter()
                .position(|p| text(p, "id") == panel)
                .is_none_or(|i| lengths[i]);
            copy["hingeEdge"] = json!(flip_edge(edge, length));
        }
        movables.push(copy);
    }

    let names: Vec<String> = copies
        .iter()
        .map(|c| format!("\"{}\" ({})", text(c, "name"), text(c, "id")))
        .collect();
    let n = copies.len();
    let (jn, hn, mn) = (joints.len(), hardware.len(), movables.len());
    let label = if n == 1 {
        format!("Mirror {}", text(sources[0], "name"))
    } else {
        format!("Mirror {n} parts")
    };
    let result = w.apply(&design, &label, false, |spec| {
        for (key, items) in [
            ("parts", copies),
            ("joints", joints),
            ("hardware", hardware),
            ("movables", movables),
        ] {
            if items.is_empty() {
                continue;
            }
            let list = spec[key].as_array_mut();
            match list {
                Some(list) => list.extend(items),
                None => spec[key] = Value::Array(items),
            }
        }
    });
    let axis_name = ["x", "y", "z"][axis];
    let mut summary = format!(
        "Added {n} mirrored part{} across {axis_name} = {}: {}.",
        plural(n),
        clean(plane),
        names.join(", ")
    );
    let mut extras = Vec::new();
    if jn > 0 {
        extras.push(format!("{jn} joint{}", plural(jn)));
    }
    if hn > 0 {
        extras.push(format!("{hn} piece{} of hardware", plural(hn)));
    }
    if mn > 0 {
        extras.push(format!("{mn} door{}/drawer{}", plural(mn), plural(mn)));
    }
    if !extras.is_empty() {
        summary.push_str(&format!(" Copied with them: {}.", extras.join(", ")));
    }
    w.render(result, &design, &summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn euler_angles_turn_back_into_the_same_rotation() {
        for rot in [
            [0.0, 0.0, 0.0],
            [0.0, 90.0, 0.0],
            [0.0, -90.0, 0.0],
            [90.0, 0.0, 0.0],
            [30.0, -45.0, 10.0],
            [-90.0, 0.0, 27.3],
            [10.0, 90.0, 20.0],
        ] {
            let m = rotation_rows(rot);
            let back = rotation_rows(euler_xyz(&m));
            for i in 0..3 {
                for j in 0..3 {
                    assert!((m[i][j] - back[i][j]).abs() < 1e-6, "{rot:?}");
                }
            }
        }
    }

    #[test]
    fn a_hole_lands_at_its_mirror_image() {
        let t = 0.75;
        for rot in [
            [0.0, 90.0, 0.0],
            [30.0, -45.0, 10.0],
            [90.0, 0.0, 0.0],
            [-90.0, 0.0, 27.3],
        ] {
            for axis in 0..3 {
                let part = json!({ "id": "p_a", "name": "A", "size": { "l": 20.0, "w": 10.0 }, "transform": { "pos": [3.0, 4.0, 5.0], "rot": rot } });
                let m = matrix(&part);
                let length = flips_length(&m, axis);
                let world = std::array::from_fn::<f64, 3, _>(|i| if i == axis { -1.0 } else { 1.0 });
                let local = [if length { -1.0 } else { 1.0 }, if length { 1.0 } else { -1.0 }, 1.0];
                let r: Mat3 = std::array::from_fn(|i| std::array::from_fn(|j| world[i] * m[i][j] * local[j]));
                let r = rotation_rows(euler_xyz(&r));
                let mut op = json!({ "type": "hole", "face": "front", "x": 2.0, "y": 7.0, "diameter": 0.25 });
                flip_op(op.as_object_mut().unwrap(), length, 20.0, 10.0);
                let at = |m: &Mat3, pos: [f64; 3], x: f64, y: f64| -> [f64; 3] {
                    let l = [-10.0 + x, -5.0 + y, t / 2.0];
                    std::array::from_fn(|i| pos[i] + m[i][0] * l[0] + m[i][1] * l[1] + m[i][2] * l[2])
                };
                let mut want = at(&m, [3.0, 4.0, 5.0], 2.0, 7.0);
                want[axis] = 2.0 * -2.0 - want[axis];
                let mut pos = [3.0, 4.0, 5.0];
                pos[axis] = 2.0 * -2.0 - pos[axis];
                let got = at(&r, pos, op["x"].as_f64().unwrap(), op["y"].as_f64().unwrap());
                for i in 0..3 {
                    assert!(
                        (got[i] - want[i]).abs() < 1e-5,
                        "{rot:?} axis {axis}: {got:?} vs {want:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn names_and_ids_swap_sides() {
        assert_eq!(mirror_name("Left Side", 0), "Right Side");
        assert_eq!(mirror_name("front leg", 2), "back leg");
        assert_eq!(mirror_name("Side", 0), "Side (mirrored)");
        assert_eq!(mirror_id_base("p_side_l", 0), "p_side_r");
        assert_eq!(mirror_id_base("p_leg", 2), "p_leg_mirror");
    }
}
