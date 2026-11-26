//! What a build takes, for someone choosing a design: a rough number of hours in the shop, the
//! kinds of cut and joint it asks for, and how many tools. Shown on the template card and the
//! plan's first page, and used to filter the templates ("no router", "an afternoon").
//!
//! The hours are a sum over the work, at the minutes in [`MINUTES`]: cutting each part, each op
//! that shapes it, each fastener and fitting, each assembly step (a glue-up: glue, clamp, check
//! square) and sanding. Not the finish, which is mostly waiting for it to dry. A rough guide for
//! someone with the tools set up, not a promise; the table is the one place to tune it.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::assembly::assembly_order;
use crate::cutlist::{HardwareKind, compute_hardware_in};
use crate::spec::{Curve, JointType, MaterialType, Op, Spec};
use crate::tools::tools;
use crate::units::Units;

/// What a build takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effort {
    /// Hours in the shop, to the half hour; zero for nothing to build.
    pub hours: f64,
    /// The kinds of cut, simplest first: "straight cuts", "dados", "curves".
    pub cuts: Vec<String>,
    /// The kinds of joint: "screwed joints", "pocket holes".
    pub joints: Vec<String>,
    /// The tools it needs, the nice-to-haves left out.
    pub tool_count: usize,
    /// Whether a required tool is a router (or a router or dado stack).
    pub needs_router: bool,
}

impl Effort {
    /// "About 9 hours · straight cuts, dados · screwed joints, pocket holes · 7 tools", for a
    /// plan's first page; empty for nothing to build.
    pub fn line(&self) -> String {
        if self.hours == 0.0 {
            return String::new();
        }
        let hours = if self.hours == 1.0 {
            "1 hour".to_owned()
        } else {
            format!("{} hours", fmt_hours(self.hours))
        };
        let mut out = vec![format!("About {hours} in the shop")];
        out.push(self.cuts.join(", "));
        if !self.joints.is_empty() {
            out.push(self.joints.join(", "));
        }
        out.push(if self.tool_count == 1 {
            "1 tool".to_owned()
        } else {
            format!("{} tools", self.tool_count)
        });
        out.join(" · ")
    }
}

/// `9`, `2.5`.
fn fmt_hours(h: f64) -> String {
    if h.fract() == 0.0 {
        format!("{h:.0}")
    } else {
        format!("{h:.1}")
    }
}

/// Minutes for each piece of work: the table the hours are summed from.
pub struct Minutes {
    /// Marking out and cutting a part from a sheet or a board.
    pub cut_part: f64,
    /// Ripping a board narrower than it is sold.
    pub rip: f64,
    /// A dado, groove or rabbet, the setup shared out.
    pub channel: f64,
    /// A hole that is not a fastener's.
    pub hole: f64,
    /// A pocket hole, drilled.
    pub pocket_hole: f64,
    /// A curve or a cutout, cut and faired.
    pub curve: f64,
    /// A notch, a mitered edge or a clipped corner.
    pub notch: f64,
    /// An eased edge, routed.
    pub ease: f64,
    /// A screw driven (a pocket screw or a wood screw).
    pub screw: f64,
    /// A dowel: drilled both sides, glued and tapped home.
    pub dowel: f64,
    /// A hinge fitted.
    pub hinge: f64,
    /// A drawer slide fitted (one side).
    pub slide: f64,
    /// A knob, pull or other fitting.
    pub fitting: f64,
    /// A foot of edge banding, ironed on and trimmed.
    pub banding_foot: f64,
    /// An assembly step: glue, clamp, check square, wait.
    pub step: f64,
    /// Sanding a part before the finish.
    pub sand_part: f64,
}

/// The minutes the hours are summed from.
pub const MINUTES: Minutes = Minutes {
    cut_part: 8.0,
    rip: 4.0,
    channel: 10.0,
    hole: 1.5,
    pocket_hole: 1.0,
    curve: 20.0,
    notch: 8.0,
    ease: 4.0,
    screw: 1.0,
    dowel: 3.0,
    hinge: 12.0,
    slide: 15.0,
    fitting: 4.0,
    banding_foot: 1.0,
    step: 20.0,
    sand_part: 5.0,
};

