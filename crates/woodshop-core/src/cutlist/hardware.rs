//! The hardware list: the metal to buy, derived from fastener ops, dowel holes, joints with no
//! fastener op behind them (estimated), and movables. Omitted sizes come from the shop tables.

use std::collections::HashMap;

use super::types::{HardwareKind, HardwareRow};
use crate::fasteners::{pocket_screw_length, pocket_screw_thread, screw_gauge, wood_screw_length};
use crate::hardware;
use crate::movables::{extent_along, front_normal, hinge_count_for, hinge_edge_length, slide_length_for};
use crate::spec::{HolePurpose, JointType, Movable, MovableStyle, Op, Part, Spec};
use crate::units::format_fraction;

/// Dowel stock lengths; a dowel spans both holes plus a little glue room.
const DOWEL_LENGTHS: [f64; 4] = [1.0, 1.5, 2.0, 3.0];

struct Sized {
    key: String,
    kind: HardwareKind,
    description: String,
    qty: u32,
    derived: bool,
}

fn inches(v: f64) -> String {
    format_fraction(v, 16)
}

/// Keys embed numbers the way JS stringifies them (1.25, 2), so merges match the web app.
fn key_num(v: f64) -> String {
    crate::geometry::php_float(v)
}

fn dowel_length_for(depth: f64) -> f64 {
    DOWEL_LENGTHS
        .iter()
        .copied()
        .find(|&l| l >= depth * 2.0)
        .unwrap_or(DOWEL_LENGTHS[3])
}

/// Shop rule of thumb: two at the ends of anything short, roughly one every 8" after that.
fn estimate_count(run: f64) -> u32 {
    ((run / 8.0).round() as i64 + 1).clamp(2, 6) as u32
}

/// The longest edge of the smaller part — a fair proxy for how far the two actually meet.
fn joint_run(host: &Part, insert: &Part) -> f64 {
    host.size.l.max(host.size.w).min(insert.size.l.max(insert.size.w))
}

fn needs_metal(joint: JointType) -> bool {
    matches!(joint, JointType::PocketScrew | JointType::Screw | JointType::Dowel)
}

/// Whether `op` is the fastener op that would already have counted a joint's metal.
fn backed_by(joint: JointType, op: &Op) -> bool {
    match joint {
        JointType::PocketScrew => matches!(op, Op::PocketHoles(_)),
        JointType::Screw => matches!(op, Op::Screws(_)),
        JointType::Dowel => matches!(op, Op::Hole(h) if h.purpose == Some(HolePurpose::Dowel)),
        _ => false,
    }
}

/// The part on the other end of a recorded joint of this type, if any.
fn mate_of<'a>(spec: &'a Spec, host: &Part, joint_type: JointType) -> Option<&'a Part> {
    spec.joints()
        .iter()
        .find(|j| j.kind == joint_type && j.host_part_id == host.id)
        .and_then(|j| spec.part(&j.insert_part_id))
}

