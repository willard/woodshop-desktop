//! One shopping list for several designs: the same material in two designs is bought once, its
//! pieces packed onto shared sheets and boards (one design's offcut is another's shelf), and the
//! hardware is added up by its stable key.

use serde::{Deserialize, Serialize};

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
    /// Where each line to buy comes from: a sheet or lumber plan by its `materialId`, a hardware
    /// row by its `key`, each with the designs' own items that add up to it.
    pub sources: Vec<ShoppingSource>,
    /// What the designs already have (see [`Have`]), left off the list, alike things together.
    pub had: Vec<HadLine>,
}

/// What one design already has, so it is not bought: its materials by id and its hardware by key.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Have {
    #[serde(default)]
    pub materials: Vec<String>,
    #[serde(default)]
    pub hardware: Vec<String>,
}

/// One design's own item: `m:<material id>` or `h:<hardware key>`, `design` its index in the list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignItem {
    pub design: usize,
    pub item: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoppingSource {
    /// A plan's `materialId` or a hardware row's `key`.
    pub key: String,
    pub designs: Vec<DesignItem>,
}

/// Something the designs already have: a material, or hardware with how many.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HadLine {
    /// "Baltic Birch 18mm", or "#8 × 1 1/4\" wood screws".
    pub label: String,
    /// For hardware, how many the designs use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qty: Option<u32>,
    pub designs: Vec<DesignItem>,
}

/// Adds `item` to the line or source keyed `key`, starting one when there is none.
fn note(list: &mut Vec<ShoppingSource>, key: &str, item: DesignItem) {
    match list.iter_mut().find(|s| s.key == key) {
        Some(s) => s.designs.push(item),
        None => list.push(ShoppingSource {
            key: key.to_owned(),
            designs: vec![item],
        }),
    }
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
        && a.appearance == b.appearance
        && a.stock_lengths == b.stock_lengths
        && a.stock_width == b.stock_width
}

pub fn shopping_list(designs: &[&Spec], config: &CutListConfig) -> ShoppingList {
    shopping_list_having(designs, config, &[])
}

/// The shopping list for what is still to get: `have[i]` (when given) is what design `i`
/// already has, left off the list and listed under `had`.
pub fn shopping_list_having(designs: &[&Spec], config: &CutListConfig, have: &[Have]) -> ShoppingList {
    // Each design on its own: its part rows and hardware, and what it would buy alone.
    let alone: Vec<_> = designs.iter().map(|d| compute_cut_list(d, config.clone())).collect();
    let none = Have::default();
    let has = |i: usize| have.get(i).unwrap_or(&none);

    // The materials to buy, each with the pieces every design cuts from it.
    let mut stock: Vec<(Material, Vec<Part>)> = Vec::new();
    let mut sources: Vec<ShoppingSource> = Vec::new();
    let mut had_stock: Vec<(Material, Vec<DesignItem>)> = Vec::new();
    for (i, design) in designs.iter().enumerate() {
        for material in &design.materials {
            let used = design.parts.iter().any(|p| p.material_id == material.id);
            let item = DesignItem {
                design: i,
                item: format!("m:{}", material.id),
            };
            if has(i).materials.contains(&material.id) {
                if used {
                    match had_stock.iter_mut().find(|(m, _)| same_stock(m, material)) {
                        Some((_, items)) => items.push(item),
                        None => had_stock.push((material.clone(), vec![item])),
                    }
                }
                continue;
            }
            let pieces = design
                .parts
                .iter()
                .filter(|p| p.material_id == material.id)
                .map(|p| Part {
                    // Ids only need to be unique within the list.
                    id: format!("d{i}_{}", p.id),
                    ..p.clone()
                });
            let at = match stock.iter_mut().position(|(m, _)| same_stock(m, material)) {
                Some(at) => {
                    let (bought, parts) = &mut stock[at];
                    // A price set in either design counts.
                    bought.cost_per_sheet = bought.cost_per_sheet.or(material.cost_per_sheet);
                    bought.cost_per_board_foot = bought.cost_per_board_foot.or(material.cost_per_board_foot);
                    parts.extend(pieces);
                    at
                }
                None => {
                    stock.push((
                        Material {
                            id: format!("m{}", stock.len()),
                            ..material.clone()
                        },
                        pieces.collect(),
                    ));
                    stock.len() - 1
                }
            };
            if used {
                note(&mut sources, &stock[at].0.id, item);
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
    let mut had: Vec<HadLine> = had_stock
        .into_iter()
        .map(|(m, designs)| HadLine {
            label: m.name,
            qty: None,
            designs,
        })
        .collect();
    let rows = alone
        .iter()
        .enumerate()
        .flat_map(|(i, c)| c.hardware.iter().map(move |r| (i, r)));
    for (i, row) in rows {
        let item = DesignItem {
            design: i,
            item: format!("h:{}", row.key),
        };
        if has(i).hardware.contains(&row.key) {
            match had.iter_mut().find(|h| h.qty.is_some() && h.label == row.description) {
                Some(h) => {
                    h.qty = Some(h.qty.unwrap_or(0) + row.qty);
                    h.designs.push(item);
                }
                None => had.push(HadLine {
                    label: row.description.clone(),
                    qty: Some(row.qty),
                    designs: vec![item],
                }),
            }
            continue;
        }
        note(&mut sources, &row.key, item);
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

    // The parts still to buy stock for: none from a material a design already has.
    let parts: Vec<PartRow> = alone
        .iter()
        .enumerate()
        .flat_map(|(i, c)| {
            let had = &has(i).materials;
            c.parts.iter().filter(move |r| !had.contains(&r.material_id)).cloned()
        })
        .collect();
    let mut totals = totals_of(&parts, &sheets, &lumber, &allocated, &hardware);
    totals.weight = alone.iter().map(|c| c.totals.weight).sum();
    totals.finish_area = alone.iter().map(|c| c.totals.finish_area).sum();
    for row in alone.iter().flat_map(|c| &c.totals.coatings) {
        super::surface::add_coating(&mut totals.coatings, row.clone());
    }
    // What each design would buy alone, of what is still to get.
    let wanted = |i: usize, material_id: &str| !has(i).materials.iter().any(|m| m == material_id);
    ShoppingList {
        separate_sheets: alone
            .iter()
            .enumerate()
            .flat_map(|(i, c)| c.sheets.iter().filter(move |p| wanted(i, &p.material_id)))
            .map(|p| p.sheet_count)
            .sum(),
        separate_boards: alone
            .iter()
            .enumerate()
            .flat_map(|(i, c)| c.lumber.iter().filter(move |p| wanted(i, &p.material_id)))
            .map(|p| p.stick_count)
            .sum(),
        sheets,
        lumber,
        hardware,
        totals,
        sources,
        had,
    }
}
