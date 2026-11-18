//! One shopping list for several designs: the same material in two designs is bought once, its
//! pieces packed onto shared sheets and boards (one design's offcut is another's shelf), and the
//! hardware is added up by its stable key.

use serde::Serialize;

use super::{
    CutListConfig, CutListTotals, HardwareRow, LumberPlan, PartRow, SheetPlan, board_feet, compute_cut_list,
    plan_lumber, plan_sheets, stick_board_feet, totals_of,
};
use crate::spec::{Material, MaterialType, Part, Spec};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoppingList {
    /// Sheet goods to buy, one plan per material, the designs' pieces packed together.
    pub sheets: Vec<SheetPlan>,
    /// Boards and round stock to buy, packed together the same way.
    pub lumber: Vec<LumberPlan>,
    /// All the designs' hardware, added up.
    pub hardware: Vec<HardwareRow>,
    pub totals: CutListTotals,
    /// Sheets and boards the designs would need bought one at a time: the saving is the difference.
    pub separate_sheets: usize,
    pub separate_boards: usize,
}

/// What makes two designs' materials the same thing to buy.
fn same_stock(a: &Material, b: &Material) -> bool {
    let close = |x: f64, y: f64| (x - y).abs() < 1e-6;
    a.kind == b.kind
        && a.name.trim().eq_ignore_ascii_case(b.name.trim())
        && close(a.thickness, b.thickness)
        && match (a.sheet_size, b.sheet_size) {
            (Some(x), Some(y)) => close(x.l, y.l) && close(x.w, y.w),
            (None, None) => true,
            _ => false,
        }
        && a.has_grain() == b.has_grain()
        && a.species == b.species
        && a.stock_lengths == b.stock_lengths
        && a.stock_width == b.stock_width
}

pub fn shopping_list(designs: &[&Spec], config: &CutListConfig) -> ShoppingList {
    // Each design on its own: its part rows and hardware, and what it would buy alone.
    let alone: Vec<_> = designs.iter().map(|d| compute_cut_list(d, config.clone())).collect();

    // The materials to buy, each with the pieces every design cuts from it.
    let mut stock: Vec<(Material, Vec<Part>)> = Vec::new();
    for (i, design) in designs.iter().enumerate() {
        for material in &design.materials {
            let pieces = design
                .parts
                .iter()
                .filter(|p| p.material_id == material.id)
                .map(|p| Part {
                    // Ids only need to be unique within the list.
                    id: format!("d{i}_{}", p.id),
                    ..p.clone()
                });
            match stock.iter_mut().find(|(m, _)| same_stock(m, material)) {
                Some((bought, parts)) => {
                    // A price set in either design counts.
                    bought.cost_per_sheet = bought.cost_per_sheet.or(material.cost_per_sheet);
                    bought.cost_per_board_foot = bought.cost_per_board_foot.or(material.cost_per_board_foot);
                    parts.extend(pieces);
                }
                None => stock.push((
                    Material {
                        id: format!("m{}", stock.len()),
                        ..material.clone()
                    },
                    pieces.collect(),
                )),
            }
        }
    }

    let (mut sheets, mut lumber, mut allocated) = (Vec::new(), Vec::new(), Vec::new());
    for (material, parts) in &stock {
        let group: Vec<&Part> = parts.iter().collect();
        if group.is_empty() {
            continue;
        }
        match (material.kind, material.sheet_size) {
            (MaterialType::Sheet, Some(size)) => {
                let plan = plan_sheets(
                    material,
                    size.l,
                    size.w,
                    &group,
                    config.kerf,
                    config.sheet_trim,
                    &config.offcuts,
                );
                allocated.push(board_feet(size.l, size.w, material.thickness, plan.sheet_count as u32));
                sheets.push(plan);
            }
            (MaterialType::Lumber | MaterialType::Round, _) => {
                let plan = plan_lumber(material, &group, config.kerf, config.board_trim, &config.offcuts);
                allocated.push(stick_board_feet(material, &group, &plan));
                lumber.push(plan);
            }
            _ => {}
        }
    }

    // Hardware by key; the price goes on the summed quantity.
    let mut hardware: Vec<HardwareRow> = Vec::new();
    for row in alone.iter().flat_map(|c| &c.hardware) {
        match hardware.iter_mut().find(|h| h.key == row.key) {
            Some(h) => {
                h.qty += row.qty;
                h.derived &= row.derived;
            }
            None => hardware.push(row.clone()),
        }
    }
    for row in &mut hardware {
        row.cost = row.unit_price.map(|p| p * f64::from(row.qty));
    }
    hardware.sort_by_key(|h| h.kind);

    let parts: Vec<PartRow> = alone.iter().flat_map(|c| c.parts.clone()).collect();
    let mut totals = totals_of(&parts, &sheets, &lumber, &allocated, &hardware);
    totals.weight = alone.iter().map(|c| c.totals.weight).sum();
    totals.finish_area = alone.iter().map(|c| c.totals.finish_area).sum();
    ShoppingList {
        separate_sheets: alone.iter().map(|c| c.totals.sheet_count).sum(),
        separate_boards: alone.iter().flat_map(|c| &c.lumber).map(|p| p.stick_count).sum(),
        sheets,
        lumber,
        hardware,
        totals,
    }
}
