//! A design's joinery and shaping in shop words: the tool setups it needs (each set once, with
//! every cut made at it) and each part's cuts. Fasteners are left to the assembly order. Printed
//! on the PDF plan, shown under the cut list, and read by agents from `get_cut_list`.

use serde::{Deserialize, Serialize};

use crate::spec::{Ease, Hole, Op, Spec, op_summary};
use crate::units::{Units, format_length};

/// One setting of a tool (a dado stack, bit or blade angle) and every cut made at it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Setup {
    /// "Dado stack 3/4\" wide, 3/8\" deep".
    pub setup: String,
    /// Cuts in all, counting each copy of a part.
    pub cuts: u32,
    /// The parts cut at it: "Left Side ×2 · Right Side".
    pub parts: String,
}

/// The parts that are cut the same way, and the cuts that shape them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PartJoinery {
    /// "Left Side · Right Side", with "×2" on a part cut more than once.
    pub parts: String,
    pub lines: Vec<String>,
}

/// The tool setups, then part by part; both empty when nothing is cut but the blanks.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Joinery {
    pub setups: Vec<Setup>,
    pub parts: Vec<PartJoinery>,
}

impl Joinery {
    pub fn is_empty(&self) -> bool {
        self.setups.is_empty() && self.parts.is_empty()
    }
}

/// The design's joinery, sizes in `units`.
pub fn joinery(spec: &Spec, units: Units) -> Joinery {
    Joinery {
        setups: setups(spec, units),
        parts: parts_joinery(spec, units),
    }
}

/// Holes alike in all but position, at least this many, are summed up in one line.
const MANY_HOLES: usize = 4;

/// Parts by name, with how many of each.
type Names = Vec<(String, u32)>;

/// "Left Side ×2 · Right Side".
fn names_text(names: &Names) -> String {
    names
        .iter()
        .map(|(n, q)| if *q > 1 { format!("{n} ×{q}") } else { n.clone() })
        .collect::<Vec<_>>()
        .join(" · ")
}

/// Each part's dados, grooves, rabbets, holes, miters, notches, curves and eased edges (fasteners
/// are in the assembly order), parts cut exactly alike together.
fn parts_joinery(spec: &Spec, units: Units) -> Vec<PartJoinery> {
    /// A blank by its length, width (as bits, to compare exactly) and material.
    type Blank = (u64, u64, String);
    let mut out: Vec<(Vec<String>, Names, Blank)> = Vec::new();
    for part in &spec.parts {
        let lines = part_joinery(part.ops.as_deref().unwrap_or_default(), units);
        if lines.is_empty() {
            continue;
        }
        let blank = (part.size.l.to_bits(), part.size.w.to_bits(), part.material_id.clone());
        match out.iter_mut().find(|(l, _, b)| *l == lines && *b == blank) {
            Some((_, names, _)) => match names.iter_mut().find(|(n, _)| *n == part.name) {
                Some((_, qty)) => *qty += part.qty(),
                None => names.push((part.name.clone(), part.qty())),
            },
            None => out.push((lines, vec![(part.name.clone(), part.qty())], blank)),
        }
    }
    out.into_iter()
        .map(|(lines, names, _)| PartJoinery {
            parts: names_text(&names),
            lines,
        })
        .collect()
}

/// The tool setting an op is cut at, if it has one: a dado or groove at the dado stack's width
/// and depth, a rabbet, a hole by bit and depth, a miter by blade angle, an eased edge by bit.
/// Curves and notches are cut to a line, and fasteners are left to the assembly order.
fn setup_of(op: &Op, units: Units) -> Option<String> {
    let len = |n: f64| format_length(n, units);
    Some(match op {
        Op::Dado(c) | Op::Groove(c) => format!("Dado stack {} wide, {} deep", len(c.width), len(c.depth)),
        Op::Rabbet(r) => format!("Rabbet {} wide, {} deep", len(r.width), len(r.depth)),
        Op::Hole(h) => match h.depth {
            Some(d) => format!("{} bit, {} deep", len(h.diameter), len(d)),
            None => format!("{} bit, through", len(h.diameter)),
        },
        Op::Miter(m) => format!("Blade or miter gauge at {}°", m.angle),
        Op::Ease(Ease::Roundover { radius, .. }) => format!("{} roundover bit", len(*radius)),
        Op::Ease(Ease::Chamfer { width, .. }) => format!("{} chamfer bit", len(*width)),
        Op::Ease(Ease::Bullnose { .. }) => "Bullnose bit".to_owned(),
        _ => return None,
    })
}

/// Every tool setting the design's joinery needs, in the order first met, each with the cuts
/// made at it: set it once and make them all.
fn setups(spec: &Spec, units: Units) -> Vec<Setup> {
    let mut out: Vec<(String, u32, Names)> = Vec::new();
    for part in &spec.parts {
        for op in part.ops.as_deref().unwrap_or_default() {
            let Some(setup) = setup_of(op, units) else { continue };
            let at = match out.iter().position(|(s, ..)| *s == setup) {
                Some(i) => i,
                None => {
                    out.push((setup, 0, Vec::new()));
                    out.len() - 1
                }
            };
            let (_, cuts, parts) = &mut out[at];
            *cuts += part.qty();
            if !parts.iter().any(|(n, _)| *n == part.name) {
                parts.push((part.name.clone(), part.qty()));
            }
        }
    }
    out.into_iter()
        .map(|(setup, cuts, parts)| Setup {
            setup,
            cuts,
            parts: names_text(&parts),
        })
        .collect()
}

