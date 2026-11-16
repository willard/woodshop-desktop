//! Cross-part rules: material fit, joints, groups, movables, floating, piercing and fastening.

use std::collections::{HashMap, HashSet};

use super::{EPS, LintIssue, Severity, len};
use crate::cutlist::DEFAULT_STOCK_LENGTH;
use crate::fasteners::{POCKET_BITE_FRACTION, pocket_segments, screw_segments};
use crate::geometry::{
    Aabb, TOUCH_TOL, local_axes_world, obb_penetration, php_float as f, round_to, separation, world_aabb,
};
use crate::movables::{HARDWARE_REACH, OVERLAY_ALLOWANCE};
use crate::spec::{GrainAxis, JointType, Material, MaterialType, Movable, Op, Part, Spec, Vec3};

fn r3(v: f64) -> String {
    f(round_to(v, 3))
}

fn thickness(spec: &Spec, part: &Part) -> f64 {
    spec.thickness_of(part).unwrap_or(0.0)
}

fn aabb(spec: &Spec, part: &Part) -> Aabb {
    world_aabb(part, thickness(spec, part))
}

pub(super) fn part_fits_material(part: &Part, material: &Material, issues: &mut Vec<LintIssue>) {
    let (l, w) = (part.size.l, part.size.w);
    let name = &part.name;

    match material.kind {
        MaterialType::Sheet => {
            let Some(sheet) = material.sheet_size else { return };
            let (sl, sw) = (sheet.l, sheet.w);
            let grain_axis = part.grain_axis();
            let grain_locked = material.has_grain() && grain_axis != GrainAxis::None;
            let fits = if grain_locked {
                if grain_axis == GrainAxis::L {
                    l <= sl + EPS && w <= sw + EPS
                } else {
                    w <= sl + EPS && l <= sw + EPS
                }
            } else {
                (l <= sl + EPS && w <= sw + EPS) || (l <= sw + EPS && w <= sl + EPS)
            };
            if !fits {
                issues.push(LintIssue::part(
                    Severity::Error,
                    "part.oversized",
                    format!(
                        "Part \"{name}\" ({}×{}) does not fit {} sheet ({}×{}).",
                        f(l),
                        len(w),
                        material.name,
                        f(sl),
                        len(sw)
                    ),
                    &part.id,
                ));
            }
        }
        MaterialType::Round => {
            // A dowel's blank is diameter × diameter × length; the diameter is the thickness.
            if (w - material.thickness).abs() > EPS {
                issues.push(LintIssue::part(
                    Severity::Error,
                    "part.round-width",
                    format!(
                        "Part \"{name}\" is on round stock {} ({} diameter), so its width must be {}, not {}.",
                        material.name,
                        len(material.thickness),
                        len(material.thickness),
                        len(w)
                    ),
                    &part.id,
                ));
            }
            // Every op is defined against faces and edges of a rectangular blank.
            if !part.ops().is_empty() {
                issues.push(LintIssue::part(
                    Severity::Error,
                    "part.round-ops",
                    format!(
                        "Part \"{name}\" is round stock, so it can't take cuts or holes: those need the flat faces and square edges of a rectangular blank."
                    ),
                    &part.id,
                ));
            }
            fits_stock_length(part, material, issues);
        }
        MaterialType::Lumber => {
            if let Some(sw) = material.stock_width
                && w > sw + EPS
            {
                issues.push(LintIssue::part(
                    Severity::Error,
                    "part.oversized",
                    format!(
                        "Part \"{name}\" width {} exceeds {} stock width {}.",
                        len(w),
                        material.name,
                        len(sw)
                    ),
                    &part.id,
                ));
            }
            fits_stock_length(part, material, issues);
        }
    }
}

/// A stick-stock part must be no longer than its stock; with no `stockLengths` the linter judges
/// against the same default the cut list packs against.
fn fits_stock_length(part: &Part, material: &Material, issues: &mut Vec<LintIssue>) {
    let listed = material.stock_lengths.as_deref().filter(|l| !l.is_empty());
    let longest = listed.map_or(DEFAULT_STOCK_LENGTH, |l| {
        l.iter().copied().fold(f64::NEG_INFINITY, f64::max)
    });
    if part.size.l <= longest + EPS {
        return;
    }
    let (name, length, mat) = (&part.name, len(part.size.l), &material.name);
    issues.push(LintIssue::part(
        Severity::Error,
        "part.oversized",
        if listed.is_some() {
            format!("Part \"{name}\" length {length} exceeds longest {mat} stock {}.", len(longest))
        } else {
            format!(
                "Part \"{name}\" length {length} exceeds the {} stock assumed for {mat} — list the lengths it is sold in on the material (stockLengths), or shorten the part.",
                len(longest))
        },
        &part.id,
    ));
}