/// The minutes of work in a design, before rounding.
pub fn minutes(spec: &Spec) -> f64 {
    let m = &MINUTES;
    let mut total = 0.0;
    for part in &spec.parts {
        total += m.cut_part + m.sand_part;
        let material = spec.materials.iter().find(|x| x.id == part.material_id);
        if let Some(material) = material
            && material.kind == MaterialType::Lumber
            && material.stock_width.is_some_and(|w| part.size.w < w - 1.0 / 32.0)
        {
            total += m.rip;
        }
        for op in part.ops.as_deref().unwrap_or_default() {
            total += match op {
                Op::Dado(_) | Op::Groove(_) | Op::Rabbet(_) => m.channel,
                Op::Hole(_) => m.hole,
                Op::PocketHoles(p) => m.pocket_hole * f64::from(p.count),
                // The screws are counted with the hardware below.
                Op::Screws(_) => 0.0,
                Op::Cutout(_) => m.curve,
                Op::Curve(Curve::Clip { .. }) | Op::Notch(_) | Op::Miter(_) => m.notch,
                Op::Curve(_) => m.curve,
                Op::Ease(_) => m.ease,
            };
        }
    }
    for row in compute_hardware_in(spec, Units::Fraction) {
        let each = match row.kind {
            HardwareKind::PocketScrew | HardwareKind::WoodScrew => m.screw,
            HardwareKind::Dowel => m.dowel,
            HardwareKind::Hinge => m.hinge,
            HardwareKind::DrawerSlide => m.slide,
            HardwareKind::Knob | HardwareKind::Other => m.fitting,
            HardwareKind::EdgeBanding => m.banding_foot,
        };
        total += each * f64::from(row.qty);
    }
    // Each step that puts parts in place; the hardware step's fittings are counted above.
    let steps = assembly_order(spec).iter().filter(|s| !s.part_ids.is_empty()).count();
    total += m.step * steps as f64;
    total
}

/// What a design takes to build.
pub fn effort(spec: &Spec) -> Effort {
    let mut cuts = BTreeSet::new();
    let mut joints = BTreeSet::new();
    for part in &spec.parts {
        for op in part.ops.as_deref().unwrap_or_default() {
            let kind = match op {
                Op::Dado(_) => Some(Cut::Dados),
                Op::Groove(_) => Some(Cut::Grooves),
                Op::Rabbet(_) => Some(Cut::Rabbets),
                Op::Miter(_) => Some(Cut::Miters),
                Op::Curve(Curve::Clip { .. }) => Some(Cut::Angles),
                Op::Curve(_) | Op::Cutout(_) => Some(Cut::Curves),
                Op::Notch(_) => Some(Cut::Notches),
                Op::Ease(_) => Some(Cut::Eased),
                Op::Hole(_) | Op::PocketHoles(_) | Op::Screws(_) => None,
            };
            cuts.extend(kind);
            match op {
                Op::PocketHoles(_) => {
                    joints.insert(Joinery::Pocket);
                }
                Op::Screws(_) => {
                    joints.insert(Joinery::Screwed);
                }
                _ => {}
            }
        }
    }
    for joint in spec.joints.as_deref().unwrap_or_default() {
        joints.insert(match joint.kind {
            JointType::Dado => Joinery::Dado,
            JointType::Rabbet => Joinery::Rabbet,
            JointType::Butt => Joinery::Butt,
            JointType::PocketScrew => Joinery::Pocket,
            JointType::Screw => Joinery::Screwed,
            JointType::Dowel => Joinery::Dowel,
        });
    }
    // A butt joint held by screws is a screwed joint: name it once.
    if joints.contains(&Joinery::Screwed) || joints.contains(&Joinery::Pocket) {
        joints.remove(&Joinery::Butt);
    }
    // Every design has its straight cuts: named first.
    let mut cut_words: Vec<String> = Vec::new();
    if !spec.parts.is_empty() {
        cut_words.push("straight cuts".to_owned());
    }
    cut_words.extend(cuts.iter().map(|c| c.word().to_owned()));

    let required: Vec<_> = tools(spec, Units::Fraction)
        .into_iter()
        .filter(|t| t.required)
        .collect();
    Effort {
        hours: round_half_hour(minutes(spec) / 60.0),
        cuts: cut_words,
        joints: joints.iter().map(|j| j.word().to_owned()).collect(),
        tool_count: required.len(),
        needs_router: required.iter().any(|t| t.name.contains("Router")),
    }
}

fn round_half_hour(hours: f64) -> f64 {
    if hours <= 0.0 {
        0.0
    } else {
        ((hours * 2.0).round() / 2.0).max(0.5)
    }
}

/// The kinds of cut beyond straight ones, in the order they are named: simplest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Cut {
    Angles,
    Miters,
    Notches,
    Rabbets,
    Dados,
    Grooves,
    Curves,
    Eased,
}

