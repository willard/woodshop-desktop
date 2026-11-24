//! The hardware list: the metal to buy, derived from fastener ops, dowel holes, joints with no
//! fastener op behind them (estimated), and movables. Omitted sizes come from the shop tables.

use std::collections::HashMap;

use super::types::{HardwareKind, HardwareRow};
use crate::fasteners::{pocket_screw_length, pocket_screw_thread, screw_gauge, wood_screw_length};
use crate::hardware;
use crate::movables::{extent_along, front_normal, hinge_count_for, hinge_edge_length, slide_length_for};
use crate::spec::{HolePurpose, JointType, Movable, MovableStyle, Op, Part, Spec};
use crate::units::{Units, format_fraction};

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

/// Sizes worded for the buyer: shop fractions, or the metric trade size a metric hardware store
/// stocks. Fasteners and slides go to the nearest trade size (a 1 1/4" screw is bought as 30 mm);
/// a dowel converts exactly, because it has to fit the hole the design drills.
#[derive(Clone, Copy)]
struct Words {
    metric: bool,
}

/// Nearest stocked length from a trade table, else the plain conversion to `step` mm.
fn trade_mm(inches: f64, table: &[(f64, u32)], step: f64) -> String {
    match table.iter().find(|(i, _)| (i - inches).abs() < 1e-6) {
        Some((_, mm)) => mm.to_string(),
        None => mm_text((inches * 25.4 / step).round() * step),
    }
}

fn mm_text(v: f64) -> String {
    let s = format!("{v:.1}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

const POCKET_MM: [(f64, u32); 6] = [(0.75, 20), (1.0, 25), (1.25, 30), (1.5, 38), (2.0, 50), (2.5, 63)];
const SCREW_MM: [(f64, u32); 11] = [
    (0.5, 12),
    (0.625, 16),
    (0.75, 20),
    (1.0, 25),
    (1.25, 30),
    (1.5, 40),
    (1.75, 45),
    (2.0, 50),
    (2.5, 60),
    (3.0, 75),
    (3.5, 90),
];

impl Words {
    fn new(units: Units) -> Self {
        Self {
            metric: units == Units::Metric,
        }
    }

    /// `1 1/4"` or `30 mm`.
    fn pocket_length(self, length: f64) -> String {
        if self.metric {
            format!("{} mm", trade_mm(length, &POCKET_MM, 1.0))
        } else {
            format!("{}\"", inches(length))
        }
    }

    /// `#8 × 1 1/4"` or `4 × 30 mm`.
    fn wood_screw(self, gauge: &str, length: f64) -> String {
        if self.metric {
            let diameter = match gauge {
                "#4" => "3",
                "#6" => "3.5",
                "#8" => "4",
                "#10" => "5",
                "#12" => "5.5",
                "#14" => "6",
                other => other,
            };
            format!("{diameter} × {} mm", trade_mm(length, &SCREW_MM, 5.0))
        } else {
            format!("{gauge} × {}\"", inches(length))
        }
    }

    /// `3/8" × 1 1/2"` or `9.5 × 38.1 mm`, to a tenth of a millimetre.
    fn dowel(self, diameter: f64, length: f64) -> String {
        if self.metric {
            format!("{} × {} mm", mm_text(diameter * 25.4), mm_text(length * 25.4))
        } else {
            format!("{}\" × {}\"", inches(diameter), inches(length))
        }
    }

    /// `18"` or `450 mm`: metric slides come in 50 mm steps.
    fn slide_length(self, length: f64) -> String {
        if self.metric {
            format!("{} mm", mm_text((length * 25.4 / 50.0).round() * 50.0))
        } else {
            format!("{}\"", inches(length))
        }
    }

    fn list(self, item: &hardware::Item) -> String {
        item.list_in(if self.metric { Units::Metric } else { Units::Fraction })
            .to_string()
    }
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
    compute_hardware_in(spec, Units::Fraction)
}

/// [`compute_hardware`], worded in the buyer's units.
pub fn compute_hardware_in(spec: &Spec, units: Units) -> Vec<HardwareRow> {
    let words = Words::new(units);
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
                        description: format!("{} {t}-thread pocket screws", words.pocket_length(length)),
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
                        description: format!("{} wood screws", words.wood_screw(gauge, length)),
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
                        description: format!("{} dowels", words.dowel(h.diameter, length)),
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
                        "{} dowels (estimated: dowel holes not placed yet)",
                        words.dowel(0.375, length)
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
                        "{} {t}-thread pocket screws (estimated: pocket holes not placed yet)",
                        words.pocket_length(length)
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
                    description: format!(
                        "{} wood screws (estimated: screws not placed yet)",
                        words.wood_screw(gauge, length)
                    ),
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
        // A finish names itself on the hinges and the pull, and keeps them on rows of their own.
        let finish = movable.finish();
        let finished = |key: String, desc: String| match finish {
            Some(f) => (format!("{key}|{}", f.as_str()), format!("{desc}, {}", f.label())),
            None => (key, desc),
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
                let chosen = hinge.as_deref().and_then(hardware::find);
                // A piano hinge is one continuous piece, however long the edge.
                let continuous =
                    chosen.is_some_and(|i| i.model.get("shape").and_then(|s| s.as_str()) == Some("pianoHinge"));
                let count = if continuous { 1 } else { count };
                let (key, desc) = match chosen {
                    Some(item) => (format!("hinge|{}", item.id), words.list(item)),
                    None => match style {
                        MovableStyle::Overlay => ("hinge|overlay".into(), "overlay cabinet hinges".into()),
                        MovableStyle::Inset => ("hinge|inset".into(), "inset butt hinges".into()),
                    },
                };
                let (key, desc) = finished(key, desc);
                rows.push(Sized {
                    key,
                    kind: HardwareKind::Hinge,
                    description: desc,
                    qty: count,
                    derived: false,
                });
            }
            Movable::Leaf {
                hinge_edge,
                hinge,
                support,
                ..
            } => {
                let span = hinge_edge_length(anchor, *hinge_edge);
                // "none": the leaf is screwed to its brackets, which pivot on their own knuckles.
                if hinge.as_deref() != Some("none") {
                    let chosen = hinge.as_deref().and_then(hardware::find);
                    let continuous =
                        chosen.is_some_and(|i| i.model.get("shape").and_then(|s| s.as_str()) == Some("pianoHinge"));
                    let (key, desc) = match chosen {
                        Some(item) => (format!("hinge|{}", item.id), words.list(item)),
                        None => ("hinge|inset".into(), "inset butt hinges".into()),
                    };
                    let (key, desc) = finished(key, desc);
                    rows.push(Sized {
                        key,
                        kind: HardwareKind::Hinge,
                        description: desc,
                        qty: if continuous { 1 } else { hinge_count_for(span) },
                        derived: false,
                    });
                }
                // Folding brackets under it: a pair, and a third past 40".
                let bracket = match support.as_deref() {
                    Some(id) => hardware::find(id),
                    None => crate::movables::leaf_support_for(crate::movables::leaf_depth(anchor, *hinge_edge)),
                };
                if let Some(item) = bracket {
                    let (key, desc) = finished(format!("item|{}", item.id), words.list(item));
                    rows.push(Sized {
                        key,
                        kind: HardwareKind::Other,
                        description: desc,
                        qty: hinge_count_for(span),
                        derived: false,
                    });
                }
            }
            Movable::Drawer { part_ids, slide, .. } => {
                let members: Vec<&Part> = part_ids.iter().filter_map(|id| spec.part(id)).collect();
                let depth = extent_along(&members, thickness_of, front_normal(anchor));
                let length = slide_length_for(depth);
                let (id, list) = match slide.as_deref().and_then(hardware::find) {
                    Some(item) => (item.id.as_str(), words.list(item)),
                    None => ("default", "side-mount drawer slides (pairs)".to_string()),
                };
                rows.push(Sized {
                    key: format!("drawerSlide|{id}|{}", key_num(length)),
                    kind: HardwareKind::DrawerSlide,
                    description: format!("{} {list}", words.slide_length(length)),
                    qty: 1,
                    derived: false,
                });
            }
        }
        match movable.pull() {
            Some("none") => {}
            Some(id) if hardware::find(id).is_some() => {
                let item = hardware::find(id).expect("checked");
                let (key, description) = finished(format!("item|{}", item.id), words.list(item));
                rows.push(Sized {
                    key,
                    kind: HardwareKind::Knob,
                    description,
                    qty: 1,
                    derived: false,
                });
            }
            _ => {
                let (key, description) = finished("knob".into(), "cabinet knobs".into());
                rows.push(Sized {
                    key,
                    kind: HardwareKind::Knob,
                    description,
                    qty: 1,
                    derived: false,
                });
            }
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
                words.list(item),
            ),
            None => (
                HardwareKind::Other,
                format!("{} (not in this version's catalog)", mount.item),
            ),
        };
        let (key, description) = match mount.finish {
            Some(f) => (
                format!("item|{}|{}", mount.item, f.as_str()),
                format!("{description}, {}", f.label()),
            ),
            None => (format!("item|{}", mount.item), description),
        };
        rows.push(Sized {
            key,
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
                index.insert(row.key.clone(), merged.len());
                merged.push(HardwareRow {
                    key: row.key,
                    kind: row.kind,
                    description: row.description,
                    qty: row.qty,
                    derived: row.derived,
                    unit_price: None,
                    cost: None,
                });
            }
        }
    }
    merged.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| locale_compare(&a.description, &b.description))
    });
    merged.extend(edge_banding(spec, units));
    merged
}