pub(super) fn joints(spec: &Spec, issues: &mut Vec<LintIssue>) {
    for (index, joint) in spec.joints().iter().enumerate() {
        let id = joint.id.as_deref();
        let label = match id {
            None => format!("Joint {index}"),
            Some(id) => format!("Joint \"{id}\" (index {index})"),
        };
        let issue =
            |code: &str, severity: Severity, message: String| LintIssue::joint(code, severity, message, index, id);

        let (Some(host), Some(insert)) = (spec.part(&joint.host_part_id), spec.part(&joint.insert_part_id)) else {
            issues.push(issue(
                "joint.ref-missing",
                Severity::Error,
                format!("{label} references a part that doesn't exist."),
            ));
            continue;
        };

        let Some(op_ref) = joint.op_ref else {
            // A butt joint with no op behind it is glue on end grain: looks joined, isn't.
            if joint.kind == JointType::Butt {
                issues.push(issue(
                    "joint.glue-only",
                    Severity::Warn,
                    format!(
                        "\"{}\" is butted to \"{}\" with nothing but glue — end-grain glue joints fail. Add screws, pocket screws, or dowels.",
                        insert.name, host.name
                    ),
                ));
            }
            continue;
        };
        let Some(op) = host.ops().get(op_ref) else {
            issues.push(issue(
                "joint.op-missing",
                Severity::Error,
                format!(
                    "{label} points at cut #{op_ref} on \"{}\", which has no such cut.",
                    host.name
                ),
            ));
            continue;
        };

        // A fastener joint must point at the fastener that makes it.
        let expected_ok = match joint.kind {
            JointType::PocketScrew => Some(matches!(op, Op::PocketHoles(_))),
            JointType::Screw => Some(matches!(op, Op::Screws(_))),
            JointType::Dowel => Some(matches!(op, Op::Hole(_))),
            JointType::Dado => Some(matches!(op, Op::Dado(_) | Op::Groove(_))),
            JointType::Rabbet => Some(matches!(op, Op::Rabbet(_))),
            JointType::Butt => None,
        };
        if expected_ok == Some(false) {
            issues.push(issue(
                "joint.op-mismatch",
                Severity::Error,
                format!(
                    "{label} is a {} joint, but cut #{op_ref} on \"{}\" is a {}.",
                    joint.kind.as_str(),
                    host.name,
                    op.type_name()
                ),
            ));
            continue;
        }

        if joint.kind == JointType::Dado
            && let Op::Dado(c) | Op::Groove(c) = op
        {
            let mate_thickness = spec.thickness_of(insert);
            if let Some(mt) = mate_thickness
                && (c.width - mt).abs() > EPS
            {
                issues.push(issue(
                    "joint.dado-width-mismatch",
                    Severity::Error,
                    format!(
                        "Dado on \"{}\" is {} wide but mate \"{}\" is {} thick.",
                        host.name,
                        len(c.width),
                        insert.name,
                        len(mt)
                    ),
                ));
            }
            // The joint is an annotation, not a constraint: verify the insert really reaches
            // the bottom of the channel it claims to sit in.
            let host_box = aabb(spec, host);
            let insert_box = world_aabb(insert, mate_thickness.unwrap_or(0.0));
            let penetration = -separation(&host_box, &insert_box);
            if penetration < c.depth - TOUCH_TOL {
                let detail = if penetration > TOUCH_TOL {
                    format!("only overlaps it by {} — seat it the full dado depth", len(penetration))
                } else {
                    format!(
                        "sits {} away — move or extend it so it bottoms in the dado",
                        len((-penetration).max(0.0))
                    )
                };
                issues.push(issue(
                    "joint.mate-not-seated",
                    Severity::Error,
                    format!(
                        "{label}: \"{}\" should seat {} into the dado on \"{}\" but {detail}.",
                        insert.name,
                        len(c.depth),
                        host.name
                    ),
                ));
            }
        }
    }
}

/// An edge that goes INTO a dado or rabbet must stay square, or it no longer seats.
pub(super) fn eased_joint_edges(spec: &Spec, issues: &mut Vec<LintIssue>) {
    for joint in spec.joints() {
        if !matches!(joint.kind, JointType::Dado | JointType::Rabbet) {
            continue;
        }
        let (Some(host), Some(insert)) = (spec.part(&joint.host_part_id), spec.part(&joint.insert_part_id)) else {
            continue;
        };
        // The edge whose outward direction points at the host is the one buried in the channel.
        let [ax, ay, _] = local_axes_world(insert);
        let to_host: Vec3 = std::array::from_fn(|i| host.transform.pos[i] - insert.transform.pos[i]);
        let length = (to_host[0].powi(2) + to_host[1].powi(2) + to_host[2].powi(2)).sqrt();
        if length < EPS {
            continue;
        }
        let dot = |a: Vec3| (a[0] * to_host[0] + a[1] * to_host[1] + a[2] * to_host[2]) / length;
        let facing = |edge: crate::spec::Edge| match edge {
            crate::spec::Edge::W1 => dot(ax),
            crate::spec::Edge::W0 => -dot(ax),
            crate::spec::Edge::L1 => dot(ay),
            crate::spec::Edge::L0 => -dot(ay),
        };
        for (i, op) in insert.ops().iter().enumerate() {
            let Op::Ease(e) = op else { continue };
            if facing(e.edge()) < 0.7 {
                continue;
            }
            issues.push(LintIssue::op(
                Severity::Warn,
                "op.ease-seated-edge",
                format!(
                    "\"{}\" eases edge {}, the edge housed in the {} on \"{}\" — a softened edge can't seat in the channel. Leave that edge square and ease the show edges instead.",
                    insert.name,
                    e.edge().as_str(),
                    joint.kind.as_str(),
                    host.name
                ),
                &insert.id,
                i,
            ));
        }
    }
}

