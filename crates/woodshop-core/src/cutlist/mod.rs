//! Cut list engine. Groups a spec's parts by material, packs sheet goods (grain- and kerf-aware)
//! and lumber/round stock (1D), and reports parts, layouts, board feet, cost, waste and hardware.
//! Pure and derived — never stored; recompute from the spec.

pub mod grouping;
pub mod hardware;
pub mod pack;
pub mod sequence;
pub mod shopping;
pub mod stock_advice;
pub mod types;

pub use grouping::{CutListSection, group_cut_list};
pub use hardware::{compute_hardware, compute_hardware_in};
pub use shopping::{ShoppingList, shopping_list};
pub use stock_advice::{StockSuggestion, stock_advice};
pub use types::*;

use pack::{
    KEEP_BOARD, LumberItem, PackedLumber, SheetItem, board_feet, pack_boards_into, pack_guillotine_into,
    round_board_feet,
};

const EPS: f64 = 1e-6;

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
                let plan = plan_sheets(material, size.l, size.w, &group, config.kerf, &config.offcuts);
                sheet_stock.push(board_feet(size.l, size.w, material.thickness, plan.sheet_count as u32));
                sheets.push(plan);
            }
            (MaterialType::Lumber | MaterialType::Round, _) => {
                // Round stock comes in sticks and is cross-cut to length, exactly like lumber.
                let plan = plan_lumber(material, &group, config.kerf, &config.offcuts);
                lumber_stock.push(stick_board_feet(material, &group, &plan));
                lumber.push(plan);
            }
            _ => {}
        }
    }

    let mut hardware = compute_hardware_in(spec, config.units);
    for row in &mut hardware {
        if let Some(&price) = config
            .hardware_prices
            .get(&row.key)
            .filter(|p| p.is_finite() && **p >= 0.0)
        {
            row.unit_price = Some(price);
            row.cost = Some(price * f64::from(row.qty));
        }
    }
    let totals = totals_of(
        &parts,
        &sheets,
        &lumber,
        &[sheet_stock, lumber_stock].concat(),
        &hardware,
    );
    CutList {
        parts,
        sheets,
        lumber,
        hardware,
        totals,
    }
}

/// Board feet of stick stock a lumber plan buys; board width is `stockWidth`, else the widest
/// part cut from it.
fn stick_board_feet(material: &Material, parts: &[&Part], plan: &LumberPlan) -> f64 {
    let length: f64 = (0..plan.stick_count).map(|i| plan.board_length(i)).sum();
    if material.kind == MaterialType::Round {
        return round_board_feet(length, material.thickness, 1);
    }
    let width = material
        .stock_width
        .unwrap_or_else(|| parts.iter().map(|p| p.size.w).fold(f64::NEG_INFINITY, f64::max));
    board_feet(length, width, material.thickness, 1)
}

/// The user's offcuts of `material`, smallest first, so small pieces use them up before large ones.
fn offcuts_of<'a>(material: &Material, offcuts: &'a [Offcut], sheet: bool) -> Vec<&'a Offcut> {
    let mut mine: Vec<&Offcut> = offcuts
        .iter()
        .filter(|o| o.is(material) && o.l > 0.0 && (!sheet || o.w.is_some_and(|w| w > 0.0)))
        .collect();
    mine.sort_by(|a, b| {
        let size = |o: &Offcut| o.l * o.w.unwrap_or(1.0);
        size(a).total_cmp(&size(b)).then_with(|| a.id.cmp(&b.id))
    });
    mine
}

fn used(offcuts: &[&Offcut], indices: &[usize], sheet: bool) -> Vec<UsedOffcut> {
    indices
        .iter()
        .map(|&i| UsedOffcut {
            id: offcuts[i].id.clone(),
            l: offcuts[i].l,
            w: if sheet { offcuts[i].w } else { None },
        })
        .collect()
}

