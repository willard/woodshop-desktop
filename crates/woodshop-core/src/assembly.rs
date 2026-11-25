//! The order to put a design together, for the printed plan: build up from the floor, close in
//! the back last, then the drawers and doors, then the hardware. Each step says how the part is
//! fastened to what is already standing, from the recorded joints; a part that only touches its
//! neighbours says so, which is also a gentle hint that a joint is missing.
//!
//! A heuristic, not a planner: it orders by height and by what is connected, which is how a
//! carcase, a table or a bench actually goes together. No geometry beyond bounding boxes.

use std::collections::HashSet;

use serde::Serialize;

use crate::cutlist::hardware::{Source, hardware_where};
use crate::geometry::{Aabb, TOUCH_TOL, local_axes_world, separation, world_aabb};
use crate::spec::{Joint, JointType, Movable, Op, Part, Spec};
use crate::units::{Units, format_length, format_length_value};

/// One step of the assembly: a heading and a line per part (or per piece of hardware), with
/// what to have to hand for it and, where there is one, a check before moving on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssemblyStep {
    pub heading: String,
    pub lines: Vec<String>,
    /// The parts this step puts in place (the assembly video brings them in together). Empty for
    /// the hardware step, which fits items to parts already standing.
    #[serde(rename = "partIds")]
    pub part_ids: Vec<String>,
    /// The cut pieces this step puts in place, alike pieces counted together.
    pub pieces: Vec<StepPiece>,
    /// The hardware this step drives or fits: the screws of the joints it makes, the hinges and
    /// slides of what it hangs, the items the hardware step fits.
    pub hardware: Vec<StepHardware>,
    /// A check to make before the next step, when the step has one worth making.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
}

/// Pieces of one name and size, as the cut list has them.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StepPiece {
    pub name: String,
    /// Length × width × thickness: `30" × 11 1/4" × 3/4"`, `762 × 286 × 19 mm`.
    pub size: String,
    pub qty: u32,
}

/// Hardware for a step, worded as the shopping list words it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StepHardware {
    pub qty: u32,
    pub description: String,
}

impl AssemblyStep {
    fn new(heading: String, lines: Vec<String>, part_ids: Vec<String>) -> Self {
        Self {
            heading,
            lines,
            part_ids,
            pieces: Vec::new(),
            hardware: Vec::new(),
            check: None,
        }
    }

    fn checked(mut self, check: &str) -> Self {
        self.check = Some(check.to_owned());
        self
    }
}

struct Node<'a> {
    part: &'a Part,
    aabb: Aabb,
    index: usize,
}

fn footprint(b: &Aabb) -> f64 {
    (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])
}