/// Groups: every membership names a real part, and a part belongs to at most one group.
pub(super) fn groups(spec: &Spec, issues: &mut Vec<LintIssue>) {
    let mut member_of: HashMap<&str, &str> = HashMap::new();
    for group in spec.groups() {
        let label = group.name.as_deref().unwrap_or(&group.id);
        for part_id in &group.part_ids {
            if spec.part(part_id).is_none() {
                issues.push(LintIssue::part(
                    Severity::Error,
                    "group.ref-missing",
                    format!("Group \"{label}\" references part \"{part_id}\" which doesn't exist."),
                    part_id,
                ));
            }
            match member_of.get(part_id.as_str()) {
                Some(first) => issues.push(LintIssue::part(
                    Severity::Error,
                    "group.member-overlap",
                    format!(
                        "Part \"{part_id}\" belongs to both group \"{first}\" and group \"{}\" — groups are flat.",
                        group.id
                    ),
                    part_id,
                )),
                None => {
                    member_of.insert(part_id, &group.id);
                }
            }
        }
    }
}

/// Doors and drawers: refs resolve, the anchor is a member, movables are flat; plus the shop
/// checks — hardware has something to mount on, a drawer opens outward, a front doesn't overhang.
pub(super) fn movables(spec: &Spec, issues: &mut Vec<LintIssue>) {
    let mut member_of: HashMap<&str, &str> = HashMap::new();

    for movable in spec.movables() {
        let is_door = matches!(movable, Movable::Door { .. });
        let kind_label = if is_door { "Door" } else { "Drawer" };
        let label = movable.name().unwrap_or(movable.id());
        let part_ids = movable.part_ids();

        for part_id in part_ids {
            if spec.part(part_id).is_none() {
                issues.push(LintIssue::part(
                    Severity::Error,
                    "movable.ref-missing",
                    format!("{kind_label} \"{label}\" references part \"{part_id}\" which doesn't exist."),
                    part_id,
                ));
            }
            match member_of.get(part_id.as_str()) {
                Some(first) => issues.push(LintIssue::part(
                    Severity::Error,
                    "movable.member-overlap",
                    format!(
                        "Part \"{part_id}\" belongs to both \"{first}\" and \"{}\" — movables are flat.",
                        movable.id()
                    ),
                    part_id,
                )),
                None => {
                    member_of.insert(part_id, movable.id());
                }
            }
        }

        let anchor_id = movable.anchor_part_id();
        if !part_ids.iter().any(|p| p == anchor_id) {
            let field = if is_door { "panel" } else { "front" };
            issues.push(LintIssue::part(
                Severity::Error,
                "movable.anchor-missing",
                format!(
                    "{kind_label} \"{label}\" names {field} \"{anchor_id}\" but doesn't list it in partIds — the anchor must be a member."
                ),
                anchor_id,
            ));
            continue;
        }
        let Some(anchor) = spec.part(anchor_id) else { continue };

        let members: Vec<&Part> = part_ids.iter().filter_map(|id| spec.part(id)).collect();
        let rest: Vec<&Part> = spec.parts.iter().filter(|p| !part_ids.contains(&p.id)).collect();
        if rest.is_empty() {
            continue;
        }

        // Nothing to screw the hinges or slides to.
        let reachable = members.iter().any(|m| {
            let b = aabb(spec, m);
            rest.iter().any(|o| separation(&b, &aabb(spec, o)) <= HARDWARE_REACH)
        });
        if !reachable {
            let hardware = if is_door { "hinges" } else { "slides" };
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.adrift",
                format!(
                    "Nothing to mount \"{label}\"'s {hardware} on — no member comes within {} of the rest of the build.",
                    len(HARDWARE_REACH)),
                anchor_id,
            ));
        }

        let normal = local_axes_world(anchor)[2];

        // A drawer whose front's show face points at the build opens into the cabinet.
        if !is_door {
            let n = rest.len() as f64;
            let mut centroid = [0.0; 3];
            for p in &rest {
                for (axis, c) in centroid.iter_mut().enumerate() {
                    *c += p.transform.pos[axis] / n;
                }
            }
            let outward: f64 = (0..3)
                .map(|i| (anchor.transform.pos[i] - centroid[i]) * normal[i])
                .sum();
            if outward < 0.0 {
                issues.push(LintIssue::part(
                    Severity::Warn,
                    "movable.drawer-inverted",
                    format!(
                        "Drawer \"{label}\" opens into the cabinet — its front's show face points at the rest of the build. Rotate the front or pick the other face."
                    ),
                    anchor_id,
                ));
            }
        }

        // A front larger than the face it covers, judged across the front plane only.
        let anchor_box = aabb(spec, anchor);
        let mut rest_box = Aabb::EMPTY;
        for p in &rest {
            rest_box.union(&aabb(spec, p));
        }
        let mut depth_axis = 0;
        for axis in 1..3 {
            if normal[axis].abs() > normal[depth_axis].abs() {
                depth_axis = axis;
            }
        }
        let overhang = (0..3).filter(|&a| a != depth_axis).any(|a| {
            anchor_box.min[a] < rest_box.min[a] - OVERLAY_ALLOWANCE - TOUCH_TOL
                || anchor_box.max[a] > rest_box.max[a] + OVERLAY_ALLOWANCE + TOUCH_TOL
        });
        if overhang {
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.oversize",
                format!(
                    "{kind_label} \"{label}\" front is bigger than the face it covers — it overhangs the build by more than the 0.5\" overlay allowance."
                ),
                anchor_id,
            ));
        }
    }
}

