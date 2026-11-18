//! The printable plan: summary, shop notes, the grouped cut list, hardware, sheet layouts and
//! stick cuts, typeset by an embedded Typst. Everything is computed here with the same core the
//! editor uses, so the paper matches the screen.

use std::sync::LazyLock;

use serde::Serialize;
use std::collections::BTreeMap;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Dict, IntoValue};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use woodshop_core::assembly::{AssemblyStep, assembly_order};
use woodshop_core::cutlist::grouping::{SectionKind, StockUnit};

use woodshop_core::cutlist::{
    CutList, CutListConfig, CutListSection, LumberPlan, Offcut, PartRow, SawCut, compute_cut_list, group_cut_list,
};
use woodshop_core::geometry::overall_size;
use woodshop_core::movables::derived_borings;
use woodshop_core::spec::{Ease, Edge, Hole, MaterialType, Movable, Op, Spec, op_summary};
use woodshop_core::units::{Units, format_length, format_length_value};

use crate::ExportError;

const TEMPLATE: &str = include_str!("../templates/plan.typ");

/// A shop note printed on the plan.
#[derive(Debug, Clone, Serialize)]
pub struct PlanNote {
    pub body: String,
    pub pinned: bool,
}

pub struct PlanInput<'a> {
    pub title: &'a str,
    pub spec: &'a Spec,
    pub kerf: f64,
    /// Already formatted for the reader's locale (the webview knows it; Rust does not).
    pub date: &'a str,
    pub notes: Vec<PlanNote>,
    /// PNG snapshot of the model for the title block.
    pub thumbnail: Option<Vec<u8>>,
    /// How sizes are printed: fractions, decimal inches or millimetres (the reader's setting).
    pub units: Units,
    /// The reader's hardware prices, by hardware row key (see `CutListConfig::hardware_prices`).
    pub hardware_prices: BTreeMap<String, f64>,
    /// Stock the reader already has, used before anything is bought.
    pub offcuts: Vec<Offcut>,
    /// Trimmed off each edge of a bought sheet first (see `CutListConfig::sheet_trim`).
    pub sheet_trim: f64,
    /// Trimmed off each end of a bought board first (see `CutListConfig::board_trim`).
    pub board_trim: f64,
}

// --- The view model the template lays out --------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanView {
    title: String,
    date: String,
    overall: Option<String>,
    part_count: usize,
    has_thumbnail: bool,
    totals: Vec<Total>,
    notes: Vec<PlanNote>,
    sections: Vec<SectionView>,
    hardware: Vec<HardwareView>,
    /// Some hardware has a price: the table gets a cost column.
    hardware_priced: bool,
    /// Holes the hardware needs that are on no part's op list: hinge cups.
    drilling: Vec<String>,
    /// Each part's joinery and shaping, in shop words.
    joinery: Vec<JoineryView>,
    /// Each tool setting the joinery needs, with every cut made at it.
    setups: Vec<SetupView>,
    sheets: Vec<SheetView>,
    lumber: Vec<LumberView>,
    /// The order to put it together: up from the floor, the back, then drawers, doors, hardware.
    assembly: Vec<AssemblyStep>,
}

#[derive(Serialize)]
struct Total {
    label: &'static str,
    value: String,
}

#[derive(Serialize)]
struct SectionView {
    title: String,
    summary: String,
    rows: Vec<RowView>,
}

#[derive(Serialize)]
struct RowView {
    qty: u32,
    label: String,
    dims: String,
    notes: String,
    members: String,
}

/// One setting of a tool (a dado stack, bit or blade angle) and every cut made at it.
#[derive(Debug, Serialize)]
struct SetupView {
    /// "Dado stack 3/4\" wide, 3/8\" deep".
    setup: String,
    /// Cuts in all, counting each copy of a part.
    cuts: u32,
    /// The parts cut at it: "Left Side ×2 · Right Side".
    parts: String,
}

/// The parts that are cut the same way, and the cuts that shape them.
#[derive(Debug, Serialize)]
struct JoineryView {
    /// "Left Side · Right Side", with "×2" on a part cut more than once.
    parts: String,
    lines: Vec<String>,
}

#[derive(Serialize)]
struct HardwareView {
    qty: u32,
    description: String,
    cost: String,
}

