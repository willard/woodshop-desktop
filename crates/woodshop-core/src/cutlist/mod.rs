//! Cut list engine. Groups a spec's parts by material, packs sheet goods (grain- and kerf-aware)
//! and lumber/round stock (1D), and reports parts, layouts, board feet, cost, waste and hardware.
//! Pure and derived — never stored; recompute from the spec.

pub mod grouping;
pub mod hardware;
pub mod pack;
pub mod stock_advice;
pub mod types;

pub use grouping::{CutListSection, group_cut_list};
pub use hardware::compute_hardware;
pub use stock_advice::{StockSuggestion, stock_advice};
pub use types::*;

use pack::{LumberItem, SheetItem, board_feet, pack_guillotine, pack_lumber, round_board_feet};

use crate::spec::{GrainAxis, Material, MaterialType, Op, Part, Spec};

/// Stick length assumed when a lumber material lists none.
pub const DEFAULT_STOCK_LENGTH: f64 = 96.0;

pub fn compute_cut_list(spec: &Spec, config: CutListConfig) -> CutList {
    let parts: Vec<PartRow> = spec
        .parts
        .iter()
        .map(|part| {
            let material = spec.material(&part.material_id);
            let thickness = material.map_or(0.0, |m| m.thickness);
            let has = |f: fn(&Op) -> bool| part.ops().iter().any(f);
            PartRow {
                part_id: part.id.clone(),
                name: part.name.clone(),
                material_id: part.material_id.clone(),
                material_name: material.map_or_else(|| part.material_id.clone(), |m| m.name.clone()),
                species: material.and_then(|m| m.species).map(|s| s.as_str().to_owned()),
                curved: has(|o| matches!(o, Op::Curve(_))),
                notched: has(|o| matches!(o, Op::Notch(_))),
                mitered: has(|o| matches!(o, Op::Miter(_))),
                eased: has(|o| matches!(o, Op::Ease(_))),
                length: part.size.l,
                width: part.size.w,
                thickness,
                qty: part.qty(),
                board_feet: if material.is_some_and(|m| m.kind == MaterialType::Round) {
                    round_board_feet(part.size.l, thickness, part.qty())
                } else {
                    board_feet(part.size.l, part.size.w, thickness, part.qty())
                },
            }
        })
        .collect();

    let mut sheets = Vec::new();
    let mut lumber = Vec::new();
    // Board feet of stock each plan buys: the one unit that weighs sheets against sticks.
    let mut sheet_stock = Vec::new();
    let mut lumber_stock = Vec::new();

    for material in &spec.materials {
        let group: Vec<&Part> = spec.parts.iter().filter(|p| p.material_id == material.id).collect();
        if group.is_empty() {
            continue;
        }
        match (material.kind, material.sheet_size) {
            (MaterialType::Sheet, Some(size)) => {
                let plan = plan_sheets(material, size.l, size.w, &group, config.kerf);
                sheet_stock.push(board_feet(size.l, size.w, material.thickness, plan.sheet_count as u32));
                sheets.push(plan);
            }
            (MaterialType::Lumber | MaterialType::Round, _) => {
                // Round stock comes in sticks and is cross-cut to length, exactly like lumber.
                let plan = plan_lumber(material, &group, config.kerf);
                lumber_stock.push(stick_board_feet(material, &group, &plan));
                lumber.push(plan);
            }
            _ => {}
        }
    }

    let totals = totals_of(&parts, &sheets, &lumber, &[sheet_stock, lumber_stock].concat());
    CutList {
        parts,
        sheets,
        lumber,
        hardware: compute_hardware(spec),
        totals,
    }
}

/// Board feet of stick stock a lumber plan buys; board width is `stockWidth`, else the widest
/// part cut from it.
fn stick_board_feet(material: &Material, parts: &[&Part], plan: &LumberPlan) -> f64 {
    if material.kind == MaterialType::Round {
        return round_board_feet(plan.stock_length, material.thickness, plan.stick_count as u32);
    }
    let width = material
        .stock_width
        .unwrap_or_else(|| parts.iter().map(|p| p.size.w).fold(f64::NEG_INFINITY, f64::max));
    board_feet(plan.stock_length, width, material.thickness, plan.stick_count as u32)
}