pub fn compute_hardware(spec: &Spec) -> Vec<HardwareRow> {
    let thickness_of = |p: &Part| spec.thickness_of(p).unwrap_or(0.0);
    let mut rows: Vec<Sized> = Vec::new();

    for part in &spec.parts {
        let qty = part.qty();
        for op in part.ops() {
            match op {
                Op::PocketHoles(o) => {
                    let mate = mate_of(spec, part, JointType::PocketScrew);
                    let length = o
                        .length
                        .unwrap_or_else(|| pocket_screw_length(thickness_of(part), None));
                    let thread = o
                        .thread
                        .unwrap_or_else(|| pocket_screw_thread(mate.and_then(|m| spec.material(&m.material_id))));
                    let t = thread_name(thread);
                    rows.push(Sized {
                        key: format!("pocketScrew|{}|{t}", key_num(length)),
                        kind: HardwareKind::PocketScrew,
                        description: format!("{}\" {t}-thread pocket screws", inches(length)),
                        qty: o.count * qty,
                        derived: false,
                    });
                }
                Op::Screws(o) => {
                    let mate = mate_of(spec, part, JointType::Screw);
                    let mate_thickness = mate.map_or_else(|| thickness_of(part), thickness_of);
                    let length = o
                        .length
                        .unwrap_or_else(|| wood_screw_length(thickness_of(part), mate_thickness));
                    let gauge = o.gauge.unwrap_or_else(|| screw_gauge(mate_thickness)).as_str();
                    rows.push(Sized {
                        key: format!("woodScrew|{}|{gauge}", key_num(length)),
                        kind: HardwareKind::WoodScrew,
                        description: format!("{gauge} × {}\" wood screws", inches(length)),
                        qty: o.count * qty,
                        derived: false,
                    });
                }
                Op::Hole(h) if h.purpose == Some(HolePurpose::Dowel) => {
                    // The mate's holes are implied (holes are face-only): one dowel per hole.
                    let length = dowel_length_for(h.depth.unwrap_or_else(|| thickness_of(part)));
                    rows.push(Sized {
                        key: format!("dowel|{}|{}", key_num(h.diameter), key_num(length)),
                        kind: HardwareKind::Dowel,
                        description: format!("{}\" × {}\" dowels", inches(h.diameter), inches(length)),
                        qty,
                        derived: false,
                    });
                }
                _ => {}
            }
        }
    }

    // Joints with no fastener op behind them: estimated, flagged, superseded once ops are placed.
    for joint in spec.joints() {
        let (Some(host), Some(insert)) = (spec.part(&joint.host_part_id), spec.part(&joint.insert_part_id)) else {
            continue;
        };
        if !needs_metal(joint.kind) {
            continue; // dado, rabbet and butt need no metal of their own
        }
        if host.ops().iter().any(|op| backed_by(joint.kind, op)) {
            continue; // already counted off the op itself
        }
        let count = estimate_count(joint_run(host, insert));
        match joint.kind {
            JointType::Dowel => {
                let length = dowel_length_for(thickness_of(host));
                rows.push(Sized {
                    key: format!("dowel|estimated|{}", key_num(length)),
                    kind: HardwareKind::Dowel,
                    description: format!(
                        "3/8\" × {}\" dowels (estimated — no dowel holes placed)",
                        inches(length)
                    ),
                    qty: count,
                    derived: true,
                });
            }
            JointType::PocketScrew => {
                let length = pocket_screw_length(thickness_of(host), None);
                let t = thread_name(pocket_screw_thread(spec.material(&insert.material_id)));
                rows.push(Sized {
                    key: format!("pocketScrew|estimated|{}|{t}", key_num(length)),
                    kind: HardwareKind::PocketScrew,
                    description: format!(
                        "{}\" {t}-thread pocket screws (estimated — no pocketHoles op)",
                        inches(length)
                    ),
                    qty: count,
                    derived: true,
                });
            }
            _ => {
                let length = wood_screw_length(thickness_of(host), thickness_of(insert));
                let gauge = screw_gauge(thickness_of(insert)).as_str();
                rows.push(Sized {
                    key: format!("woodScrew|estimated|{}|{gauge}", key_num(length)),
                    kind: HardwareKind::WoodScrew,
                    description: format!("{gauge} × {}\" wood screws (estimated — no screws op)", inches(length)),
                    qty: count,
                    derived: true,
                });
            }
        }
    }

    // Movables: hinges, slides and knobs. `part.qty` is deliberately ignored — a movable names
    // specific part ids, one door or drawer each.
    for movable in spec.movables() {
        let Some(anchor) = spec.part(movable.anchor_part_id()) else {
            continue;
        };
        match movable {
            Movable::Door {
                hinge_edge,
                style,
                hinge,
                ..
            } => {
                let count = hinge_count_for(hinge_edge_length(anchor, *hinge_edge));
                // A chosen catalog hinge names itself; otherwise the style's default wording.
                let (key, desc) = match hinge.as_deref().and_then(hardware::find) {
                    Some(item) => (format!("hinge|{}", item.id), item.list.clone()),
                    None => match style {
                        MovableStyle::Overlay => ("hinge|overlay".into(), "overlay cabinet hinges".into()),
                        MovableStyle::Inset => ("hinge|inset".into(), "inset butt hinges".into()),
                    },
                };
                rows.push(Sized {
                    key,
                    kind: HardwareKind::Hinge,
                    description: desc,
                    qty: count,
                    derived: false,
                });
            }
            Movable::Drawer { part_ids, slide, .. } => {
                let members: Vec<&Part> = part_ids.iter().filter_map(|id| spec.part(id)).collect();
                let depth = extent_along(&members, thickness_of, front_normal(anchor));
                let length = slide_length_for(depth);
                let (id, list) = match slide.as_deref().and_then(hardware::find) {
                    Some(item) => (item.id.as_str(), item.list.as_str()),
                    None => ("default", "side-mount drawer slides (pairs)"),
                };
                rows.push(Sized {
                    key: format!("drawerSlide|{id}|{}", key_num(length)),
                    kind: HardwareKind::DrawerSlide,
                    description: format!("{}\" {list}", inches(length)),
                    qty: 1,
                    derived: false,
                });
            }
        }
        match movable.pull() {
            Some("none") => {}
            Some(id) if hardware::find(id).is_some() => {
                let item = hardware::find(id).expect("checked");
                rows.push(Sized {
                    key: format!("item|{}", item.id),
                    kind: HardwareKind::Knob,
                    description: item.list.clone(),
                    qty: 1,
                    derived: false,
                });
            }
            _ => rows.push(Sized {
                key: "knob".into(),
                kind: HardwareKind::Knob,
                description: "cabinet knobs".into(),
                qty: 1,
                derived: false,
            }),
        }
    }

    // Catalog hardware mounted on parts (1.15), counted per item. An unknown id still gets a row
    // so nothing bought is silently dropped.
    for mount in spec.hardware() {
        let (kind, description) = match hardware::find(&mount.item) {
            Some(item) => (
                match item.role {
                    Some(hardware::Role::Hinge) => HardwareKind::Hinge,
                    Some(hardware::Role::Pull) => HardwareKind::Knob,
                    _ => HardwareKind::Other,
                },
                item.list.clone(),
            ),
            None => (
                HardwareKind::Other,
                format!("{} (not in this version's catalog)", mount.item),
            ),
        };
        rows.push(Sized {
            key: format!("item|{}", mount.item),
            kind,
            description,
            qty: 1,
            derived: false,
        });
    }

    // Merge identical hardware; stable shop order: screws, dowels, then cabinet hardware.
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut merged: Vec<HardwareRow> = Vec::new();
    for row in rows {
        match index.get(&row.key) {
            Some(&i) => merged[i].qty += row.qty,
            None => {
                index.insert(row.key, merged.len());
                merged.push(HardwareRow {
                    kind: row.kind,
                    description: row.description,
                    qty: row.qty,
                    derived: row.derived,
                });
            }
        }
    }
    merged.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| locale_compare(&a.description, &b.description))
    });
    merged
}

fn thread_name(t: crate::spec::Thread) -> &'static str {
    match t {
        crate::spec::Thread::Coarse => "coarse",
        crate::spec::Thread::Fine => "fine",
    }
}

/// Approximates `String.prototype.localeCompare` for shop strings: case-insensitive first, then
/// lowercase before uppercase, as ICU's root collation orders them.
pub fn locale_compare(a: &str, b: &str) -> std::cmp::Ordering {
    let fold = |s: &str| s.to_lowercase();
    fold(a).cmp(&fold(b)).then_with(|| b.cmp(a))
}
