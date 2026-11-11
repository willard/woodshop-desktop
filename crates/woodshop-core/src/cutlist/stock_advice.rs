//! "One 4×8 sheet, ~90% waste" is true and useless. This turns a wasteful single-sheet plan into
//! the smaller panel to buy. Advisory only: it never changes the packing.

use serde::{Deserialize, Serialize};

use super::types::{CutList, Placement, SheetSize};
use crate::spec::Spec;
use crate::units::format_fraction;

/// Panels a lumberyard sells, smallest first. A material's own `sheetSizes` wins.
const STOCK_PANELS: [SheetSize; 5] = [
    SheetSize { l: 24.0, w: 24.0 },
    SheetSize { l: 48.0, w: 24.0 },
    SheetSize { l: 48.0, w: 48.0 },
    SheetSize { l: 60.0, w: 60.0 },
    SheetSize { l: 96.0, w: 48.0 },
];

/// The same idea in a metric yard: 600 square, quarter sheet, half sheet, 1525 square, full sheet.
const METRIC_PANELS: [SheetSize; 5] = [
    SheetSize {
        l: 600.0 / 25.4,
        w: 600.0 / 25.4,
    },
    SheetSize {
        l: 1220.0 / 25.4,
        w: 607.0 / 25.4,
    },
    SheetSize {
        l: 1220.0 / 25.4,
        w: 1220.0 / 25.4,
    },
    SheetSize {
        l: 1525.0 / 25.4,
        w: 1525.0 / 25.4,
    },
    SheetSize {
        l: 2440.0 / 25.4,
        w: 1220.0 / 25.4,
    },
];

/// A sheet sold in millimetres: whole millimetres that are not whole sixteenths of an inch.
fn is_metric(size: SheetSize) -> bool {
    let whole_mm = |v: f64| ((v * 25.4) - (v * 25.4).round()).abs() < 0.05;
    let whole_16th = |v: f64| ((v * 16.0) - (v * 16.0).round()).abs() < 1e-6;
    whole_mm(size.l) && whole_mm(size.w) && !(whole_16th(size.l) && whole_16th(size.w))
}

/// Below this much waste the sheet is used well enough to leave alone.
const WASTE_THRESHOLD: f64 = 0.5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockSuggestion {
    pub material_id: String,
    pub material_name: String,
    pub current_stock: String,
    pub parts_fit_within: String,
    pub suggested_stock: String,
    pub waste_percent: f64,
    /// In shop fractions; the app words its own from the sizes below in the reader's units.
    pub message: String,
    pub current_size: SheetSize,
    pub needed_size: SheetSize,
    pub suggested_size: SheetSize,
}

pub fn stock_advice(cut_list: &CutList, spec: &Spec) -> Vec<StockSuggestion> {
    let mut out = Vec::new();
    for plan in &cut_list.sheets {
        // More than one sheet means stock is not the problem; low waste means it fits.
        if plan.sheet_count != 1 || plan.waste < WASTE_THRESHOLD {
            continue;
        }
        let Some(needed) = bounding_box(&plan.placements) else {
            continue;
        };
        let panels = panels_for(spec, &plan.material_id, is_metric(plan.sheet_size));
        let Some(smaller) = smallest_that_holds(&panels, needed, plan.sheet_size) else {
            continue;
        };
        let waste = (plan.waste * 100.0).round();
        out.push(StockSuggestion {
            material_id: plan.material_id.clone(),
            material_name: plan.material_name.clone(),
            current_stock: label(plan.sheet_size),
            parts_fit_within: label(needed),
            suggested_stock: label(smaller),
            waste_percent: waste,
            message: format!(
                "These parts fit within {}, so a {} panel would do — the {} sheet is {}% offcut.",
                label(needed),
                label(smaller),
                label(plan.sheet_size),
                waste as i64
            ),
            current_size: plan.sheet_size,
            needed_size: needed,
            suggested_size: smaller,
        });
    }
    out
}

fn bounding_box(placements: &[Placement]) -> Option<SheetSize> {
    if placements.is_empty() {
        return None;
    }
    let l = placements.iter().map(|p| p.x + p.w).fold(0.0, f64::max);
    let w = placements.iter().map(|p| p.y + p.h).fold(0.0, f64::max);
    Some(SheetSize { l, w })
}

fn panels_for(spec: &Spec, material_id: &str, metric: bool) -> Vec<SheetSize> {
    match spec.material(material_id).and_then(|m| m.sheet_sizes.as_deref()) {
        Some(declared) if !declared.is_empty() => {
            let mut panels: Vec<SheetSize> = declared.iter().map(|s| SheetSize { l: s.l, w: s.w }).collect();
            panels.sort_by(|a, b| {
                (a.l * a.w)
                    .partial_cmp(&(b.l * b.w))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            panels
        }
        _ if metric => METRIC_PANELS.to_vec(),
        _ => STOCK_PANELS.to_vec(),
    }
}

/// The smallest candidate that holds the parts (either orientation) and is smaller than current.
fn smallest_that_holds(panels: &[SheetSize], needed: SheetSize, current: SheetSize) -> Option<SheetSize> {
    let current_area = current.l * current.w;
    panels.iter().copied().find(|p| {
        current_area > p.l * p.w && ((needed.l <= p.l && needed.w <= p.w) || (needed.l <= p.w && needed.w <= p.l))
    })
}

fn label(size: SheetSize) -> String {
    format!("{}\" × {}\"", format_fraction(size.l, 16), format_fraction(size.w, 16))
}

#[cfg(test)]
mod metric_tests {
    use super::*;
    use crate::cutlist::{CutListConfig, compute_cut_list};
    use crate::spec::parse;
    use serde_json::json;

    fn one_small_part_on(sheet_mm: (f64, f64)) -> Vec<StockSuggestion> {
        let spec = parse(json!({
            "specVersion": "1.15", "units": "in", "name": "T",
            "materials": [{ "id": "m_ply", "type": "sheet", "name": "Ply", "thickness": 18.0 / 25.4,
                            "sheetSize": { "l": sheet_mm.0 / 25.4, "w": sheet_mm.1 / 25.4 } }],
            "parts": [{ "id": "p_a", "name": "A", "materialId": "m_ply", "size": { "l": 20, "w": 10 },
                        "transform": { "pos": [0, 5, 0] } }],
        }))
        .unwrap();
        stock_advice(&compute_cut_list(&spec, CutListConfig::default()), &spec)
    }

    #[test]
    fn a_metric_sheet_gets_a_metric_panel() {
        let advice = one_small_part_on((2440.0, 1220.0));
        let panel = advice[0].suggested_size;
        assert_eq!(((panel.l * 25.4).round(), (panel.w * 25.4).round()), (600.0, 600.0));
    }

    #[test]
    fn an_imperial_sheet_keeps_imperial_panels() {
        let advice = one_small_part_on((96.0 * 25.4, 48.0 * 25.4));
        assert_eq!((advice[0].suggested_size.l, advice[0].suggested_size.w), (24.0, 24.0));
        assert!(advice[0].message.contains("24\" × 24\""));
    }
}