fn plan_sheets(material: &Material, sheet_l: f64, sheet_w: f64, parts: &[&Part], kerf: f64) -> SheetPlan {
    let grained = material.has_grain();
    let mut items = Vec::new();
    for part in parts {
        let grain_locked = grained && part.grain_axis() != GrainAxis::None;
        // Sheet length is the grain direction; align the part's grain axis to it.
        let (along, across) = if part.grain_axis() == GrainAxis::W {
            (part.size.w, part.size.l)
        } else {
            (part.size.l, part.size.w)
        };
        for _ in 0..part.qty() {
            items.push(SheetItem {
                part_id: part.id.clone(),
                name: part.name.clone(),
                w: if grain_locked { along } else { part.size.l },
                h: if grain_locked { across } else { part.size.w },
                rotatable: !grain_locked,
            });
        }
    }

    let packed = pack_guillotine(items, sheet_l, sheet_w, kerf);
    let allocated = packed.sheet_count as f64 * sheet_l * sheet_w;
    SheetPlan {
        material_id: material.id.clone(),
        material_name: material.name.clone(),
        sheet_size: SheetSize { l: sheet_l, w: sheet_w },
        sheet_count: packed.sheet_count,
        placements: packed.placements,
        waste: if allocated > 0.0 {
            1.0 - packed.used_area / allocated
        } else {
            0.0
        },
        cost: material.cost_per_sheet.map(|c| packed.sheet_count as f64 * c),
    }
}

fn plan_lumber(material: &Material, parts: &[&Part], kerf: f64) -> LumberPlan {
    let stock_length = match material.stock_lengths.as_deref() {
        Some(lengths) if !lengths.is_empty() => lengths.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        _ => DEFAULT_STOCK_LENGTH,
    };

    let mut items = Vec::new();
    let mut bf = 0.0;
    for part in parts {
        for _ in 0..part.qty() {
            items.push(LumberItem {
                part_id: part.id.clone(),
                name: part.name.clone(),
                length: part.size.l,
            });
        }
        bf += if material.kind == MaterialType::Round {
            round_board_feet(part.size.l, material.thickness, part.qty())
        } else {
            board_feet(part.size.l, part.size.w, material.thickness, part.qty())
        };
    }

    let packed = pack_lumber(items, stock_length, kerf);
    let allocated = packed.stick_count as f64 * stock_length;
    LumberPlan {
        material_id: material.id.clone(),
        material_name: material.name.clone(),
        stock_length,
        stick_count: packed.stick_count,
        cuts: packed.cuts,
        // An oversized part would read as negative waste; the linter errors it, this floors at 0.
        waste: if allocated > 0.0 {
            (1.0 - packed.used_length / allocated).max(0.0)
        } else {
            0.0
        },
        cost: material.cost_per_board_foot.map(|c| bf * c),
    }
}

fn totals_of(parts: &[PartRow], sheets: &[SheetPlan], lumber: &[LumberPlan], allocated_bf: &[f64]) -> CutListTotals {
    let board_feet_total = parts.iter().map(|p| p.board_feet).sum();
    let sheet_count = sheets.iter().map(|s| s.sheet_count).sum();

    let costs: Vec<Option<f64>> = sheets
        .iter()
        .map(|p| p.cost)
        .chain(lumber.iter().map(|p| p.cost))
        .collect();
    let estimated_cost = costs
        .iter()
        .any(Option::is_some)
        .then(|| costs.iter().map(|c| c.unwrap_or(0.0)).sum());

    // Each plan's waste is in its own units (area vs length); weigh by board feet of stock bought.
    let wastes = sheets.iter().map(|p| p.waste).chain(lumber.iter().map(|p| p.waste));
    let (mut allocated, mut offcut) = (0.0, 0.0);
    for (i, waste) in wastes.enumerate() {
        let stock = allocated_bf.get(i).copied().unwrap_or(0.0);
        allocated += stock;
        offcut += stock * waste;
    }

    CutListTotals {
        board_feet: board_feet_total,
        sheet_count,
        estimated_cost,
        waste_percent: if allocated > 0.0 { offcut / allocated } else { 0.0 },
    }
}
