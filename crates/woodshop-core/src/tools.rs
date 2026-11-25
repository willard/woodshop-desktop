//! The tools a design needs, read from what it asks of the shop: its materials (sheets to rip,
//! boards to cut to length and to width), its ops and their tool settings (`joinery.rs`), the
//! holes its hardware bores, and its fasteners and banding. Each is required or nice to have,
//! with what it is for. Shown on the template card, beside the shopping list, on the PDF, and in
//! the MCP cut list.

use serde::{Deserialize, Serialize};

use crate::cutlist::{HardwareKind, compute_hardware_in};
use crate::geometry::overall_size;
use crate::movables::derived_borings;
use crate::spec::{Curve, Ease, HolePurpose, MaterialType, Op, Spec};
use crate::units::{Units, format_length};

/// One tool for the build.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// "Drill/driver".
    pub name: String,
    /// False for a tool that makes the work easier but can be done without.
    pub required: bool,
    /// What it is for: "the holes, and driving the screws".
    pub used_for: String,
    /// The bits, blades or sizes it needs: "Bits: 1/4\", 5/16\"".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// The tools, in the order they are listed: roughly the order of the work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Measure,
    SheetSaw,
    CrossSaw,
    MiterSaw,
    TableSaw,
    Bevel,
    DadoCutter,
    Router,
    Jigsaw,
    Drill,
    PocketJig,
    DowelJig,
    ShelfPinJig,
    HingeJig,
    SlideJig,
    Banding,
    Clamps,
    Sander,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Measure => "Tape measure and square",
            Kind::SheetSaw => "Track saw or table saw",
            Kind::CrossSaw => "Circular saw or hand saw",
            Kind::MiterSaw => "Miter saw",
            Kind::TableSaw => "Table saw",
            Kind::Bevel => "Table saw or miter saw that tilts",
            Kind::DadoCutter => "Router or dado stack",
            Kind::Router => "Router",
            Kind::Jigsaw => "Jigsaw or band saw",
            Kind::Drill => "Drill/driver",
            Kind::PocketJig => "Pocket-hole jig",
            Kind::DowelJig => "Doweling jig",
            Kind::ShelfPinJig => "Shelf-pin jig",
            Kind::HingeJig => "Concealed-hinge jig",
            Kind::SlideJig => "Drawer-slide jig",
            Kind::Banding => "Iron and edge-banding trimmer",
            Kind::Clamps => "Clamps",
            Kind::Sander => "Sander or sandpaper",
        }
    }
}

#[derive(Default)]
struct Need {
    required: bool,
    uses: Vec<String>,
    detail: Vec<String>,
}

#[derive(Default)]
struct Needs(std::collections::BTreeMap<Kind, Need>);

impl Needs {
    fn add(&mut self, kind: Kind, required: bool, used_for: &str) -> &mut Need {
        let need = self.0.entry(kind).or_default();
        need.required |= required;
        if !need.uses.iter().any(|u| u == used_for) {
            need.uses.push(used_for.to_owned());
        }
        need
    }
}

impl Need {
    fn with(&mut self, detail: String) -> &mut Self {
        if !self.detail.contains(&detail) {
            self.detail.push(detail);
        }
        self
    }
}

