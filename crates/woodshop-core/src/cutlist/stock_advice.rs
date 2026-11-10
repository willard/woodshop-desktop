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
    pub message: String,
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
        let panels = panels_for(spec, &plan.material_id);
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

fn panels_for(spec: &Spec, material_id: &str) -> Vec<SheetSize> {
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