/// A tenth more banding than the edges measure, for trimming the ends and a spoiled piece.
const BANDING_SPARE: f64 = 1.1;

/// Edge banding to buy, one row per material with banded parts: the banded edges' total length
/// (every copy of a part counts), a tenth spare, rounded up to whole feet or metres. The banding
/// is as wide as the material is thick.
fn edge_banding(spec: &Spec, units: Units) -> Vec<HardwareRow> {
    let mut totals: Vec<(&crate::spec::Material, f64)> = Vec::new();
    for part in &spec.parts {
        let Some(edges) = part.edge_band.as_deref().filter(|e| !e.is_empty()) else {
            continue;
        };
        let Some(material) = spec.material(&part.material_id) else {
            continue;
        };
        let length: f64 = edges
            .iter()
            .map(|e| if e.is_l_edge() { part.size.l } else { part.size.w })
            .sum::<f64>()
            * f64::from(part.qty());
        match totals.iter_mut().find(|(m, _)| m.id == material.id) {
            Some((_, sum)) => *sum += length,
            None => totals.push((material, length)),
        }
    }
    totals
        .into_iter()
        .map(|(material, inches)| {
            let width = crate::units::format_length(material.thickness, units);
            let (qty, unit, per) = if units == Units::Metric {
                ((inches * 0.0254 * BANDING_SPARE).ceil(), "Metres", "m")
            } else {
                ((inches / 12.0 * BANDING_SPARE).ceil(), "Feet", "ft")
            };
            HardwareRow {
                // Priced per foot or per metre, by its width.
                key: format!("edgeBanding|{}|{per}", key_num(material.thickness)),
                kind: HardwareKind::EdgeBanding,
                description: format!("{unit} of {width} edge banding ({})", material.name),
                qty: qty as u32,
                derived: false,
                unit_price: None,
                cost: None,
            }
        })
        .collect()
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