fn plan_sheets(
    material: &Material,
    sheet_l: f64,
    sheet_w: f64,
    parts: &[&Part],
    kerf: f64,
    offcuts: &[Offcut],
) -> SheetPlan {
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

    let mine = offcuts_of(material, offcuts, true);
    let bins: Vec<(f64, f64)> = mine.iter().map(|o| (o.l, o.w.unwrap_or(0.0))).collect();
    let packed = pack_guillotine_into(items, &bins, sheet_l, sheet_w, kerf);
    let offcut_area: f64 = packed.offcuts_used.iter().map(|&i| bins[i].0 * bins[i].1).sum();
    let allocated = packed.sheet_count as f64 * sheet_l * sheet_w + offcut_area;
    SheetPlan {
        material_id: material.id.clone(),
        material_name: material.name.clone(),
        sheet_size: SheetSize { l: sheet_l, w: sheet_w },
        sheet_count: packed.sheet_count,
        waste: if allocated > 0.0 {
            1.0 - packed.used_area / allocated
        } else {
            0.0
        },
        cost: material.cost_per_sheet.map(|c| packed.sheet_count as f64 * c),
        offcuts: used(&mine, &packed.offcuts_used, true),
        cuts: (0..packed.sheet_count + packed.offcuts_used.len())
            .flat_map(|n| {
                let (l, w) = match n.checked_sub(packed.sheet_count) {
                    Some(i) => bins[packed.offcuts_used[i]],
                    None => (sheet_l, sheet_w),
                };
                sequence::sheet_cuts(&packed.placements, n, l, w, kerf)
            })
            .collect(),
        leftovers: packed.leftovers,
        placements: packed.placements,
    }
}

fn plan_lumber(material: &Material, parts: &[&Part], kerf: f64, offcuts: &[Offcut]) -> LumberPlan {
    // The lengths on sale, longest first.
    let mut listed: Vec<f64> = match material.stock_lengths.as_deref() {
        Some(lengths) if !lengths.is_empty() => lengths.to_vec(),
        _ => vec![DEFAULT_STOCK_LENGTH],
    };
    listed.sort_by(|a, b| b.total_cmp(a));
    listed.dedup();

    let mut items = Vec::new();
    for part in parts {
        for _ in 0..part.qty() {
            items.push(LumberItem {
                part_id: part.id.clone(),
                name: part.name.clone(),
                length: part.size.l,
                width: part.size.w,
            });
        }
    }

    let mine = offcuts_of(material, offcuts, false);
    let bins: Vec<f64> = mine.iter().map(|o| o.l).collect();
    // Round stock is never ripped.
    let stock_width = material.stock_width.filter(|_| material.kind != MaterialType::Round);
    let (packed, lengths) = pack_lengths(&items, &bins, &listed, stock_width, kerf);
    // The longest board bought; with none bought, the longest on sale.
    let stock_length = if lengths.is_empty() {
        listed[0]
    } else {
        lengths.iter().copied().fold(0.0, f64::max)
    };
    let offcut_length: f64 = packed.offcuts_used.iter().map(|&i| bins[i]).sum();
    let allocated = lengths.iter().sum::<f64>() + offcut_length;
    // Only what comes off bought boards costs anything; the user's offcuts are already paid for.
    let piece_bf = |p: &Part, qty: u32| {
        if material.kind == MaterialType::Round {
            round_board_feet(p.size.l, material.thickness, qty)
        } else {
            board_feet(p.size.l, p.size.w, material.thickness, qty)
        }
    };
    let all_bf: f64 = parts.iter().map(|p| piece_bf(p, p.qty())).sum();
    let offcut_bf: f64 = packed
        .cuts
        .iter()
        .filter(|c| c.stick >= packed.stick_count)
        .filter_map(|c| parts.iter().find(|p| p.id == c.part_id))
        .map(|p| piece_bf(p, 1))
        .sum();
    let bought_bf = all_bf - offcut_bf;
    LumberPlan {
        material_id: material.id.clone(),
        material_name: material.name.clone(),
        stock_length,
        stock_width,
        stick_count: packed.stick_count,
        board_lengths: if lengths.iter().all(|&l| l == stock_length) {
            Vec::new()
        } else {
            lengths
        },
        // An oversized part would read as negative waste; the linter errors it, this floors at 0.
        waste: if allocated > 0.0 {
            (1.0 - packed.used_length / allocated).max(0.0)
        } else {
            0.0
        },
        cost: material.cost_per_board_foot.map(|c| bought_bf * c),
        offcuts: used(&mine, &packed.offcuts_used, false),
        leftovers: packed.leftovers,
        cuts: packed.cuts,
    }
}