/// "Left Side and Right Side", "Shelf 1, Shelf 2 and Shelf 3".
fn and_list(names: &[&str]) -> String {
    match names {
        [] => String::new(),
        [one] => (*one).to_owned(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

/// How many fasteners the op a joint names holds, when it is a row of them.
fn fastener_count(spec: &Spec, joint: &Joint) -> Option<u32> {
    let host = spec.part(&joint.host_part_id)?;
    match host.ops().get(joint.op_ref?)? {
        Op::PocketHoles(p) => Some(p.count),
        Op::Screws(s) => Some(s.count),
        _ => None,
    }
}

fn counted(n: Option<u32>, one: &str, many: &str) -> String {
    match n {
        Some(1) => format!("1 {one}"),
        Some(n) => format!("{n} {many}"),
        None => many.to_owned(),
    }
}

/// How `part` meets `other` (already in place), in shop words, for one kind of joint between
/// them. `n` totals the fasteners over every joint of that kind (two screw rows: one count).
fn describe(kind: JointType, part_is_host: bool, n: Option<u32>, other: &Part) -> String {
    let o = &other.name;
    match kind {
        JointType::Dado | JointType::Rabbet => {
            let cut = if kind == JointType::Dado { "dado" } else { "rabbet" };
            if part_is_host {
                format!("{o} seats in its {cut}")
            } else {
                format!("into the {cut} in {o}")
            }
        }
        JointType::PocketScrew if part_is_host => format!("{} into {o}", counted(n, "pocket screw", "pocket screws")),
        JointType::PocketScrew => format!("{} from {o}", counted(n, "pocket screw", "pocket screws")),
        JointType::Screw if part_is_host => format!("{} through it into {o}", counted(n, "screw", "screws")),
        JointType::Screw => format!("{} through {o}", counted(n, "screw", "screws")),
        JointType::Dowel => format!("dowelled to {o}"),
        JointType::Butt => format!("glued to {o}"),
    }
}

/// Each joint `part_id` takes part in, in the same shop words as the assembly steps, one per
/// joint: "4 pocket screws into Drawer Box Left Side", "Into the dado in Left Side".
pub fn part_joints(spec: &Spec, part_id: &str) -> Vec<String> {
    spec.joints()
        .iter()
        .filter_map(|j| {
            let host = j.host_part_id == part_id;
            if !host && j.insert_part_id != part_id {
                return None;
            }
            let other_id = if host { &j.insert_part_id } else { &j.host_part_id };
            let other = spec.part(other_id)?;
            let phrase = describe(j.kind, host, fastener_count(spec, j), other);
            let mut chars = phrase.chars();
            Some(
                chars
                    .next()
                    .map(|c| c.to_uppercase().chain(chars).collect())
                    .unwrap_or_default(),
            )
        })
        .collect()
}

/// One line for a part going in: how it meets each part already in `placed`.
fn line(spec: &Spec, node: &Node, placed: &[&Node]) -> String {
    let mut ways = Vec::new();
    let mut against = Vec::new();
    for other in placed {
        let joints: Vec<&Joint> = spec
            .joints()
            .iter()
            .filter(|j| {
                (j.host_part_id == node.part.id && j.insert_part_id == other.part.id)
                    || (j.insert_part_id == node.part.id && j.host_part_id == other.part.id)
            })
            .collect();
        if joints.is_empty() {
            if separation(&node.aabb, &other.aabb) <= TOUCH_TOL {
                against.push(other.part.name.as_str());
            }
            continue;
        }
        // One phrase per kind and direction, the fasteners of every row added up.
        let mut kinds: Vec<(JointType, bool, Option<u32>)> = Vec::new();
        for j in joints {
            let host = j.host_part_id == node.part.id;
            let n = fastener_count(spec, j);
            match kinds.iter_mut().find(|(k, h, _)| *k == j.kind && *h == host) {
                Some(entry) => entry.2 = entry.2.zip(n).map(|(a, b)| a + b),
                None => kinds.push((j.kind, host, n)),
            }
        }
        ways.extend(kinds.into_iter().map(|(k, host, n)| describe(k, host, n, other.part)));
    }
    if !against.is_empty() {
        ways.push(format!("against {} (no joint recorded)", and_list(&against)));
    }
    if ways.is_empty() {
        node.part.name.clone()
    } else {
        format!("{}: {}.", node.part.name, ways.join("; "))
    }
}

fn connected(spec: &Spec, a: &Node, b: &Node) -> bool {
    spec.joints().iter().any(|j| {
        (j.host_part_id == a.part.id && j.insert_part_id == b.part.id)
            || (j.insert_part_id == a.part.id && j.host_part_id == b.part.id)
    }) || separation(&a.aabb, &b.aabb) <= TOUCH_TOL
}

/// Same blank, same material: parts that go in together ("Add Shelf 1, Shelf 2 and Shelf 3").
fn twins(a: &Part, b: &Part) -> bool {
    a.material_id == b.material_id && (a.size.l - b.size.l).abs() < 1e-6 && (a.size.w - b.size.w).abs() < 1e-6
}

/// A large panel across the back of the structure: it closes the case in, so it goes on last.
fn is_back(node: &Node, all: &Aabb, structure: usize) -> bool {
    if structure < 3 {
        return false;
    }
    let thickness_dir = local_axes_world(node.part)[2];
    let span = |b: &Aabb, i: usize| b.max[i] - b.min[i];
    thickness_dir[2].abs() > 0.9
        && (node.aabb.min[2] - all.min[2]).abs() < 0.05
        && span(&node.aabb, 0) >= 0.6 * span(all, 0)
        && span(&node.aabb, 1) >= 0.6 * span(all, 1)
}

/// The steps, in order, sized in inches. Empty for a design with no parts.
pub fn assembly_order(spec: &Spec) -> Vec<AssemblyStep> {
    assembly_order_in(spec, Units::Fraction)
}

/// [`assembly_order`], with the pieces' sizes and the hardware worded in `units`.
pub fn assembly_order_in(spec: &Spec, units: Units) -> Vec<AssemblyStep> {
    let mut steps = steps_of(spec);
    gather(spec, units, &mut steps);
    steps
}

/// `30" × 11 1/4" × 3/4"`, or `762 × 286 × 19 mm`.
fn piece_size(l: f64, w: f64, t: f64, units: Units) -> String {
    match units {
        Units::Metric => format!(
            "{} × {} × {} mm",
            format_length_value(l, units),
            format_length_value(w, units),
            format_length_value(t, units)
        ),
        _ => format!(
            "{} × {} × {}",
            format_length(l, units),
            format_length(w, units),
            format_length(t, units)
        ),
    }
}

/// Fills in each step's pieces and hardware. A joint's screws are driven in the step that puts
/// the later of its two parts in place; a fastener op no joint names, in its own part's step; a
/// movable's hinges and slides where it is hung; mounted items in the hardware step.
fn gather(spec: &Spec, units: Units, steps: &mut [AssemblyStep]) {
    let step_of = |id: &str| steps.iter().position(|s| s.part_ids.iter().any(|p| p == id));
    let fitting = steps.iter().rposition(|s| s.part_ids.is_empty());
    let both = |a: &str, b: &str| step_of(a).zip(step_of(b)).map(|(x, y)| x.max(y));
    let joints = spec.joints();
    let place = |source: Source| -> Option<usize> {
        match source {
            Source::Op { part, index } => joints
                .iter()
                .find(|j| j.host_part_id == part && j.op_ref == Some(index))
                .map_or_else(|| step_of(part), |j| both(&j.host_part_id, &j.insert_part_id)),
            Source::Joint(j) => joints.get(j).and_then(|j| both(&j.host_part_id, &j.insert_part_id)),
            Source::Movable(m) => spec.movables().get(m).and_then(|m| step_of(m.anchor_part_id())),
            Source::Mount(i) => fitting.or_else(|| spec.hardware().get(i).and_then(|h| step_of(&h.part_id))),
        }
    };
    let found: Vec<(Vec<StepPiece>, Vec<StepHardware>)> = (0..steps.len())
        .map(|i| {
            let mut pieces: Vec<StepPiece> = Vec::new();
            for part in steps[i].part_ids.iter().filter_map(|id| spec.part(id)) {
                let size = piece_size(part.size.l, part.size.w, spec.thickness_of(part).unwrap_or(0.0), units);
                match pieces.iter_mut().find(|p| p.name == part.name && p.size == size) {
                    Some(p) => p.qty += part.qty(),
                    None => pieces.push(StepPiece {
                        name: part.name.clone(),
                        size,
                        qty: part.qty(),
                    }),
                }
            }
            let hardware = hardware_where(spec, units, &|s| place(s) == Some(i))
                .into_iter()
                .map(|row| StepHardware {
                    qty: row.qty,
                    description: row.description,
                })
                .collect();
            (pieces, hardware)
        })
        .collect();
    for (step, (pieces, hardware)) in steps.iter_mut().zip(found) {
        step.pieces = pieces;
        step.hardware = hardware;
    }
}

/// The steps without what to gather for them.
fn steps_of(spec: &Spec) -> Vec<AssemblyStep> {
    let moving: HashSet<&str> = spec
        .movables()
        .iter()
        .flat_map(|m| m.part_ids().iter().map(String::as_str))
        .collect();
    let nodes: Vec<Node> = spec
        .parts
        .iter()
        .enumerate()
        .map(|(index, part)| Node {
            part,
            aabb: world_aabb(part, spec.thickness_of(part).unwrap_or(0.75)),
            index,
        })
        .collect();
    if let Some(custom) = spec
        .meta
        .as_ref()
        .and_then(|m| m.build_steps.as_deref())
        .filter(|s| !s.is_empty())
    {
        let mut steps = your_steps(spec, &nodes, custom);
        steps.extend(hardware_step(spec));
        return steps;
    }
    let structure: Vec<&Node> = nodes.iter().filter(|n| !moving.contains(n.part.id.as_str())).collect();
    let mut all = Aabb::EMPTY;
    for n in &structure {
        all.union(&n.aabb);
    }
    let (backs, body): (Vec<&Node>, Vec<&Node>) = structure.iter().partition(|n| is_back(n, &all, structure.len()));

    let mut steps = Vec::new();
    let mut placed: Vec<&Node> = Vec::new();
    let mut left: Vec<&Node> = body.clone();
    // Lowest first; on the floor, the biggest footprint; then the most connections to what stands.
    let low = |n: &Node| (n.aabb.min[1] * 100.0).round() as i64;
    while !left.is_empty() {
        let frontier: Vec<&Node> = left
            .iter()
            .copied()
            .filter(|n| placed.iter().any(|p| connected(spec, n, p)))
            .collect();
        let fresh = frontier.is_empty();
        let pool = if fresh { left.clone() } else { frontier };
        let next = *pool
            .iter()
            .min_by(|a, b| {
                low(a).cmp(&low(b)).then_with(|| {
                    if fresh {
                        footprint(&b.aabb).total_cmp(&footprint(&a.aabb))
                    } else {
                        let links = |n: &Node| placed.iter().filter(|p| connected(spec, n, p)).count();
                        links(b).cmp(&links(a))
                    }
                    .then(a.index.cmp(&b.index))
                })
            })
            .expect("pool is not empty");
        // Its twins at the same height that also connect go in with it.
        let mut batch = vec![next];
        for n in &left {
            if n.index != next.index
                && twins(n.part, next.part)
                && low(n) == low(next)
                && (placed.is_empty() || placed.iter().any(|p| connected(spec, n, p)))
            {
                batch.push(n);
            }
        }
        batch.sort_by_key(|n| n.index);
        let names: Vec<&str> = batch.iter().map(|n| n.part.name.as_str()).collect();
        let heading = if placed.is_empty() {
            format!("Start with {}", and_list(&names))
        } else {
            format!("Add {}", and_list(&names))
        };
        let mut lines = Vec::new();
        for n in &batch {
            let l = line(spec, n, &placed);
            if l != n.part.name {
                lines.push(l);
            }
            placed.push(n);
        }
        left.retain(|n| !batch.iter().any(|b| b.index == n.index));
        let part_ids = batch.iter().map(|n| n.part.id.to_string()).collect();
        let mut step = AssemblyStep::new(heading, lines, part_ids);
        // Legs and posts standing on the floor together: alike, so they should match.
        let floor = (all.min[1] * 100.0).round() as i64;
        if batch.len() >= 2 && low(next) == floor && batch.iter().all(|n| local_axes_world(n.part)[0][1].abs() > 0.9) {
            step.check = Some(format!(
                "Stand the {} side by side before you fasten anything to them: they should be one length.",
                batch.len()
            ));
        }
        steps.push(step);
    }

    if !backs.is_empty() {
        let names: Vec<&str> = backs.iter().map(|n| n.part.name.as_str()).collect();
        let mut lines = Vec::new();
        for n in &backs {
            lines.push(line(spec, n, &placed));
            placed.push(n);
        }
        steps.push(
            AssemblyStep::new(
                format!("Close in the back with {}", and_list(&names)),
                lines,
                backs.iter().map(|n| n.part.id.to_string()).collect(),
            )
            .checked("Before you fasten the back, measure across the case's diagonals: when they match, it is square."),
        );
    }

    for movable in spec.movables() {
        let members: Vec<&Node> = movable
            .part_ids()
            .iter()
            .filter_map(|id| nodes.iter().find(|n| &n.part.id == id))
            .collect();
        let name = movable.name().map(str::to_owned);
        match movable {
            Movable::Drawer { .. } => {
                let mut lines = Vec::new();
                let mut built: Vec<&Node> = Vec::new();
                for n in &members {
                    if !built.is_empty() {
                        lines.push(line(spec, n, &built));
                    }
                    built.push(n);
                }
                lines.retain(|l| members.iter().all(|n| *l != n.part.name));
                lines.push("Fit it on its slides.".into());
                steps.push(
                    AssemblyStep::new(
                        format!("Build {}", name.unwrap_or_else(|| "the drawer".into())),
                        lines,
                        members.iter().map(|n| n.part.id.to_string()).collect(),
                    )
                    .checked("Slide it in and out: it should run smoothly, with an even gap round the front."),
                );
            }
            Movable::Leaf { .. } => {
                let mut lines = Vec::new();
                for (i, n) in members.iter().enumerate().skip(1) {
                    lines.push(line(spec, n, &members[..i]));
                }
                lines.push(if movable.hung_on_brackets() {
                    "Screw the folding brackets' legs to the piece with their knuckles just under the top, lock them \
                     out, set the leaf level on their arms, and screw it to the arms from underneath."
                        .into()
                } else {
                    "Hinge it to the piece, raise it level, and screw the folding brackets under it.".into()
                });
                steps.push(
                    AssemblyStep::new(
                        format!("Hang {}", name.unwrap_or_else(|| "the leaf".into())),
                        lines,
                        members.iter().map(|n| n.part.id.to_string()).collect(),
                    )
                    .checked(
                        "Raise it and lock it up: it should sit level with the top, and fold down without catching.",
                    ),
                );
            }
            Movable::Door { .. } => {
                let mut lines = Vec::new();
                for (i, n) in members.iter().enumerate().skip(1) {
                    lines.push(line(spec, n, &members[..i]));
                }
                lines.push("Hang it on its hinges.".into());
                steps.push(
                    AssemblyStep::new(
                        format!("Hang {}", name.unwrap_or_else(|| "the door".into())),
                        lines,
                        members.iter().map(|n| n.part.id.to_string()).collect(),
                    )
                    .checked("Swing it shut: the gap round it should be even, and it should close without rubbing."),
                );
            }
        }
    }

    steps.extend(hardware_step(spec));
    steps
}

/// Hardware last, one line per item on a part.
fn hardware_step(spec: &Spec) -> Option<AssemblyStep> {
    let mut fitted: Vec<(String, String, u32)> = Vec::new();
    for mount in spec.hardware() {
        let item = crate::hardware::find(&mount.item).map_or(mount.item.as_str(), |i| i.name.as_str());
        let part = spec
            .part(&mount.part_id)
            .map_or(mount.part_id.as_str(), |p| p.name.as_str());
        match fitted.iter_mut().find(|(i, p, _)| i == item && p == part) {
            Some(entry) => entry.2 += 1,
            None => fitted.push((item.to_owned(), part.to_owned(), 1)),
        }
    }
    (!fitted.is_empty()).then(|| {
        AssemblyStep::new(
            "Fit the hardware".into(),
            fitted
                .into_iter()
                .map(|(item, part, n)| {
                    if n > 1 {
                        format!("{n} × {item} on {part}.")
                    } else {
                        format!("{item} on {part}.")
                    }
                })
                .collect(),
            Vec::new(),
        )
    })
}

/// Your own steps (`meta.buildSteps`): your heading and note, and for each part how it fastens to
/// what earlier steps put in place, worked out as for the generated order.
fn your_steps(spec: &Spec, nodes: &[Node], custom: &[crate::spec::BuildStep]) -> Vec<AssemblyStep> {
    let mut placed: Vec<&Node> = Vec::new();
    custom
        .iter()
        .map(|step| {
            let mut lines: Vec<String> = step.note.iter().filter(|n| !n.trim().is_empty()).cloned().collect();
            let members: Vec<&Node> = step
                .part_ids
                .iter()
                .filter_map(|id| nodes.iter().find(|n| &n.part.id == id))
                .collect();
            for n in &members {
                if !placed.is_empty() {
                    let l = line(spec, n, &placed);
                    if l != n.part.name {
                        lines.push(l);
                    }
                }
                placed.push(n);
            }
            AssemblyStep::new(
                step.heading.clone(),
                lines,
                members.iter().map(|n| n.part.id.to_string()).collect(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn template(name: &str) -> Spec {
        let raw = std::fs::read_to_string(format!(
            "{}/../../resources/templates/{name}.json",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn a_parts_joints_in_shop_words() {
        let spec = template("nightstand");
        let front = spec.parts.iter().find(|p| p.name == "Drawer Front").unwrap();
        let lines = part_joints(&spec, &front.id);
        assert!(!lines.is_empty());
        for line in &lines {
            assert!(line.contains("pocket screw"), "{line}");
            assert!(!line.contains("pocketScrew"), "{line}");
        }
        assert!(part_joints(&spec, "no_such_part").is_empty());
    }

    fn print(steps: &[AssemblyStep]) -> String {
        steps
            .iter()
            .enumerate()
            .map(|(i, s)| {
                format!(
                    "{}. {}\n{}",
                    i + 1,
                    s.heading,
                    s.lines.iter().map(|l| format!("   {l}\n")).collect::<String>()
                )
            })
            .collect()
    }

    #[test]
    fn a_bookshelf_goes_up_from_the_bottom_and_the_back_goes_on_last() {
        let steps = assembly_order(&template("bookshelf"));
        let headings: Vec<&str> = steps.iter().map(|s| s.heading.as_str()).collect();
        assert_eq!(
            headings,
            [
                "Start with Bottom",
                "Add Left Side and Right Side",
                "Add Shelf 1",
                "Add Shelf 2",
                "Add Shelf 3",
                "Add Top",
                "Close in the back with Back Panel",
            ],
            "{}",
            print(&steps)
        );
        assert_eq!(steps[1].lines[0], "Left Side: 2 pocket screws from Bottom.");
        // Every row of screws into one part counts once: the back's line is short.
        assert_eq!(steps[6].lines.len(), 1);
    }

    #[test]
    fn your_own_steps_replace_the_generated_order() {
        let mut spec = template("bookshelf");
        spec.meta
            .get_or_insert(crate::spec::Meta {
                difficulty: None,
                notes: None,
                tags: None,
                build_steps: None,
                author: None,
            })
            .build_steps = Some(vec![
            crate::spec::BuildStep {
                heading: "Glue up the box".into(),
                part_ids: vec!["p_bottom".into(), "p_side_l".into(), "p_side_r".into(), "p_top".into()],
                note: Some("Check it for square across the diagonals.".into()),
            },
            crate::spec::BuildStep {
                heading: "Fit the shelves and back".into(),
                part_ids: vec![
                    "p_shelf_1".into(),
                    "p_shelf_2".into(),
                    "p_shelf_3".into(),
                    "p_back".into(),
                    "p_gone".into(),
                ],
                note: None,
            },
        ]);
        let steps = assembly_order(&spec);
        let headings: Vec<&str> = steps.iter().map(|s| s.heading.as_str()).collect();
        assert_eq!(headings, ["Glue up the box", "Fit the shelves and back"]);
        assert_eq!(steps[0].lines[0], "Check it for square across the diagonals.");
        // Fastenings are still worked out, against what earlier steps put in place.
        assert_eq!(steps[0].lines[1], "Left Side: 2 pocket screws from Bottom.");
        // A part that no longer exists is dropped.
        assert_eq!(steps[1].part_ids.len(), 4);
    }

    #[test]
    fn the_steps_hardware_adds_up_to_the_hardware_list() {
        let dir = format!("{}/../../resources/templates", env!("CARGO_MANIFEST_DIR"));
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_stem().unwrap().to_str().unwrap().to_owned();
            let spec = template(&name);
            for units in [Units::Fraction, Units::Metric] {
                let steps = assembly_order_in(&spec, units);
                let mut by_step: Vec<(String, u32)> = Vec::new();
                for h in steps.iter().flat_map(|s| &s.hardware) {
                    match by_step.iter_mut().find(|(d, _)| *d == h.description) {
                        Some(e) => e.1 += h.qty,
                        None => by_step.push((h.description.clone(), h.qty)),
                    }
                }
                let mut list: Vec<(String, u32)> = crate::cutlist::hardware::compute_hardware_in(&spec, units)
                    .into_iter()
                    .filter(|r| r.kind != crate::cutlist::types::HardwareKind::EdgeBanding)
                    .map(|r| (r.description, r.qty))
                    .collect();
                by_step.sort();
                list.sort();
                assert_eq!(by_step, list, "{name}");
                // Every copy of every part is gathered once.
                let pieces: u32 = steps.iter().flat_map(|s| &s.pieces).map(|p| p.qty).sum();
                let parts: u32 = spec.parts.iter().map(Part::qty).sum();
                assert_eq!(pieces, parts, "{name}");
            }
        }
    }

    #[test]
    fn a_step_says_what_to_gather_and_what_to_check() {
        let steps = assembly_order(&template("bookshelf"));
        let sides = &steps[1];
        assert_eq!(sides.pieces.len(), 2);
        assert!(sides.pieces[0].size.ends_with(" × 3/4\""), "{:?}", sides.pieces);
        assert!(
            sides.hardware.iter().any(|h| h.description.contains("pocket screws")),
            "{:?}",
            sides.hardware
        );
        let back = steps.last().unwrap();
        assert!(back.check.as_deref().unwrap().contains("diagonals"));
        let metric = assembly_order_in(&template("bookshelf"), Units::Metric);
        assert!(metric[1].pieces[0].size.ends_with(" mm"), "{:?}", metric[1].pieces);
    }

    #[test]
    fn every_template_puts_every_part_in_once() {
        let dir = format!("{}/../../resources/templates", env!("CARGO_MANIFEST_DIR"));
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_stem().unwrap().to_str().unwrap().to_owned();
            let spec = template(&name);
            let steps = assembly_order(&spec);
            let text = print(&steps);
            for part in &spec.parts {
                assert!(text.contains(&part.name), "{name}: {} missing\n{text}", part.name);
                let placed = steps
                    .iter()
                    .filter(|s| s.part_ids.contains(&part.id.to_string()))
                    .count();
                assert_eq!(placed, 1, "{name}: {} is put in place {placed} times", part.name);
            }
        }
    }
}