#[derive(Serialize)]
struct SheetView {
    title: String,
    /// Each sheet to lay out: the bought ones, then the user's offcuts.
    boards: Vec<BoardView>,
    placements: Vec<PlacementView>,
    /// The saw cuts, numbered in the order to make them on each sheet.
    cuts: Vec<SawCut>,
}

#[derive(Serialize)]
struct BoardView {
    sheet: usize,
    l: f64,
    w: f64,
    /// Empty for a bought sheet; "On hand, 24\" × 18\"" for a piece the reader has.
    caption: String,
    /// The saw cuts in order with the fence setting for each: "1 Rip 20\" · 2 Crosscut 30\"".
    steps: String,
    /// What is trimmed off each edge first; 0 for a piece the reader has.
    trim: f64,
}

#[derive(Serialize)]
struct PlacementView {
    sheet: usize,
    name: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize)]
struct LumberView {
    title: String,
    /// Each board to draw: the bought ones, then the user's pieces.
    boards: Vec<StickView>,
    cuts: Vec<CutView>,
}

/// One board drawn as a bar: along it to scale, across it in lanes when parts are ripped.
#[derive(Serialize)]
struct StickView {
    /// Empty for a bought board; "On hand, 30\"" for a piece the reader has.
    caption: String,
    l: f64,
    /// The board width the lanes are measured against.
    across: f64,
    ripped: bool,
    cuts: Vec<PlacementView>,
    /// The saw cuts to draw: every crosscut, and the rips where the lanes are drawn to scale.
    saws: Vec<SawCut>,
    /// Every cut in order with its fence or stop setting: "1 Crosscut 30\" · 2 Rip 1 1/2\"".
    steps: String,
    /// What is trimmed off each end first; 0 for a piece the reader has.
    trim: f64,
}

#[derive(Serialize)]
struct CutView {
    name: String,
    /// "2", or "On hand 1" for a piece the reader has.
    stick: String,
    length: String,
}

/// " + 2 pieces on hand" when any of the reader's own stock is used.
fn offcut_note(n: usize) -> String {
    match n {
        0 => String::new(),
        1 => " + 1 piece on hand".into(),
        n => format!(" + {n} pieces on hand"),
    }
}

/// Three sizes as one, the unit said once in metric: `24" × 16" × 3/4"`, `610 × 406 × 19 mm`.
pub(crate) fn dims3(a: f64, b: f64, c: f64, units: Units) -> String {
    match units {
        Units::Metric => format!(
            "{} × {} × {} mm",
            format_length_value(a, units),
            format_length_value(b, units),
            format_length_value(c, units)
        ),
        _ => format!(
            "{} × {} × {}",
            format_length(a, units),
            format_length(b, units),
            format_length(c, units)
        ),
    }
}

fn money(n: Option<f64>) -> String {
    n.map_or_else(|| "—".into(), |v| format!("${v:.2}"))
}

fn pct(n: f64) -> String {
    format!("{}%", (n * 100.0).round() as i64)
}

fn plural(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

/// What one length of stock is called: a board of lumber, a stick of dowel.
fn board_word(spec: &Spec, material_id: &str) -> &'static str {
    let round = spec
        .materials
        .iter()
        .any(|m| m.id == material_id && m.kind == MaterialType::Round);
    if round { "stick" } else { "board" }
}