/// "a, b and c".
fn and_list(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// Clamps come in these lengths; a glue-up wants the next one up from its width.
const CLAMP_LENGTHS: [f64; 5] = [12.0, 24.0, 36.0, 48.0, 60.0];

/// The tools a design needs, sizes in `units`: required ones first, in the order of the work.
pub fn tools(spec: &Spec, units: Units) -> Vec<Tool> {
    let len = |n: f64| format_length(n, units);
    let mut needs = Needs::default();
    if spec.parts.is_empty() {
        return Vec::new();
    }
    needs.add(Kind::Measure, true, "measuring and marking out the parts");

    // The stock: sheets ripped into parts, boards cut to length and, when narrower, to width.
    for part in &spec.parts {
        let Some(material) = spec.materials.iter().find(|m| m.id == part.material_id) else {
            continue;
        };
        match material.kind {
            MaterialType::Sheet => {
                needs.add(Kind::SheetSaw, true, "breaking the sheets down into parts");
            }
            MaterialType::Lumber | MaterialType::Round => {
                needs.add(Kind::CrossSaw, true, "cutting the boards to length");
                needs.add(Kind::MiterSaw, false, "square, repeatable crosscuts");
                let narrower = material.stock_width.is_some_and(|w| part.size.w < w - 1.0 / 32.0);
                if material.kind == MaterialType::Lumber && narrower {
                    needs.add(Kind::TableSaw, true, "ripping boards to width");
                }
            }
        }
    }

    // The ops, each at the tool its setup needs.
    let mut holes: Vec<(f64, HolePurpose)> = Vec::new();
    for part in &spec.parts {
        for op in part.ops.as_deref().unwrap_or_default() {
            match op {
                Op::Dado(c) => {
                    needs
                        .add(Kind::DadoCutter, true, "the dados")
                        .with(format!("{} wide", len(c.width)));
                }
                Op::Groove(c) => {
                    needs
                        .add(Kind::DadoCutter, true, "the grooves")
                        .with(format!("{} wide", len(c.width)));
                }
                Op::Rabbet(r) => {
                    needs
                        .add(Kind::DadoCutter, true, "the rabbets")
                        .with(format!("{} wide", len(r.width)));
                }
                Op::Hole(h) => holes.push((h.diameter, h.purpose.unwrap_or(HolePurpose::Other))),
                Op::Cutout(c) => match c.depth {
                    Some(_) => {
                        needs
                            .add(Kind::Router, true, "the recesses")
                            .with("pattern bit".to_owned());
                    }
                    None => {
                        needs.add(Kind::Jigsaw, true, "the cutouts");
                        needs.add(Kind::Drill, true, "starter holes for the cutouts");
                    }
                },
                Op::PocketHoles(_) => {
                    needs.add(Kind::PocketJig, true, "the pocket holes");
                    needs.add(Kind::Drill, true, "driving the screws");
                }
                Op::Screws(_) => {
                    needs.add(Kind::Drill, true, "driving the screws");
                }
                Op::Miter(m) => {
                    needs
                        .add(Kind::Bevel, true, "the mitered edges")
                        .with(format!("{}°", m.angle));
                }
                Op::Curve(Curve::Clip { .. }) => {
                    needs.add(Kind::MiterSaw, false, "the clipped corners, at 45°");
                }
                Op::Curve(_) => {
                    needs.add(Kind::Jigsaw, true, "the curves");
                    needs.add(Kind::Sander, false, "fairing the curves to the line");
                }
                Op::Notch(_) => {
                    needs.add(Kind::Jigsaw, true, "the notches");
                }
                Op::Ease(e) => {
                    let bit = match e {
                        Ease::Roundover { radius, .. } => format!("{} roundover bit", len(*radius)),
                        Ease::Chamfer { width, .. } => format!("{} chamfer bit", len(*width)),
                        Ease::Bullnose { .. } => "bullnose bit".to_owned(),
                    };
                    needs.add(Kind::Router, true, "easing the edges").with(bit);
                }
            }
        }
    }
    // The cups of concealed hinges, bored though no one drew them.
    let borings = derived_borings(spec);
    for b in &borings {
        holes.push((b.hole.diameter, HolePurpose::Hardware));
    }
    if !borings.is_empty() {
        needs.add(Kind::HingeJig, false, "boring the hinge cups square and in line");
    }
    if !holes.is_empty() {
        let drill = needs.add(Kind::Drill, true, "the holes");
        let mut sizes: Vec<f64> = holes.iter().map(|(d, _)| *d).collect();
        sizes.sort_by(f64::total_cmp);
        sizes.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
        let bits: Vec<String> = sizes
            .iter()
            .map(|d| {
                // A hinge cup is bored with a Forstner bit; the rest with twist or brad-point bits.
                if borings.iter().any(|b| (b.hole.diameter - d).abs() < 1e-6) {
                    format!("{} Forstner", len(*d))
                } else {
                    len(*d)
                }
            })
            .collect();
        drill.with(format!("bits {}", bits.join(", ")));
    }
    if holes.iter().any(|(_, p)| *p == HolePurpose::ShelfPin) {
        needs.add(Kind::ShelfPinJig, false, "shelf-pin holes in line");
    }
    if holes.iter().any(|(_, p)| *p == HolePurpose::Dowel) {
        needs.add(Kind::DowelJig, false, "dowel holes that line up");
    }

    // The fasteners and fittings to put it together.
    for row in compute_hardware_in(spec, units) {
        match row.kind {
            HardwareKind::PocketScrew => {
                needs.add(Kind::PocketJig, true, "the pocket holes");
                needs.add(Kind::Drill, true, "driving the screws");
            }
            HardwareKind::WoodScrew => {
                needs.add(Kind::Drill, true, "driving the screws");
            }
            HardwareKind::Dowel => {
                needs.add(Kind::Drill, true, "the dowel holes");
                needs.add(Kind::DowelJig, false, "dowel holes that line up");
            }
            HardwareKind::Hinge | HardwareKind::Knob | HardwareKind::Other => {
                needs.add(Kind::Drill, true, "fitting the hardware");
            }
            HardwareKind::DrawerSlide => {
                needs.add(Kind::Drill, true, "fitting the hardware");
                needs.add(Kind::SlideJig, false, "setting the drawer slides level");
            }
            HardwareKind::EdgeBanding => {
                needs.add(Kind::Banding, true, "the edge banding");
            }
        }
    }

    // Clamps that reach across the widest glue-up: the piece's width or depth.
    if spec.parts.len() > 1 {
        let span = overall_size(spec).map_or(0.0, |o| o.width.max(o.depth));
        let detail = match CLAMP_LENGTHS.iter().find(|&&c| c >= span + 2.0) {
            Some(c) => format!("at least {} long", len(*c)),
            None => format!("long enough to span {}, or two joined", len(span)),
        };
        needs
            .add(Kind::Clamps, true, "holding parts while they are glued and fastened")
            .with(detail);
    }
    needs.add(Kind::Sander, false, "smoothing the parts before the finish");

    let mut out: Vec<(Kind, Need)> = needs.0.into_iter().collect();
    // Required first, keeping the order of the work within each.
    out.sort_by_key(|(kind, need)| (!need.required, *kind));
    out.into_iter()
        .map(|(kind, need)| Tool {
            name: kind.name().to_owned(),
            required: need.required,
            used_for: capitalise(&and_list(&need.uses)),
            detail: (!need.detail.is_empty()).then(|| need.detail.join(", ")),
        })
        .collect()
}

/// The required tools worth naming on a template card: all but the tape measure and clamps
/// every build has.
pub fn card_tools(spec: &Spec) -> Vec<String> {
    tools(spec, Units::Fraction)
        .into_iter()
        .filter(|t| t.required && t.name != Kind::Measure.name() && t.name != Kind::Clamps.name())
        .map(|t| t.name)
        .collect()
}

fn capitalise(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::templates;

    fn named<'a>(tools: &'a [Tool], name: &str) -> Option<&'a Tool> {
        tools.iter().find(|t| t.name == name)
    }

    #[test]
    fn every_template_lists_the_tools_its_ops_need() {
        for summary in templates::all() {
            let spec = templates::find(summary.id).unwrap();
            let tools = tools(&spec, Units::Fraction);
            let id = summary.id;
            let required = |name: &str| {
                let tool = named(&tools, name).unwrap_or_else(|| panic!("{id}: no {name}"));
                assert!(tool.required, "{id}: {name} should be required");
                tool
            };
            required("Tape measure and square");
            let ops: Vec<&Op> = spec
                .parts
                .iter()
                .flat_map(|p| p.ops.as_deref().unwrap_or_default())
                .collect();
            for op in &ops {
                match op {
                    Op::Dado(_) | Op::Groove(_) | Op::Rabbet(_) => {
                        required("Router or dado stack");
                    }
                    Op::Hole(h) => {
                        let drill = required("Drill/driver");
                        let bit = format_length(h.diameter, Units::Fraction);
                        let detail = drill.detail.as_deref().unwrap_or_default();
                        assert!(detail.contains(&bit), "{id}: no {bit} bit in {detail}");
                    }
                    Op::PocketHoles(_) => {
                        required("Pocket-hole jig");
                    }
                    Op::Screws(_) => {
                        required("Drill/driver");
                    }
                    Op::Ease(_) => {
                        required("Router");
                    }
                    Op::Curve(Curve::Clip { .. }) => {
                        assert!(named(&tools, "Miter saw").is_some(), "{id}: no miter saw");
                    }
                    Op::Curve(_) | Op::Notch(_) => {
                        required("Jigsaw or band saw");
                    }
                    Op::Miter(_) => {
                        required("Table saw or miter saw that tilts");
                    }
                    Op::Cutout(_) => {}
                }
            }
            let uses = |kind: MaterialType| {
                spec.parts
                    .iter()
                    .any(|p| spec.materials.iter().any(|m| m.id == p.material_id && m.kind == kind))
            };
            if uses(MaterialType::Sheet) {
                required("Track saw or table saw");
            }
            if uses(MaterialType::Lumber) {
                required("Circular saw or hand saw");
            }
            if spec.parts.len() > 1 {
                required("Clamps");
            }
            // Required tools come before the nice-to-haves.
            let first_optional = tools.iter().position(|t| !t.required).unwrap_or(tools.len());
            assert!(tools[first_optional..].iter().all(|t| !t.required), "{id}: order");
        }
    }

    #[test]
    fn the_record_stand_needs_a_dado_cutter_and_clamps_across_it() {
        let spec = templates::find("record-stand-dado").unwrap();
        let tools = tools(&spec, Units::Fraction);
        let dado = named(&tools, "Router or dado stack").unwrap();
        assert!(dado.used_for.starts_with("The dados"), "{}", dado.used_for);
        assert!(dado.detail.as_deref().unwrap().contains("wide"));
        let clamps = named(&tools, "Clamps").unwrap();
        assert_eq!(clamps.detail.as_deref(), Some("at least 48\" long"));
        assert!(!named(&tools, "Sander or sandpaper").unwrap().required);
    }

    #[test]
    fn nothing_to_build_needs_nothing() {
        let mut spec = templates::find("record-stand-dado").unwrap();
        spec.parts.clear();
        assert!(tools(&spec, Units::Fraction).is_empty());
    }
}