/// Parts placed at the exact same position with identical size and orientation. Reported by
/// the MCP `check_design` tool; not part of [`super::lint`].
pub fn duplicate_placements(spec: &Spec) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    let parts = &spec.parts;
    for i in 0..parts.len() {
        for b in &parts[i + 1..] {
            let a = &parts[i];
            let (pa, pb) = (a.transform.pos, b.transform.pos);
            let dist_sq: f64 = (0..3).map(|k| (pa[k] - pb[k]).powi(2)).sum();
            if dist_sq > EPS {
                continue;
            }
            let (ra, rb) = (a.transform.rot(), b.transform.rot());
            if (0..3).map(|k| (ra[k] - rb[k]).abs()).sum::<f64>() > EPS {
                continue;
            }
            if (a.size.l - b.size.l).abs() + (a.size.w - b.size.w).abs() > EPS {
                continue;
            }
            issues.push(LintIssue::part(
                Severity::Error,
                "part.duplicate-placement",
                format!(
                    "Part \"{}\" is placed at the exact same position as \"{}\" — one is redundant.",
                    b.name, a.name
                ),
                &b.id,
            ));
        }
    }
    issues
}

/// No part floats free of the assembly (movable members excepted — their hardware carries them).
pub(super) fn floating_parts(spec: &Spec, member_of: &HashMap<&str, &Movable>, issues: &mut Vec<LintIssue>) {
    if spec.parts.len() < 2 {
        return;
    }
    let boxes: Vec<(&Part, Aabb)> = spec.parts.iter().map(|p| (p, aabb(spec, p))).collect();
    for (part, b) in &boxes {
        if member_of.contains_key(part.id.as_str()) {
            continue;
        }
        let mut connected = false;
        let mut nearest: Option<(&Part, Aabb)> = None;
        let mut nearest_sep = f64::INFINITY;
        for (other, ob) in &boxes {
            if other.id == part.id {
                continue;
            }
            let sep = separation(b, ob);
            if sep <= TOUCH_TOL {
                connected = true;
                break;
            }
            if sep < nearest_sep {
                nearest = Some((other, *ob));
                nearest_sep = sep;
            }
        }
        if connected {
            continue;
        }
        // Include the exact translation that would seat it.
        let hint = nearest
            .map(|(other, ob)| {
                let shift: Vec<String> = ["x", "y", "z"]
                    .iter()
                    .enumerate()
                    .filter_map(|(axis, label)| {
                        let d = if b.min[axis] > ob.max[axis] {
                            ob.max[axis] - b.min[axis]
                        } else if ob.min[axis] > b.max[axis] {
                            ob.min[axis] - b.max[axis]
                        } else {
                            0.0
                        };
                        (d.abs() > EPS).then(|| format!("{label} {}", r3(d)))
                    })
                    .collect();
                format!(
                    " Nearest part is \"{}\" — shift pos by [{}] to touch it.",
                    other.name,
                    shift.join(", ")
                )
            })
            .unwrap_or_default();
        issues.push(LintIssue::part(
            Severity::Error,
            "part.floating",
            format!(
                "Part \"{}\" floats free — it doesn't touch any other part.{hint}",
                part.name
            ),
            &part.id,
        ));
    }
}

/// One part passing clean through the body of another. An AABB pre-filter (intruder spans the
/// pierced part on one axis, overlap strictly interior on the others) is confirmed by an oriented
/// box test, since AABBs inflate tilted parts. Notched parts are exempt.
pub(super) fn pierced_parts(spec: &Spec, issues: &mut Vec<LintIssue>) {
    const LABELS: [&str; 3] = ["x", "y", "z"];
    let boxes: Vec<(&Part, f64, Aabb, bool)> = spec
        .parts
        .iter()
        .map(|p| {
            let t = thickness(spec, p);
            let notched = p.ops().iter().any(|o| matches!(o, Op::Notch(_)));
            (p, t, world_aabb(p, t), notched)
        })
        .collect();

    for (pierced, pt, pb, notched) in &boxes {
        if *notched {
            continue;
        }
        for (intruder, it, ib, _) in &boxes {
            if intruder.id == pierced.id {
                continue;
            }
            let overlap: [(f64, f64); 3] =
                std::array::from_fn(|i| (pb.min[i].max(ib.min[i]), pb.max[i].min(ib.max[i])));
            if overlap.iter().any(|(lo, hi)| hi - lo <= EPS) {
                continue;
            }
            for axis in 0..3 {
                let extent = pb.max[axis] - pb.min[axis];
                let spans_through = overlap[axis].1 - overlap[axis].0 >= extent - TOUCH_TOL;
                let interior = (0..3)
                    .filter(|&i| i != axis)
                    .all(|i| overlap[i].0 > pb.min[i] + TOUCH_TOL && overlap[i].1 < pb.max[i] - TOUCH_TOL);
                if !(spans_through && interior) {
                    continue;
                }
                if obb_penetration(pierced, *pt, intruder, *it) <= TOUCH_TOL {
                    break;
                }
                // Suggest ending the intruder at the pierced face nearest its own bulk.
                let intruder_centre = (ib.min[axis] + ib.max[axis]) / 2.0;
                let pierced_centre = (pb.min[axis] + pb.max[axis]) / 2.0;
                let plane = if intruder_centre < pierced_centre {
                    pb.min[axis]
                } else {
                    pb.max[axis]
                };
                issues.push(LintIssue::part(
                    Severity::Error,
                    "part.pierce",
                    format!(
                        "Part \"{}\" passes completely through \"{}\" ({} thick along {}) — parts cannot occupy the same space. End it at {} = {} or move it clear.",
                        intruder.name,
                        pierced.name,
                        len(extent),
                        LABELS[axis],
                        LABELS[axis],
                        len(plane)
                    ),
                    &intruder.id,
                ));
                break;
            }
        }
    }
}