impl Cut {
    fn word(self) -> &'static str {
        match self {
            Cut::Angles => "angled corners",
            Cut::Miters => "miters",
            Cut::Notches => "notches",
            Cut::Rabbets => "rabbets",
            Cut::Dados => "dados",
            Cut::Grooves => "grooves",
            Cut::Curves => "curves",
            Cut::Eased => "routed edges",
        }
    }
}

/// The kinds of joint, simplest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Joinery {
    Butt,
    Screwed,
    Pocket,
    Dowel,
    Rabbet,
    Dado,
}

impl Joinery {
    fn word(self) -> &'static str {
        match self {
            Joinery::Butt => "glued butt joints",
            Joinery::Screwed => "screwed joints",
            Joinery::Pocket => "pocket holes",
            Joinery::Dowel => "dowels",
            Joinery::Rabbet => "rabbet joints",
            Joinery::Dado => "dado joints",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::templates;

    #[test]
    fn the_hours_are_the_sum_of_the_work() {
        // One plain part, no ops, no joints, no hardware: cut it, sand it, and the one step
        // that stands it up.
        let mut spec = templates::find("record-stand-dado").unwrap();
        spec.parts.truncate(1);
        spec.parts[0].ops = None;
        spec.joints = None;
        spec.movables = None;
        spec.hardware = None;
        let m = &MINUTES;
        let rip = if minutes(&spec) > m.cut_part + m.sand_part + m.step {
            m.rip
        } else {
            0.0
        };
        assert_eq!(minutes(&spec), m.cut_part + m.sand_part + m.step + rip);

        // A dado adds its minutes.
        let before = minutes(&spec);
        let dado = templates::find("record-stand-dado")
            .unwrap()
            .parts
            .iter()
            .flat_map(|p| p.ops.clone().unwrap_or_default())
            .find(|o| matches!(o, Op::Dado(_)))
            .unwrap();
        spec.parts[0].ops = Some(vec![dado]);
        assert_eq!(minutes(&spec), before + m.channel);
        assert_eq!(round_half_hour(0.1), 0.5);
        assert_eq!(round_half_hour(2.74), 2.5);
        assert_eq!(round_half_hour(2.76), 3.0);
    }

    #[test]
    fn every_template_takes_a_sensible_time() {
        for summary in templates::all() {
            let spec = templates::find(summary.id).unwrap();
            let e = effort(&spec);
            assert!((0.5..=60.0).contains(&e.hours), "{}: {} hours", summary.id, e.hours);
            assert_eq!(
                e.cuts.first().map(String::as_str),
                Some("straight cuts"),
                "{}",
                summary.id
            );
            assert!(!e.joints.is_empty(), "{}: no joints named", summary.id);
            assert!(e.tool_count >= 2, "{}: {} tools", summary.id, e.tool_count);
        }
    }

    #[test]
    fn the_nightstand_and_the_workbench_take_about_a_weekend() {
        let hours = |id: &str| effort(&templates::find(id).unwrap()).hours;
        let nightstand = hours("nightstand");
        let workbench = hours("workbench");
        assert!((5.0..=16.0).contains(&nightstand), "nightstand {nightstand} hours");
        assert!((4.0..=14.0).contains(&workbench), "workbench {workbench} hours");
        // The record stand is a small job beside the nightstand.
        assert!(hours("record-stand") < nightstand);
    }

    #[test]
    fn the_record_stand_is_dadoed() {
        let e = effort(&templates::find("record-stand-dado").unwrap());
        assert!(e.cuts.contains(&"dados".to_owned()), "{:?}", e.cuts);
        assert!(e.joints.contains(&"dado joints".to_owned()), "{:?}", e.joints);
        assert!(e.needs_router);
    }

    #[test]
    fn the_plan_line_says_it_all() {
        let e = Effort {
            hours: 2.5,
            cuts: vec!["straight cuts".into(), "dados".into()],
            joints: vec!["dado joints".into()],
            tool_count: 6,
            needs_router: true,
        };
        assert_eq!(
            e.line(),
            "About 2.5 hours in the shop · straight cuts, dados · dado joints · 6 tools"
        );
    }

    #[test]
    fn nothing_to_build_takes_no_time() {
        let mut spec = templates::find("record-stand-dado").unwrap();
        spec.parts.clear();
        spec.joints = None;
        spec.movables = None;
        spec.hardware = None;
        let e = effort(&spec);
        assert_eq!(e.hours, 0.0);
        assert!(e.cuts.is_empty() && e.joints.is_empty());
        assert_eq!(e.tool_count, 0);
        assert_eq!(e.line(), "");
    }
}
