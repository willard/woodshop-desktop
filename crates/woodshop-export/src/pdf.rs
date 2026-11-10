//! The printable plan: summary, shop notes, the grouped cut list, hardware, sheet layouts and
//! stick cuts, typeset by an embedded Typst. Everything is computed here with the same core the
//! editor uses, so the paper matches the screen.

use std::sync::LazyLock;

use serde::Serialize;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Dict, IntoValue};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use woodshop_core::cutlist::grouping::{SectionKind, StockUnit};
use woodshop_core::cutlist::{CutList, CutListConfig, CutListSection, compute_cut_list, group_cut_list};
use woodshop_core::geometry::overall_size;
use woodshop_core::spec::Spec;
use woodshop_core::units::inch_label;

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
    sheets: Vec<SheetView>,
    lumber: Vec<LumberView>,
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

#[derive(Serialize)]
struct HardwareView {
    qty: u32,
    description: String,
}

#[derive(Serialize)]
struct SheetView {
    title: String,
    count: usize,
    l: f64,
    w: f64,
    placements: Vec<PlacementView>,
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
    cuts: Vec<CutView>,
}

#[derive(Serialize)]
struct CutView {
    name: String,
    stick: usize,
    length: String,
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

fn section_view(section: &CutListSection) -> SectionView {
    let kind = match section.kind {
        SectionKind::Sheet => "Sheet goods",
        SectionKind::Lumber => "Lumber",
        SectionKind::Other => "Other stock",
    };
    let mut summary = Vec::new();
    if let Some(stock) = &section.stock {
        let unit = match stock.unit {
            StockUnit::Sheet => "sheet",
            StockUnit::Stick => "stick",
        };
        let size = match stock.w {
            Some(w) => format!("{} × {}", inch_label(stock.l), inch_label(w)),
            None => inch_label(stock.l),
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
                    dims: format!(
                        "{} × {} × {}",
                        inch_label(g.length),
                        inch_label(g.width),
                        inch_label(g.thickness)
                    ),
                    notes: notes.join(", "),
                    members,
                }
            })
            .collect(),
    }
}

fn plan_view(input: &PlanInput<'_>, cut_list: &CutList) -> PlanView {
    let overall = overall_size(input.spec).map(|o| {
        format!(
            "{} × {} × {}",
            inch_label(o.width),
            inch_label(o.depth),
            inch_label(o.height)
        )
    });
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
        sections: group_cut_list(cut_list).iter().map(section_view).collect(),
        hardware: cut_list
            .hardware
            .iter()
            .map(|h| HardwareView {
                qty: h.qty,
                description: h.description.clone(),
            })
            .collect(),
        sheets: cut_list
            .sheets
            .iter()
            .map(|p| SheetView {
                title: format!(
                    "{} — {}, {} waste",
                    p.material_name,
                    plural(p.sheet_count, "sheet"),
                    pct(p.waste)
                ),
                count: p.sheet_count,
                l: p.sheet_size.l,
                w: p.sheet_size.w,
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
            })
            .collect(),
        lumber: cut_list
            .lumber
            .iter()
            .map(|p| LumberView {
                title: format!(
                    "{} — {} @ {}, {} waste",
                    p.material_name,
                    plural(p.stick_count, "stick"),
                    inch_label(p.stock_length),
                    pct(p.waste)
                ),
                cuts: p
                    .cuts
                    .iter()
                    .map(|c| CutView {
                        name: c.name.clone(),
                        stick: c.stick + 1,
                        length: inch_label(c.length),
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
pub fn render_plan_pdf(input: &PlanInput<'_>) -> Result<Vec<u8>, ExportError> {
    let cut_list = compute_cut_list(input.spec, CutListConfig { kerf: input.kerf });
    let view = plan_view(input, &cut_list);
    let data = serde_json::to_string(&view).map_err(|e| ExportError::Render(e.to_string()))?;

    let mut inputs = Dict::new();
    inputs.insert("data".into(), data.into_value());
    let world = PlanWorld {
        library: LazyHash::new(Library::builder().with_inputs(inputs).build()),
        main: Source::new(file_id("/main.typ"), TEMPLATE.to_owned()),
        thumbnail: input
            .thumbnail
            .as_ref()
            .map(|png| (file_id("/thumb.png"), Bytes::new(png.clone()))),
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