/// Where each screw of a fastener op ends up.
pub struct FastenerLandings<'a> {
    /// Parts a screw tip lands inside.
    pub mates: Vec<&'a Part>,
    /// Per screw: did it land in any part?
    pub landed: Vec<bool>,
    /// Per screw: position along its run, on the from/to datum.
    pub datums: Vec<f64>,
}

pub fn fastener_landings<'a>(spec: &'a Spec, host: &Part, op: &Op) -> FastenerLandings<'a> {
    let t = thickness(spec, host);
    let (segments, along_length) = match op {
        Op::PocketHoles(p) => (pocket_segments(host, t, p), p.edge.is_l_edge()),
        Op::Screws(s) => (screw_segments(host, t, s), s.axis == crate::spec::Axis::L),
        _ => {
            return FastenerLandings {
                mates: vec![],
                landed: vec![],
                datums: vec![],
            };
        }
    };

    let tips: Vec<Vec3> = segments
        .iter()
        .map(|s| crate::geometry::local_to_world(host, s.tip))
        .collect();
    // The head sits on the run line for every op shape, so this datum is exact.
    let datums = segments
        .iter()
        .map(|s| {
            if along_length {
                s.head[0] + host.size.l / 2.0
            } else {
                s.head[1] + host.size.w / 2.0
            }
        })
        .collect();

    let boxes: Vec<(&Part, Aabb)> = spec
        .parts
        .iter()
        .filter(|o| o.id != host.id)
        .map(|o| (o, aabb(spec, o)))
        .collect();
    let inside =
        |tip: &Vec3, b: &Aabb| (0..3).all(|i| tip[i] >= b.min[i] - TOUCH_TOL && tip[i] <= b.max[i] + TOUCH_TOL);

    let mates = boxes
        .iter()
        .filter(|(_, b)| tips.iter().any(|t| inside(t, b)))
        .map(|(p, _)| *p)
        .collect();
    let landed = tips.iter().map(|t| boxes.iter().any(|(_, b)| inside(t, b))).collect();
    FastenerLandings { mates, landed, datums }
}

/// Touching is not holding: a part that no joint names and no fastener reaches is resting in
/// place — it renders, it cuts, and it falls over in the shop.
pub(super) fn fastening(spec: &Spec, member_of: &HashMap<&str, &Movable>, issues: &mut Vec<LintIssue>) {
    if spec.parts.len() < 2 {
        return;
    }
    let mut held: HashSet<&str> = HashSet::new();
    for joint in spec.joints() {
        held.insert(&joint.host_part_id);
        held.insert(&joint.insert_part_id);
    }
    for part in &spec.parts {
        for op in part.ops() {
            if !matches!(op, Op::PocketHoles(_) | Op::Screws(_)) {
                continue;
            }
            let mates = fastener_landings(spec, part, op).mates;
            if mates.is_empty() {
                continue;
            }
            held.insert(&part.id);
            held.extend(mates.iter().map(|m| m.id.as_str()));
        }
    }
    let floating: HashSet<String> = issues
        .iter()
        .filter(|i| i.code == "part.floating")
        .filter_map(|i| i.part_id.clone())
        .collect();

    for part in &spec.parts {
        if held.contains(part.id.as_str()) || floating.contains(&part.id) {
            continue;
        }
        // Movables: hinges hold a door's panel outright; every other member must still be
        // fastened to the movable itself, but the miss is a warn — the hardware carries it.
        if let Some(movable) = member_of.get(part.id.as_str()) {
            let kind = match movable {
                Movable::Door { panel_part_id, .. } if *panel_part_id == part.id => continue,
                Movable::Door { .. } => "door",
                Movable::Drawer { .. } => "drawer",
            };
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.member-loose",
                format!(
                    "\"{}\" rides on the {kind} hardware alone — fasten it to the rest of the {kind}.",
                    part.name
                ),
                &part.id,
            ));
            continue;
        }
        // Name a neighbour it merely rests against — that contact is where the joinery goes.
        let b = aabb(spec, part);
        let against = spec
            .parts
            .iter()
            .find(|o| o.id != part.id && separation(&b, &aabb(spec, o)) <= TOUCH_TOL)
            .map(|o| format!(" It only rests against \"{}\".", o.name))
            .unwrap_or_default();
        issues.push(LintIssue::part(
            Severity::Error,
            "part.unfastened",
            format!(
                "Nothing fastens \"{}\" to the build.{against} House it in a dado or rabbet, or add pocket screws, screws, or dowels at the joint.",
                part.name
            ),
            &part.id,
        ));
    }
}