fn section_view(section: &CutListSection, spec: &Spec, units: Units) -> SectionView {
    let kind = match section.kind {
        SectionKind::Sheet => "Sheet goods",
        SectionKind::Lumber => "Lumber",
        SectionKind::Other => "Other stock",
    };
    let mut summary = Vec::new();
    if let Some(stock) = &section.stock {
        let unit = match stock.unit {
            StockUnit::Sheet => "sheet",
            StockUnit::Stick => board_word(spec, &section.material_id),
        };
        let size = match stock.w {
            Some(w) => woodshop_core::units::format_size(stock.l, w, units),
            None if !stock.lengths.is_empty() => {
                let mix: Vec<(f64, usize)> = stock.lengths.iter().map(|c| (c.l, c.count)).collect();
                lengths_text(&mix, units)
            }
            None => format_length(stock.l, units),
        };
        summary.push(format!("Buy {} · {size}", plural(stock.count, unit)));
    }
    summary.push(format!("{:.1} bd ft", section.board_feet));
    if section.cost.is_some() {
        summary.push(money(section.cost));
    }
    SectionView {
        title: format!("{} — {kind}", section.material_name),
        summary: summary.join(" · "),
        rows: section
            .groups
            .iter()
            .map(|g| {
                let mut notes: Vec<&str> = [
                    (g.curved, "curved"),
                    (g.notched, "notched"),
                    (g.mitered, "mitered"),
                    (g.eased, "eased"),
                ]
                .into_iter()
                .filter_map(|(on, n)| on.then_some(n))
                .collect();
                if g.mixed_ops {
                    notes.push("(varies)");
                }
                // The printout goes to the shop, so the individual part names stay on the page.
                let members = if g.members.len() > 1 {
                    g.members
                        .iter()
                        .map(|m| {
                            if m.qty > 1 {
                                format!("{} ×{}", m.name, m.qty)
                            } else {
                                m.name.clone()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" · ")
                } else {
                    String::new()
                };
                RowView {
                    qty: g.qty,
                    label: g.label.clone(),
                    dims: dims3(g.length, g.width, g.thickness, units),
                    notes: notes.join(", "),
                    members,
                }
            })
            .collect(),
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
fn joinery(spec: &Spec, units: Units) -> Vec<JoineryView> {
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
        .map(|(lines, names, _)| JoineryView {
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
fn setups(spec: &Spec, units: Units) -> Vec<SetupView> {
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
        .map(|(setup, cuts, parts)| SetupView {
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

/// One line per door hung on concealed hinges: how many cups, what size, and where.
fn drilling_notes(spec: &Spec, units: Units) -> Vec<String> {
    let borings = derived_borings(spec);
    let mut notes = Vec::new();
    for movable in spec.movables() {
        let Movable::Door {
            id,
            hinge_edge,
            panel_part_id,
            ..
        } = movable
        else {
            continue;
        };
        let cups: Vec<_> = borings.iter().filter(|b| &b.movable_id == id).collect();
        let (Some(first), Some(panel)) = (cups.first(), spec.part(panel_part_id)) else {
            continue;
        };
        // Along the hinge edge, and in from it.
        let along_x = hinge_edge.is_l_edge();
        let positions: Vec<String> = cups
            .iter()
            .map(|b| format_length(if along_x { b.hole.x } else { b.hole.y }, units))
            .collect();
        let inset = match hinge_edge {
            Edge::L0 => first.hole.y,
            Edge::L1 => panel.size.w - first.hole.y,
            Edge::W0 => first.hole.x,
            Edge::W1 => panel.size.l - first.hole.x,
        };
        // A cup is a metric fitting whatever the plan is drawn in; say so once when it is not.
        let mm = |inches: f64| format!("{} mm", (inches * 254.0).round() / 10.0);
        let size = |inches: f64| match units {
            // To the half millimetre: the 22.5 mm boring distance must not round to 23.
            Units::Metric => mm(inches),
            _ => format!("{} ({})", format_length(inches, units), mm(inches)),
        };
        let hinge = woodshop_core::hardware::find(&first.item).map_or("concealed hinge", |i| i.name.as_str());
        notes.push(format!(
            "{}: bore {} cup{} {} across and {} deep in the back face, centred {} in from the hinge edge, at {} along it ({}).",
            panel.name,
            cups.len(),
            if cups.len() == 1 { "" } else { "s" },
            size(first.hole.diameter),
            size(first.hole.depth.unwrap_or(0.0)),
            size(inset),
            positions.join(", "),
            hinge.to_lowercase(),
        ));
    }
    notes
}

fn plan_view(input: &PlanInput<'_>, cut_list: &CutList) -> PlanView {
    let units = input.units;
    let overall = overall_size(input.spec).map(|o| dims3(o.width, o.depth, o.height, units));
    let mut notes = input.notes.clone();
    notes.sort_by_key(|n| !n.pinned);
    PlanView {
        title: input.title.to_owned(),
        date: input.date.to_owned(),
        overall,
        part_count: input.spec.parts.len(),
        has_thumbnail: input.thumbnail.is_some(),
        totals: vec![
            Total {
                label: "Board feet",
                value: format!("{:.1}", cut_list.totals.board_feet),
            },
            Total {
                label: "Sheets",
                value: cut_list.totals.sheet_count.to_string(),
            },
            Total {
                label: "Est. cost",
                value: money(cut_list.totals.estimated_cost),
            },
            Total {
                label: "Waste",
                value: pct(cut_list.totals.waste_percent),
            },
        ],
        notes,
        sections: group_cut_list(cut_list)
            .iter()
            .map(|sec| section_view(sec, input.spec, units))
            .collect(),
        hardware: cut_list
            .hardware
            .iter()
            .map(|h| HardwareView {
                qty: h.qty,
                description: h.description.clone(),
                cost: h.cost.map_or_else(String::new, |c| money(Some(c))),
            })
            .collect(),
        hardware_priced: cut_list.hardware.iter().any(|h| h.cost.is_some()),
        drilling: drilling_notes(input.spec, units),
        joinery: joinery(input.spec, units),
        setups: setups(input.spec, units),
        assembly: assembly_order(input.spec),
        sheets: cut_list
            .sheets
            .iter()
            .map(|p| SheetView {
                title: format!(
                    "{} — {}{}, {} waste",
                    p.material_name,
                    plural(p.sheet_count, "sheet"),
                    offcut_note(p.offcuts.len()),
                    pct(p.waste)
                ),
                boards: (0..p.sheet_count)
                    .map(|n| BoardView {
                        sheet: n,
                        l: p.sheet_size.l,
                        w: p.sheet_size.w,
                        caption: String::new(),
                        steps: trim_step(p.trim, "edge", units) + &cut_steps(&p.cuts, n, units),
                        trim: p.trim,
                    })
                    .chain(p.offcuts.iter().enumerate().map(|(i, o)| {
                        let w = o.w.unwrap_or(0.0);
                        BoardView {
                            sheet: p.sheet_count + i,
                            l: o.l,
                            w,
                            caption: format!("On hand, {} × {}", format_length(o.l, units), format_length(w, units)),
                            steps: cut_steps(&p.cuts, p.sheet_count + i, units),
                            trim: 0.0,
                        }
                    }))
                    .collect(),
                placements: p
                    .placements
                    .iter()
                    .map(|pl| PlacementView {
                        sheet: pl.sheet,
                        name: pl.name.clone(),
                        x: pl.x,
                        y: pl.y,
                        w: pl.w,
                        h: pl.h,
                    })
                    .collect(),
                cuts: p.cuts.clone(),
            })
            .collect(),
        lumber: cut_list
            .lumber
            .iter()
            .map(|p| LumberView {
                title: format!(
                    "{} — {}{}, {} waste",
                    p.material_name,
                    boards_text(p, board_word(input.spec, &p.material_id), units),
                    offcut_note(p.offcuts.len()),
                    pct(p.waste)
                ),
                boards: stick_views(p, &cut_list.parts, units),
                cuts: p
                    .cuts
                    .iter()
                    .map(|c| CutView {
                        name: c.name.clone(),
                        stick: if c.stick < p.stick_count {
                            (c.stick + 1).to_string()
                        } else {
                            format!("On hand {}", c.stick - p.stick_count + 1)
                        },
                        length: format_length(c.length, units),
                    })
                    .collect(),
            })
            .collect(),
    }
}

// --- A minimal Typst world: one source, one optional image, bundled fonts ------------------

struct Fonts {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

static FONTS: LazyLock<Fonts> = LazyLock::new(|| {
    let fonts: Vec<Font> = typst_assets::fonts()
        .flat_map(|data| Font::iter(Bytes::new(data)))
        .collect();
    Fonts {
        book: LazyHash::new(FontBook::from_fonts(&fonts)),
        fonts,
    }
});

struct PlanWorld {
    library: LazyHash<Library>,
    main: Source,
    thumbnail: Option<(FileId, Bytes)>,
}

fn file_id(path: &str) -> FileId {
    RootedPath::new(
        VirtualRoot::Project,
        VirtualPath::new(path).expect("static path is valid"),
    )
    .intern()
}

impl World for PlanWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &FONTS.book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        match &self.thumbnail {
            Some((thumb, bytes)) if *thumb == id => Ok(bytes.clone()),
            _ => Err(FileError::AccessDenied),
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        None
    }
}

/// Typeset the plan to PDF bytes.
/// "1 × 120\", 2 × 96\"": boards of more than one length, longest first.
fn lengths_text(bought: &[(f64, usize)], units: Units) -> String {
    bought
        .iter()
        .map(|&(l, n)| format!("{n} × {}", format_length(l, units)))
        .collect::<Vec<_>>()
        .join(", ")
}

/// "2 boards @ 96\"", or "3 boards (1 × 120\", 2 × 96\")" when the lengths differ.
fn boards_text(plan: &LumberPlan, word: &str, units: Units) -> String {
    match plan.bought().as_slice() {
        [_, _, ..] => format!(
            "{} ({})",
            plural(plan.stick_count, word),
            lengths_text(&plan.bought(), units)
        ),
        _ => format!(
            "{} @ {}",
            plural(plan.stick_count, word),
            format_length(plan.stock_length, units)
        ),
    }
}

fn stick_views(plan: &LumberPlan, parts: &[PartRow], units: Units) -> Vec<StickView> {
    let width = |id: &str| parts.iter().find(|r| r.part_id == id).map_or(0.0, |r| r.width);
    let across = plan
        .stock_width
        .unwrap_or_else(|| plan.cuts.iter().map(|c| width(&c.part_id)).fold(1.0, f64::max));
    let lengths = (0..plan.stick_count)
        .map(|i| (plan.board_length(i), String::new()))
        .chain(
            plan.offcuts
                .iter()
                .map(|o| (o.l, format!("On hand, {}", format_length(o.l, units)))),
        );
    lengths
        .enumerate()
        .map(|(n, (l, caption))| {
            let mine: Vec<_> = plan.cuts.iter().filter(|c| c.stick == n).collect();
            let ripped = mine.iter().any(|c| c.y > 0.0);
            StickView {
                caption,
                l,
                across,
                ripped,
                cuts: mine
                    .iter()
                    .map(|c| PlacementView {
                        sheet: n,
                        name: c.name.clone(),
                        x: c.x,
                        y: c.y,
                        w: c.length,
                        // Unripped, a piece fills the bar whatever its width.
                        h: if ripped { width(&c.part_id).min(across) } else { across },
                    })
                    .collect(),
                // Unripped, the bar is not drawn to scale across, so a crosscut spans it all and a
                // rip that trims a piece to width is only listed.
                saws: plan
                    .saw_cuts
                    .iter()
                    .filter(|c| c.sheet == n && (ripped || !c.rip))
                    .map(|c| {
                        if ripped {
                            c.clone()
                        } else {
                            SawCut {
                                y: 0.0,
                                l: across,
                                ..c.clone()
                            }
                        }
                    })
                    .collect(),
                steps: if n < plan.stick_count {
                    trim_step(plan.trim, "end", units) + &cut_steps(&plan.saw_cuts, n, units)
                } else {
                    cut_steps(&plan.saw_cuts, n, units)
                },
                trim: if n < plan.stick_count { plan.trim } else { 0.0 },
            }
        })
        .collect()
}

pub fn render_plan_pdf(input: &PlanInput<'_>) -> Result<Vec<u8>, ExportError> {
    let cut_list = compute_cut_list(
        input.spec,
        CutListConfig {
            kerf: input.kerf,
            units: input.units,
            hardware_prices: input.hardware_prices.clone(),
            offcuts: input.offcuts.clone(),
            sheet_trim: input.sheet_trim,
            board_trim: input.board_trim,
        },
    );
    let view = plan_view(input, &cut_list);
    typeset(TEMPLATE, &view, input.thumbnail.as_deref())
}

/// Typesets `template` with `data` as its `sys.inputs.data` (JSON), and an optional PNG served
/// as `/thumb.png`.
pub(crate) fn typeset(template: &str, data: &impl Serialize, thumbnail: Option<&[u8]>) -> Result<Vec<u8>, ExportError> {
    let data = serde_json::to_string(data).map_err(|e| ExportError::Render(e.to_string()))?;

    let mut inputs = Dict::new();
    inputs.insert("data".into(), data.into_value());
    let world = PlanWorld {
        library: LazyHash::new(Library::builder().with_inputs(inputs).build()),
        main: Source::new(file_id("/main.typ"), template.to_owned()),
        thumbnail: thumbnail.map(|png| (file_id("/thumb.png"), Bytes::new(png.to_vec()))),
    };

    let document: PagedDocument = typst::compile(&world).output.map_err(|errors| {
        ExportError::Render(
            errors
                .iter()
                .map(|e| e.message.to_string())
                .collect::<Vec<_>>()
                .join("; "),
        )
    })?;
    typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()).map_err(|errors| {
        ExportError::Render(
            errors
                .iter()
                .map(|e| e.message.to_string())
                .collect::<Vec<_>>()
                .join("; "),
        )
    })
}

/// One sheet's or board's saw cuts in order, each with where the fence or stop goes: "1 Rip 20\" · 2 Crosscut 30\"".
/// The first step on a trimmed sheet or board, before its numbered cuts: what comes off each
/// `edge` or `end`.
fn trim_step(trim: f64, edge: &str, units: Units) -> String {
    if trim > 0.0 {
        format!("Trim {} off each {edge}, then: ", format_length(trim, units))
    } else {
        String::new()
    }
}

fn cut_steps(cuts: &[SawCut], sheet: usize, units: Units) -> String {
    cuts.iter()
        .filter(|c| c.sheet == sheet)
        .map(|c| {
            format!(
                "{} {} {}",
                c.n,
                if c.rip { "Rip" } else { "Crosscut" },
                format_length(c.off, units)
            )
        })
        .collect::<Vec<_>>()
        .join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use woodshop_core::spec;

    fn door(hinge: &str) -> Spec {
        let raw = json!({
            "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Cabinet", "units": "in",
            "materials": [{ "id": "ply", "name": "Plywood", "type": "sheet", "thickness": 0.75 }],
            "parts": [{ "id": "door", "name": "Left door", "materialId": "ply", "size": { "l": 18, "w": 30 },
                "transform": { "pos": [0, 0, 0] } }],
            "movables": [{ "id": "mv_door", "kind": "door", "partIds": ["door"], "panelPartId": "door",
                "hingeEdge": "w1", "style": "overlay", "hinge": hinge }],
        });
        spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap()
    }

    #[test]
    fn the_plan_says_where_to_bore_hinge_cups() {
        let inches = drilling_notes(&door("hinge.euro-full-overlay"), Units::Fraction);
        assert_eq!(
            inches,
            vec![
                "Left door: bore 2 cups 1 3/8\" (35 mm) across and 1/2\" (12 mm) deep in the back face, centred \
                 7/8\" (22.5 mm) in from the hinge edge, at 3\", 27\" along it (concealed hinge, full overlay)."
            ]
        );
        let metric = drilling_notes(&door("hinge.euro-full-overlay"), Units::Metric);
        assert!(metric[0].contains("35 mm across and 12 mm deep"), "{}", metric[0]);
        assert!(metric[0].contains("centred 22.5 mm in"), "{}", metric[0]);
        assert!(metric[0].contains("at 76 mm, 686 mm along it"), "{}", metric[0]);
    }

    #[test]
    fn a_plan_with_drilling_notes_renders() {
        let spec = door("hinge.euro-full-overlay");
        let pdf = render_plan_pdf(&PlanInput {
            title: "Cabinet",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 14, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Metric,
            hardware_prices: BTreeMap::from([("item|pull.bar-96mm".to_string(), 6.5)]),
            offcuts: Vec::new(),
            sheet_trim: 0.0,
            board_trim: 0.0,
        })
        .unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn priced_hardware_gets_a_cost_column() {
        let raw = include_str!("../../../resources/templates/dresser.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let unpriced = compute_cut_list(&spec, CutListConfig::default());
        let pull = unpriced
            .hardware
            .iter()
            .find(|h| h.key.starts_with("item|pull."))
            .unwrap();
        let input = PlanInput {
            title: "Dresser",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 17, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::from([(pull.key.clone(), 4.0)]),
            offcuts: Vec::new(),
            sheet_trim: 0.0,
            board_trim: 0.0,
        };
        let config = CutListConfig {
            hardware_prices: input.hardware_prices.clone(),
            ..CutListConfig::default()
        };
        let view = plan_view(&input, &compute_cut_list(&spec, config));
        assert!(view.hardware_priced);
        let row = view
            .hardware
            .iter()
            .find(|h| h.description == pull.description)
            .unwrap();
        assert_eq!(row.cost, format!("${:.2}", 4.0 * f64::from(pull.qty)));
        assert!(
            view.hardware.iter().any(|h| h.cost.is_empty()),
            "unpriced rows stay blank"
        );
        assert!(render_plan_pdf(&input).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn a_plan_with_an_assembly_order_renders() {
        let raw = include_str!("../../../resources/templates/dresser.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let input = PlanInput {
            title: "Dresser",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 16, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: Vec::new(),
            sheet_trim: 0.0,
            board_trim: 0.0,
        };
        let cut_list = compute_cut_list(
            &spec,
            CutListConfig {
                kerf: 0.125,
                units: Units::Fraction,
                ..CutListConfig::default()
            },
        );
        let view = plan_view(&input, &cut_list);
        assert_eq!(
            view.assembly.first().map(|s| s.heading.as_str()),
            Some("Start with Toe Board")
        );
        let pdf = render_plan_pdf(&input).unwrap();
        if let Ok(dir) = std::env::var("WOODSHOP_PDF_OUT") {
            std::fs::write(format!("{dir}/dresser.pdf"), &pdf).unwrap();
        }
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn sheets_are_drawn_with_their_saw_cuts_numbered() {
        let raw = include_str!("../../../resources/templates/bookshelf.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let input = PlanInput {
            title: "Bookshelf",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 18, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: vec![],
            sheet_trim: 0.0,
            board_trim: 0.0,
        };
        let cut_list = compute_cut_list(&spec, CutListConfig::default());
        let view = plan_view(&input, &cut_list);
        let sheet = &view.sheets[0];
        let first: Vec<u32> = sheet.cuts.iter().filter(|c| c.sheet == 0).map(|c| c.n).collect();
        assert!(!first.is_empty() && first.iter().enumerate().all(|(i, &n)| n as usize == i + 1));
        // A full sheet is ripped first.
        assert!(sheet.cuts[0].rip);
        assert!(sheet.boards[0].steps.starts_with("1 Rip "), "{}", sheet.boards[0].steps);
        assert!(sheet.boards[0].steps.contains(" · 2 "));
        let pdf = render_plan_pdf(&input).unwrap();
        if let Ok(dir) = std::env::var("WOODSHOP_PDF_OUT") {
            std::fs::write(format!("{dir}/bookshelf.pdf"), &pdf).unwrap();
        }
    }

    #[test]
    fn joinery_is_listed_part_by_part_in_shop_words() {
        let raw = include_str!("../../../resources/templates/record-stand-dado.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let joinery = joinery(&spec, Units::Fraction);
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
        let input = PlanInput {
            title: "Record Stand",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 18, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: vec![],
            sheet_trim: 0.0,
            board_trim: 0.0,
        };
        let pdf = render_plan_pdf(&input).unwrap();
        if let Ok(dir) = std::env::var("WOODSHOP_PDF_OUT") {
            std::fs::write(format!("{dir}/record-stand-dado.pdf"), &pdf).unwrap();
        }
    }

    #[test]
    fn each_tool_setting_is_listed_once_with_every_cut_made_at_it() {
        let raw = include_str!("../../../resources/templates/record-stand-dado.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
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
                face: spec::Face::Front,
                x: 1.5,
                y,
                diameter: 0.25,
                depth: Some(0.375),
                purpose: Some(spec::HolePurpose::ShelfPin),
            })
        };
        let mut ops: Vec<Op> = (0..8).map(|i| hole(4.0 + i as f64 * 2.0)).collect();
        ops.push(Op::Hole(Hole {
            face: spec::Face::Back,
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
    fn a_trimmed_sheet_says_so_before_its_cuts() {
        let raw = include_str!("../../../resources/templates/bookshelf.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let input = PlanInput {
            title: "Bookshelf",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 18, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: vec![],
            sheet_trim: 0.25,
            board_trim: 0.0,
        };
        let cut_list = compute_cut_list(
            &spec,
            CutListConfig {
                sheet_trim: 0.25,
                board_trim: 0.0,
                ..CutListConfig::default()
            },
        );
        let view = plan_view(&input, &cut_list);
        let board = &view.sheets[0].boards[0];
        assert_eq!(board.trim, 0.25);
        assert!(
            board.steps.starts_with("Trim 1/4\" off each edge, then: 1 Rip "),
            "{}",
            board.steps
        );
        let pdf = render_plan_pdf(&input).unwrap();
        if let Ok(dir) = std::env::var("WOODSHOP_PDF_OUT") {
            std::fs::write(format!("{dir}/bookshelf-trimmed.pdf"), &pdf).unwrap();
        }
    }

    #[test]
    fn a_trimmed_board_says_so_before_its_cuts() {
        let raw = include_str!("../../../resources/templates/kitchen-cart.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let input = PlanInput {
            title: "Kitchen Cart",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 18, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: vec![],
            sheet_trim: 0.0,
            board_trim: 1.0,
        };
        let cut_list = compute_cut_list(
            &spec,
            CutListConfig {
                board_trim: 1.0,
                ..CutListConfig::default()
            },
        );
        let view = plan_view(&input, &cut_list);
        let board = &view.lumber[0].boards[0];
        assert_eq!(board.trim, 1.0);
        assert!(
            board.steps.starts_with("Trim 1\" off each end, then: 1 Crosscut "),
            "{}",
            board.steps
        );
        let pdf = render_plan_pdf(&input).unwrap();
        if let Ok(dir) = std::env::var("WOODSHOP_PDF_OUT") {
            std::fs::write(format!("{dir}/kitchen-cart-trimmed.pdf"), &pdf).unwrap();
        }
    }

    #[test]
    fn boards_are_drawn_with_ripped_parts_in_lanes() {
        let raw = include_str!("../../../resources/templates/kitchen-cart.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let input = PlanInput {
            title: "Kitchen Cart",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 17, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: vec![Offcut {
                id: "o1".into(),
                material: "Maple 1x4".into(),
                thickness: 0.75,
                l: 30.0,
                w: None,
            }],
            sheet_trim: 0.0,
            board_trim: 0.0,
        };
        let cut_list = compute_cut_list(
            &spec,
            CutListConfig {
                offcuts: input.offcuts.clone(),
                ..CutListConfig::default()
            },
        );
        let view = plan_view(&input, &cut_list);
        let legs = view.lumber.iter().find(|l| l.title.starts_with("Maple 8/4")).unwrap();
        assert_eq!(legs.boards.len(), 1);
        let board = &legs.boards[0];
        assert!(board.ripped && board.across == 3.5 && board.cuts.len() == 4);
        // Crosscut to length first, then ripped; every cut is drawn on a ripped board.
        assert!(board.steps.starts_with("1 Crosscut "), "{}", board.steps);
        assert!(board.steps.contains(" Rip "), "{}", board.steps);
        assert_eq!(board.saws.len(), board.steps.matches(" · ").count() + 1);
        assert!(board.cuts.iter().all(|c| c.h == 1.5 && c.x + c.w <= board.l));
        // The rails: bought boards, then the piece on hand, captioned and drawn full width.
        let rails = view.lumber.iter().find(|l| l.title.starts_with("Maple 1x4")).unwrap();
        let on_hand = rails.boards.last().unwrap();
        assert_eq!(on_hand.caption, "On hand, 30\"");
        assert!(!on_hand.ripped && on_hand.cuts.iter().all(|c| c.h == 3.5));
        let pdf = render_plan_pdf(&input).unwrap();
        if let Ok(dir) = std::env::var("WOODSHOP_PDF_OUT") {
            std::fs::write(format!("{dir}/kitchen-cart.pdf"), &pdf).unwrap();
        }
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn boards_of_two_lengths_are_listed_and_drawn_at_their_own_length() {
        let raw = include_str!("../../../resources/templates/picnic-table.json");
        let spec = spec::parse(serde_json::from_str(raw).unwrap()).unwrap();
        let input = PlanInput {
            title: "Picnic Table",
            spec: &spec,
            kerf: 0.125,
            date: "Nov 17, 2026",
            notes: vec![],
            thumbnail: None,
            units: Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: Vec::new(),
            sheet_trim: 0.0,
            board_trim: 0.0,
        };
        let cut_list = compute_cut_list(&spec, CutListConfig::default());
        let view = plan_view(&input, &cut_list);
        let two_by_six = view.lumber.iter().find(|l| l.title.starts_with("2x6")).unwrap();
        assert!(
            two_by_six.title.contains("9 boards (4 × 120\", 5 × 96\")"),
            "{}",
            two_by_six.title
        );
        let drawn: Vec<f64> = two_by_six.boards.iter().map(|b| b.l).collect();
        assert_eq!(drawn.iter().filter(|&&l| l == 96.0).count(), 5);
        let section = view.sections.iter().find(|s| s.title.starts_with("2x6")).unwrap();
        assert!(
            section.summary.contains("Buy 9 boards · 4 × 120\", 5 × 96\""),
            "{}",
            section.summary
        );
        assert!(render_plan_pdf(&input).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn a_surface_hinge_needs_no_drilling_note() {
        assert!(drilling_notes(&door("hinge.butt-2-5in"), Units::Fraction).is_empty());
    }
}
