//! Part labels: one sticky label per piece to cut, in the order the pieces come off the stock
//! (sheet by sheet, then board by board), so each can be marked as it is cut. Printed on the
//! common 30-up US Letter sheet (Avery 5160 and its equivalents), or the 21-up A4 sheet (Avery
//! L7160) for a shop that works in millimetres.

use std::collections::HashMap;

use serde::Serialize;
use woodshop_core::cutlist::{CutListConfig, compute_cut_list};
use woodshop_core::spec::Spec;
use woodshop_core::units::Units;

use crate::ExportError;
use crate::pdf::{dims3, typeset};

const TEMPLATE: &str = include_str!("../templates/labels.typ");

pub struct LabelsInput<'a> {
    pub title: &'a str,
    pub spec: &'a Spec,
    pub kerf: f64,
    pub units: Units,
    /// Labels already used on the first sheet: printing starts after them.
    pub skip: usize,
}

/// Labels on one sheet: 30 on Letter, 21 on A4 (metric).
pub fn labels_per_sheet(units: Units) -> usize {
    if units == Units::Metric { 21 } else { 30 }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Label {
    pub name: String,
    /// "2 of 4" when the part is cut more than once; empty otherwise.
    pub count: String,
    pub size: String,
    pub material: String,
    /// "Sheet 2" or "Board 3"; empty for a piece with no layout (round stock, say).
    pub source: String,
}

#[derive(Serialize)]
struct LabelsView<'a> {
    title: &'a str,
    paper: &'static str,
    skip: usize,
    labels: Vec<Label>,
}

/// Every piece's label, in cutting order.
pub fn part_labels(spec: &Spec, kerf: f64, units: Units) -> Vec<Label> {
    let cut_list = compute_cut_list(
        spec,
        CutListConfig {
            kerf,
            units,
            ..CutListConfig::default()
        },
    );
    // Where each piece comes from, in the order they are cut.
    let mut sources: Vec<(&str, String)> = Vec::new();
    for plan in &cut_list.sheets {
        let mut placements: Vec<_> = plan.placements.iter().collect();
        placements.sort_by_key(|p| p.sheet);
        sources.extend(
            placements
                .iter()
                .map(|p| (p.part_id.as_str(), format!("Sheet {}", p.sheet + 1))),
        );
    }
    for plan in &cut_list.lumber {
        let mut cuts: Vec<_> = plan.cuts.iter().collect();
        cuts.sort_by_key(|c| c.stick);
        sources.extend(
            cuts.iter()
                .map(|c| (c.part_id.as_str(), format!("Board {}", c.stick + 1))),
        );
    }

    let rows: HashMap<&str, _> = cut_list.parts.iter().map(|r| (r.part_id.as_str(), r)).collect();
    let mut cut: HashMap<&str, u32> = HashMap::new();
    let label = |row: &woodshop_core::cutlist::PartRow, n: u32, source: String| Label {
        name: row.name.clone(),
        count: if row.qty > 1 {
            format!("{n} of {}", row.qty)
        } else {
            String::new()
        },
        size: dims3(row.length, row.width, row.thickness, units),
        material: row.material_name.clone(),
        source,
    };

    let mut labels = Vec::new();
    for (part_id, source) in sources {
        let Some(row) = rows.get(part_id) else { continue };
        let n = cut.entry(part_id).or_default();
        if *n >= row.qty {
            continue;
        }
        *n += 1;
        labels.push(label(row, *n, source));
    }
    // Pieces no layout covers still get their labels, after the rest.
    for row in &cut_list.parts {
        let done = cut.get(row.part_id.as_str()).copied().unwrap_or(0);
        for n in done + 1..=row.qty {
            labels.push(label(row, n, String::new()));
        }
    }
    labels
}

/// Typeset the label sheets to PDF bytes.
pub fn render_labels_pdf(input: &LabelsInput<'_>) -> Result<Vec<u8>, ExportError> {
    let view = LabelsView {
        title: input.title,
        paper: if input.units == Units::Metric { "a4" } else { "letter" },
        skip: input.skip.min(labels_per_sheet(input.units) - 1),
        labels: part_labels(input.spec, input.kerf, input.units),
    };
    typeset(TEMPLATE, &view, None)
}