/// A fastener op is metal aimed at a mate; if nothing is on the receiving side it holds air.
pub(super) fn fastener_ops(spec: &Spec, issues: &mut Vec<LintIssue>) {
    for part in &spec.parts {
        for (op_index, op) in part.ops().iter().enumerate() {
            let (is_screws, where_, length) = match op {
                Op::Screws(s) => (true, format!("the {} face", face_name(s.face)), s.length),
                Op::PocketHoles(p) => (false, format!("edge {}", p.edge.as_str()), p.length),
                _ => continue,
            };
            let FastenerLandings { mates, landed, datums } = fastener_landings(spec, part, op);
            let metal = if is_screws { "screws" } else { "pocket screws" };

            if mates.is_empty() {
                let label = if is_screws { "Screws" } else { "Pocket screws" };
                issues.push(LintIssue::op(
                    Severity::Warn,
                    "op.fastener-no-mate",
                    format!(
                        "{label} on \"{}\" ({where_}) reach no other part — they fasten nothing.",
                        part.name
                    ),
                    &part.id,
                    op_index,
                ));
                continue;
            }

            // Some landed, some did not: the run that DID land is the from/to that fixes it.
            let missed = landed.iter().filter(|hit| !**hit).count();
            if missed > 0 {
                let held: Vec<f64> = landed
                    .iter()
                    .zip(&datums)
                    .filter(|(hit, _)| **hit)
                    .map(|(_, d)| *d)
                    .collect();
                let lo = round_to(held.iter().copied().fold(f64::INFINITY, f64::min), 3);
                let hi = round_to(held.iter().copied().fold(f64::NEG_INFINITY, f64::max), 3);
                let fix = if lo == hi {
                    format!(
                        "only reaches it at {} along the run. Move the mate under the row, or lengthen it, so every screw bites.",
                        len(lo)
                    )
                } else {
                    format!(
                        "only reaches it between {} and {} along the run. Bound the row with from: {}, to: {}, or lengthen the mate, so every screw bites.",
                        len(lo),
                        len(hi),
                        f(lo),
                        f(hi)
                    )
                };
                issues.push(LintIssue::op(
                    Severity::Warn,
                    "op.fastener-partial-miss",
                    format!(
                        "{missed} of {} {metal} on \"{}\" ({where_}) land in no part — the row {fix}",
                        landed.len(),
                        part.name
                    ),
                    &part.id,
                    op_index,
                ));
            }

            // Screws longer than the wood they run through come out the far side. Only checked
            // when the spec names a length — derived lengths are already clamped.
            if let Some(length) = length {
                let deepest = mates.iter().map(|m| thickness(spec, m)).fold(0.0, f64::max);
                let (travel, limit, label) = if is_screws {
                    (length, thickness(spec, part) + deepest, "screws")
                } else {
                    (length * POCKET_BITE_FRACTION, deepest, "pocket screws")
                };
                if travel > limit + EPS {
                    issues.push(LintIssue::op(
                        Severity::Warn,
                        "op.screw-blowout",
                        format!(
                            "{} {label} on \"{}\" bite {} into {} of wood — the tips come out the far side.",
                            len(length),
                            part.name,
                            len(travel),
                            len(limit)
                        ),
                        &part.id,
                        op_index,
                    ));
                }
            }
        }
    }
}

fn face_name(face: crate::spec::Face) -> &'static str {
    match face {
        crate::spec::Face::Front => "front",
        crate::spec::Face::Back => "back",
    }
}

/// Catalog hardware (1.15): every mount names a real part and sits on it; ids a movable or a
/// mount names exist in the catalog and suit the job.
pub(super) fn hardware(spec: &Spec, issues: &mut Vec<LintIssue>) {
    use crate::hardware::{Role, find, side_extent};

    let mut seen = std::collections::HashSet::new();
    for mount in spec.hardware() {
        if !seen.insert(mount.id.as_str()) {
            issues.push(LintIssue::part(
                Severity::Error,
                "hardware.duplicate-id",
                format!(
                    "Duplicate hardware id \"{}\". Every piece of hardware must have a unique id.",
                    mount.id
                ),
                &mount.part_id,
            ));
        }
        let Some(part) = spec.part(&mount.part_id) else {
            issues.push(LintIssue::part(
                Severity::Error,
                "hardware.part-missing",
                format!(
                    "Hardware \"{}\" is mounted on part \"{}\" which doesn't exist.",
                    mount.id, mount.part_id
                ),
                &mount.part_id,
            ));
            continue;
        };
        let name = match find(&mount.item) {
            Some(item) => {
                if !item.placeable {
                    issues.push(LintIssue::part(
                        Severity::Warn,
                        "hardware.not-placeable",
                        format!(
                            "{} on \"{}\" belong to a drawer, not a part — make the drawer a movable and choose them there.",
                            item.name, part.name
                        ),
                        &part.id,
                    ));
                }
                item.name.as_str()
            }
            None => {
                issues.push(LintIssue::part(
                    Severity::Warn,
                    "hardware.unknown-item",
                    format!(
                        "Hardware \"{}\" on \"{}\" isn't in this version's catalog, so it is drawn as a placeholder.",
                        mount.item, part.name
                    ),
                    &part.id,
                ));
                mount.item.as_str()
            }
        };
        let thickness = spec.material(&part.material_id).map(|m| m.thickness).unwrap_or(0.0);
        let (a, b) = side_extent(part, thickness, mount.side);
        if mount.x > a + EPS || mount.y > b + EPS {
            issues.push(LintIssue::part(
                Severity::Warn,
                "hardware.off-part",
                format!(
                    "{name} on \"{}\" sits off the part: that side is {} × {}, and it is placed {} across and {} up.",
                    part.name,
                    len(a),
                    len(b),
                    len(mount.x),
                    len(mount.y)
                ),
                &part.id,
            ));
        }
    }

    for movable in spec.movables() {
        let label = movable.name().unwrap_or(movable.id());
        let (fitting, role, field) = match movable {
            Movable::Door { hinge, .. } => (hinge.as_deref(), Role::Hinge, "hinge"),
            Movable::Drawer { slide, .. } => (slide.as_deref(), Role::Slide, "slide"),
        };
        let pull = movable.pull().filter(|p| *p != "none");
        for (id, role, field) in [(fitting, role, field), (pull, Role::Pull, "pull")] {
            let Some(id) = id else { continue };
            let problem = match find(id) {
                None => Some(format!(
                    "isn't in this version's catalog, so the default {field} is used"
                )),
                Some(item) if item.role != Some(role) => Some(format!("is not a {field}")),
                Some(_) => None,
            };
            if let Some(problem) = problem {
                issues.push(LintIssue::part(
                    Severity::Warn,
                    "movable.hardware-unknown",
                    format!("\"{label}\" names \"{id}\" as its {field}, which {problem}."),
                    movable.anchor_part_id(),
                ));
            }
        }
    }
}