/// One part's lines: every op but fasteners, a run of like holes as one line.
fn part_joinery(ops: &[Op], units: Units) -> Vec<String> {
    let alike = |a: &Hole, b: &Hole| {
        a.face == b.face && a.diameter == b.diameter && a.depth == b.depth && a.purpose == b.purpose
    };
    let holes: Vec<&Hole> = ops
        .iter()
        .filter_map(|op| match op {
            Op::Hole(h) => Some(h),
            _ => None,
        })
        .collect();
    let mut summed: Vec<&Hole> = Vec::new();
    let mut lines = Vec::new();
    for op in ops {
        match op {
            Op::PocketHoles(_) | Op::Screws(_) => {}
            Op::Hole(h) => {
                let count = holes.iter().filter(|o| alike(o, h)).count();
                if count < MANY_HOLES {
                    lines.push(op_summary(op, units));
                } else if !summed.iter().any(|o| alike(o, h)) {
                    summed.push(h);
                    // "Shelf-pin hole ⌀ 1/4", 1/2" deep, in the front face, …" → "32 shelf-pin holes …".
                    let one = op_summary(op, units);
                    let (name, rest) = one.split_once(" ⌀ ").unwrap_or((&one, ""));
                    let rest = rest.rsplitn(3, ", ").last().unwrap_or(rest);
                    lines.push(format!(
                        "{count} {}s ⌀ {rest}: positions on the shop template",
                        name.to_lowercase()
                    ));
                }
            }
            _ => lines.push(op_summary(op, units)),
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{self, Face, HolePurpose};

    fn record_stand() -> Spec {
        let raw = include_str!("../../../resources/templates/record-stand-dado.json");
        spec::parse(serde_json::from_str(raw).unwrap()).unwrap()
    }

    #[test]
    fn joinery_is_listed_part_by_part_in_shop_words() {
        let spec = record_stand();
        let joinery = parts_joinery(&spec, Units::Fraction);
        assert!(!joinery.is_empty());
        // Fasteners are left to the assembly order.
        let lines: Vec<&String> = joinery.iter().flat_map(|j| &j.lines).collect();
        assert!(lines.iter().all(|l| !l.contains("screw")), "{lines:?}");
        // Every part named once.
        let names: Vec<&str> = joinery.iter().flat_map(|j| j.parts.split(" · ")).collect();
        let mut unique = names.clone();
        unique.dedup();
        assert_eq!(names.len(), unique.len());
        assert!(lines.iter().any(|l| l.starts_with("Dado 3/4\" wide")), "{lines:?}");
    }

    #[test]
    fn each_tool_setting_is_listed_once_with_every_cut_made_at_it() {
        let spec = record_stand();
        let setups = setups(&spec, Units::Fraction);
        let dados: u32 = spec
            .parts
            .iter()
            .flat_map(|p| p.ops.iter().flatten().map(move |o| (p, o)))
            .filter(|(_, o)| matches!(o, Op::Dado(_) | Op::Groove(_)))
            .map(|(p, _)| p.qty())
            .sum();
        let stack: u32 = setups
            .iter()
            .filter(|s| s.setup.starts_with("Dado stack"))
            .map(|s| s.cuts)
            .sum();
        assert_eq!(stack, dados);
        assert!(
            setups.iter().any(|s| s.setup == "Dado stack 3/4\" wide, 3/8\" deep"),
            "{setups:?}"
        );
        // Settings are not repeated, and screws need none.
        let mut names: Vec<&str> = setups.iter().map(|s| s.setup.as_str()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), setups.len());
    }

    #[test]
    fn a_run_of_like_holes_is_one_line() {
        let hole = |y: f64| {
            Op::Hole(Hole {
                face: Face::Front,
                x: 1.5,
                y,
                diameter: 0.25,
                depth: Some(0.375),
                purpose: Some(HolePurpose::ShelfPin),
            })
        };
        let mut ops: Vec<Op> = (0..8).map(|i| hole(4.0 + i as f64 * 2.0)).collect();
        ops.push(Op::Hole(Hole {
            face: Face::Back,
            x: 3.0,
            y: 3.0,
            diameter: 0.375,
            depth: None,
            purpose: None,
        }));
        assert_eq!(
            part_joinery(&ops, Units::Fraction),
            [
                "8 shelf-pin holes ⌀ 1/4\", 3/8\" deep, in the front face: positions on the shop template",
                "Hole ⌀ 3/8\", through, in the back face, 3\" from the left end, 3\" up",
            ]
        );
    }

    #[test]
    fn a_design_with_only_screws_has_no_joinery() {
        let raw = include_str!("../../../resources/templates/bookshelf.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        assert!(joinery(&spec, Units::Fraction).is_empty());
    }
}