/// Packs the boards at each listed length (longest first) and cuts every board from the shortest
/// listed length its cuts fit, keeping the packing that buys the least length in all, then the
/// fewest boards, then uses the fewest pieces on hand. A tie keeps the longest length, as before
/// lengths were mixed. Returns the packing and each bought board's length.
fn pack_lengths(
    items: &[LumberItem],
    bins: &[f64],
    listed: &[f64],
    stock_width: Option<f64>,
    kerf: f64,
) -> (PackedLumber, Vec<f64>) {
    let longest_part = items.iter().map(|i| i.length).fold(0.0, f64::max);
    let mut best: Option<(f64, PackedLumber, Vec<f64>)> = None;
    for (k, &length) in listed.iter().enumerate() {
        // A part too long for every length is still packed on the longest (the linter flags it).
        if k > 0 && longest_part > length + EPS {
            break;
        }
        let mut packed = pack_boards_into(items.to_vec(), bins, length, stock_width, kerf);
        let lengths: Vec<f64> = (0..packed.stick_count)
            .map(|b| {
                let end = packed
                    .cuts
                    .iter()
                    .filter(|c| c.stick == b)
                    .map(|c| c.x + c.length)
                    .fold(0.0, f64::max);
                listed
                    .iter()
                    .copied()
                    .filter(|&l| l <= length && l >= end - EPS)
                    .fold(length, f64::min)
            })
            .collect();
        // A shortened board's leftover ends where the board does now.
        packed.leftovers.retain_mut(|left| {
            if let Some(&l) = lengths.get(left.sheet) {
                left.l = l - left.x;
            }
            left.l >= KEEP_BOARD - EPS
        });
        let total: f64 = lengths.iter().sum();
        let better = best.as_ref().is_none_or(|(t, p, _)| {
            total < t - EPS
                || (total <= t + EPS
                    && (packed.stick_count, packed.offcuts_used.len()) < (p.stick_count, p.offcuts_used.len()))
        });
        if better {
            best = Some((total, packed, lengths));
        }
    }
    let (_, packed, lengths) = best.expect("at least one length is listed");
    (packed, lengths)
}

fn totals_of(
    parts: &[PartRow],
    sheets: &[SheetPlan],
    lumber: &[LumberPlan],
    allocated_bf: &[f64],
    hardware: &[HardwareRow],
) -> CutListTotals {
    let board_feet_total = parts.iter().map(|p| p.board_feet).sum();
    let sheet_count = sheets.iter().map(|s| s.sheet_count).sum();

    let costs: Vec<Option<f64>> = sheets
        .iter()
        .map(|p| p.cost)
        .chain(lumber.iter().map(|p| p.cost))
        .collect();
    let material_cost: Option<f64> = costs
        .iter()
        .any(Option::is_some)
        .then(|| costs.iter().map(|c| c.unwrap_or(0.0)).sum());
    let hardware_cost: Option<f64> = hardware
        .iter()
        .any(|h| h.cost.is_some())
        .then(|| hardware.iter().filter_map(|h| h.cost).sum());
    let estimated_cost = match (material_cost, hardware_cost) {
        (None, None) => None,
        (m, h) => Some(m.unwrap_or(0.0) + h.unwrap_or(0.0)),
    };

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
        material_cost,
        hardware_cost,
        waste_percent: if allocated > 0.0 { offcut / allocated } else { 0.0 },
    }
}