/// How closely a drawer box has to match the width its slides call for.
const SLIDE_FIT_TOL: f64 = 1.0 / 32.0;

/// Hardware that changes the woodwork: a concealed hinge's cup has to fit in the door's
/// thickness, and a drawer box has to leave its slides exactly their clearance each side.
pub(super) fn hardware_fit(spec: &Spec, issues: &mut Vec<LintIssue>) {
    use crate::movables::{CUP_FLOOR, derived_borings};

    // One finding per door, however many hinges it carries.
    let mut bored: HashSet<&str> = HashSet::new();
    let borings = derived_borings(spec);
    for boring in &borings {
        let Some(panel) = spec.part(&boring.part_id) else {
            continue;
        };
        let Some(depth) = boring.hole.depth else { continue };
        let panel_thickness = thickness(spec, panel);
        if panel_thickness - depth < CUP_FLOOR - EPS && bored.insert(boring.movable_id.as_str()) {
            let hinge = crate::hardware::find(&boring.item).map_or("Its hinge", |i| i.name.as_str());
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.hinge-cup-deep",
                format!(
                    "\"{}\" is {} thick, too thin for its hinge cups: {hinge} bores {} deep and needs at least {} of door. Use thicker stock or a surface-mounted hinge.",
                    panel.name,
                    len(panel_thickness),
                    len(depth),
                    len(depth + CUP_FLOOR)),
                &panel.id,
            ));
        }
    }

    for movable in spec.movables() {
        let Movable::Drawer {
            part_ids,
            front_part_id,
            slide,
            ..
        } = movable
        else {
            continue;
        };
        let item = crate::hardware::find(slide.as_deref().unwrap_or(crate::hardware::DEFAULT_SLIDE));
        let Some(item) = item else { continue };
        // Only side-mount slides take their room beside the box.
        if item.model.get("mount").and_then(|m| m.as_str()) != Some("side") {
            continue;
        }
        let Some(clearance) = item.model.get("thickness").and_then(serde_json::Value::as_f64) else {
            continue;
        };
        let Some(front) = spec.part(front_part_id) else {
            continue;
        };

        // The drawer runs along its front's normal; its slides sit either side of the box, on
        // the horizontal axis square to that. A tilted or upward-opening front has no such axis.
        let normal = local_axes_world(front)[2];
        let depth_axis = if normal[0].abs() > 0.999 {
            0
        } else if normal[2].abs() > 0.999 {
            2
        } else {
            continue;
        };
        let side_axis = 2 - depth_axis;

        // A front with a bottom hung behind it is a sketch, not a box: there are no sides for
        // slides to mount on yet, so there is nothing to measure.
        let box_parts: Vec<&Part> = part_ids
            .iter()
            .filter(|id| *id != front_part_id)
            .filter_map(|id| spec.part(id))
            .collect();
        if box_parts.len() < 3 {
            continue;
        }
        let mut box_bounds = Aabb::EMPTY;
        for part in &box_parts {
            box_bounds.union(&aabb(spec, part));
        }

        // The opening's walls: the nearest fixed parts beside the box that overlap it in height
        // and depth.
        let (mut left, mut right) = (f64::NEG_INFINITY, f64::INFINITY);
        for other in spec.parts.iter().filter(|p| !part_ids.contains(&p.id)) {
            let b = aabb(spec, other);
            let overlaps = |axis: usize| {
                b.min[axis] < box_bounds.max[axis] - TOUCH_TOL && b.max[axis] > box_bounds.min[axis] + TOUCH_TOL
            };
            if !overlaps(1) || !overlaps(depth_axis) {
                continue;
            }
            let mid = (box_bounds.min[side_axis] + box_bounds.max[side_axis]) / 2.0;
            if b.max[side_axis] <= mid {
                left = left.max(b.max[side_axis]);
            } else if b.min[side_axis] >= mid {
                right = right.min(b.min[side_axis]);
            }
        }
        if !left.is_finite() || !right.is_finite() {
            continue;
        }

        let label = movable.name().unwrap_or(movable.id());
        let opening = right - left;
        let width = box_bounds.max[side_axis] - box_bounds.min[side_axis];
        let wanted = opening - 2.0 * clearance;
        let (gap_a, gap_b) = (box_bounds.min[side_axis] - left, right - box_bounds.max[side_axis]);
        let message = if (width - wanted).abs() > SLIDE_FIT_TOL {
            let fix = if wanted > 0.0 {
                format!("make the box {} wide", len(wanted))
            } else {
                "the opening is too narrow for these slides".to_string()
            };
            Some(format!(
                "Drawer \"{label}\" has a {} wide box in a {} opening. {} need {} each side: {fix}.",
                len(width),
                len(opening),
                item.name,
                len(clearance)
            ))
        } else if (gap_a - clearance).abs() > SLIDE_FIT_TOL || (gap_b - clearance).abs() > SLIDE_FIT_TOL {
            Some(format!(
                "Drawer \"{label}\" is off-centre in its opening: {} on one side and {} on the other. {} need {} each side.",
                len(gap_a),
                len(gap_b),
                item.name,
                len(clearance)
            ))
        } else {
            None
        };
        if let Some(message) = message {
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.slide-clearance",
                message,
                front_part_id,
            ));
        }
    }
}

/// A lid with nothing to hold it open falls shut on whoever is reaching in. A door is a lid when
/// its panel lies flat, or stands up with its hinge edge along the top (a flip-up door). Any lid
/// stay mounted on the lid or on a part within the stay's reach of it counts.
pub(super) fn lid_stays(spec: &Spec, issues: &mut Vec<LintIssue>) {
    let stays: Vec<(&Part, f64)> = spec
        .hardware
        .iter()
        .flatten()
        .filter_map(|mount| {
            let item = crate::hardware::find(&mount.item)?;
            if item.model.get("shape").and_then(|s| s.as_str()) != Some("lidStay") {
                return None;
            }
            let reach = item
                .model
                .get("length")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            Some((spec.part(&mount.part_id)?, reach))
        })
        .collect();

    for movable in spec.movables() {
        let Movable::Door {
            panel_part_id,
            hinge_edge,
            ..
        } = movable
        else {
            continue;
        };
        let Some(panel) = spec.part(panel_part_id) else {
            continue;
        };
        let [ax, ay, az] = local_axes_world(panel);
        let toward_hinge = match hinge_edge {
            crate::spec::Edge::L0 => ay.map(|v| -v),
            crate::spec::Edge::L1 => ay,
            crate::spec::Edge::W0 => ax.map(|v| -v),
            crate::spec::Edge::W1 => ax,
        };
        let lies_flat = az[1].abs() > 0.999;
        let hinged_at_top = toward_hinge[1] > 0.999;
        if !lies_flat && !hinged_at_top {
            continue;
        }

        let lid = aabb(spec, panel);
        let held = stays.iter().any(|(host, reach)| {
            if host.id == panel.id {
                return true;
            }
            let b = aabb(spec, host);
            (0..3).all(|axis| b.min[axis] <= lid.max[axis] + reach && b.max[axis] >= lid.min[axis] - reach)
        });
        if !held {
            let label = movable.name().unwrap_or(movable.id());
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.lid-stay",
                format!(
                    "\"{label}\" opens upward with nothing to hold it open, so it can drop shut on someone's hands. Add a lid stay (Hardware, Lids) on the side beside it."
                ),
                &panel.id,
            ));
        }
    }
}

/// Undermount slides run under the drawer box, in a recess between the bottom and the lower
/// edges of the sides. A bottom set lower than the slide's height leaves them nowhere to go.
pub(super) fn undermount_recess(spec: &Spec, issues: &mut Vec<LintIssue>) {
    for movable in spec.movables() {
        let Movable::Drawer {
            part_ids,
            front_part_id,
            slide,
            ..
        } = movable
        else {
            continue;
        };
        let Some(item) = slide.as_deref().and_then(crate::hardware::find) else {
            continue;
        };
        if item.model.get("mount").and_then(|m| m.as_str()) != Some("under") {
            continue;
        }
        let Some(recess) = item.model.get("height").and_then(serde_json::Value::as_f64) else {
            continue;
        };
        let box_parts: Vec<&Part> = part_ids
            .iter()
            .filter(|id| *id != front_part_id)
            .filter_map(|id| spec.part(id))
            .collect();
        if box_parts.len() < 3 {
            continue;
        }
        // The bottom is the box part lying flat; everything else stands up around it.
        let (flat, standing): (Vec<&Part>, Vec<&Part>) = box_parts
            .into_iter()
            .partition(|p| local_axes_world(p)[2][1].abs() > 0.999);
        let [bottom] = flat.as_slice() else { continue };
        if standing.is_empty() {
            continue;
        }
        let lowest_side = standing
            .iter()
            .map(|p| aabb(spec, p).min[1])
            .fold(f64::INFINITY, f64::min);
        let clear = aabb(spec, bottom).min[1] - lowest_side;
        if clear < recess - SLIDE_FIT_TOL {
            let label = movable.name().unwrap_or(movable.id());
            issues.push(LintIssue::part(
                Severity::Warn,
                "movable.undermount-recess",
                format!(
                    "Drawer \"{label}\" has {} under its bottom. {} need {} clear between the bottom and the lower edge of the sides: raise the bottom {}.",
                    len(clear.max(0.0)),
                    item.name,
                    len(recess),
                    len(recess - clear.max(0.0))),
                &bottom.id,
            ));
        }
    }
}
