//! Deterministic packers: 2D guillotine for sheet goods, 1D first-fit-decreasing for sticks. The
//! same spec always packs the same way.

use std::cmp::Ordering;

use super::types::{LumberCut, Placement};

const EPS: f64 = 1e-6;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetItem {
    pub part_id: String,
    pub name: String,
    /// Footprint along the sheet length (x).
    pub w: f64,
    /// Footprint along the sheet width (y).
    pub h: f64,
    pub rotatable: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedSheets {
    /// New sheets; placements on them come first, numbered from 0.
    pub sheet_count: usize,
    /// The given offcuts that were used, as indices into the `offcuts` passed in. Placement sheet
    /// `sheet_count + i` is offcut `offcuts_used[i]`.
    #[serde(skip)]
    pub offcuts_used: Vec<usize>,
    pub placements: Vec<Placement>,
    /// Area consumed by placed parts (excludes kerf and offcut).
    pub used_area: f64,
}

#[derive(Clone, Copy)]
struct FreeRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Largest area first, then longer side, then part id.
fn order(a: &SheetItem, b: &SheetItem) -> Ordering {
    let (area_a, area_b) = (a.w * a.h, b.w * b.h);
    if (area_a - area_b).abs() > EPS {
        return area_b.partial_cmp(&area_a).unwrap_or(Ordering::Equal);
    }
    let (side_a, side_b) = (a.w.max(a.h), b.w.max(b.h));
    if (side_a - side_b).abs() > EPS {
        return side_b.partial_cmp(&side_a).unwrap_or(Ordering::Equal);
    }
    a.part_id.cmp(&b.part_id)
}

pub fn pack_guillotine(items: Vec<SheetItem>, sheet_l: f64, sheet_w: f64, kerf: f64) -> PackedSheets {
    pack_guillotine_into(items, &[], sheet_l, sheet_w, kerf)
}

/// Packs onto `offcuts` (length, width) first, in the order given, then onto new sheets.
pub fn pack_guillotine_into(
    mut items: Vec<SheetItem>,
    offcuts: &[(f64, f64)],
    sheet_l: f64,
    sheet_w: f64,
    kerf: f64,
) -> PackedSheets {
    items.sort_by(order);
    let mut sheets: Vec<Vec<FreeRect>> = offcuts
        .iter()
        .map(|&(w, h)| vec![FreeRect { x: 0.0, y: 0.0, w, h }])
        .collect();
    let mut placements = Vec::new();
    let mut used_area = 0.0;

    for item in &items {
        let placed = (0..sheets.len()).any(|s| place(item, &mut sheets[s], s, kerf, &mut placements));
        if !placed {
            sheets.push(vec![FreeRect {
                x: 0.0,
                y: 0.0,
                w: sheet_l,
                h: sheet_w,
            }]);
            let s = sheets.len() - 1;
            place(item, &mut sheets[s], s, kerf, &mut placements);
        }
        used_area += item.w * item.h;
    }

    // New sheets first, numbered from 0; then the offcuts that were used.
    let fixed = offcuts.len();
    let sheet_count = sheets.len() - fixed;
    let offcuts_used: Vec<usize> = (0..fixed)
        .filter(|&b| placements.iter().any(|p| p.sheet == b))
        .collect();
    for p in &mut placements {
        p.sheet = if p.sheet >= fixed {
            p.sheet - fixed
        } else {
            sheet_count + offcuts_used.iter().position(|&b| b == p.sheet).unwrap_or(0)
        };
    }
    PackedSheets {
        sheet_count,
        offcuts_used,
        placements,
        used_area,
    }
}

/// First fit over the free rects, non-rotated preferred.
fn place(item: &SheetItem, free: &mut Vec<FreeRect>, sheet: usize, kerf: f64, out: &mut Vec<Placement>) -> bool {
    for i in 0..free.len() {
        let rect = free[i];
        let Some((w, h, rotated)) = fit_orientation(item, &rect) else {
            continue;
        };
        out.push(Placement {
            part_id: item.part_id.clone(),
            name: item.name.clone(),
            sheet,
            x: rect.x,
            y: rect.y,
            w,
            h,
            rotated,
        });
        // Guillotine split: a right offcut and a top offcut, separated by the kerf.
        let right = FreeRect {
            x: rect.x + w + kerf,
            y: rect.y,
            w: rect.w - w - kerf,
            h,
        };
        let top = FreeRect {
            x: rect.x,
            y: rect.y + h + kerf,
            w: rect.w,
            h: rect.h - h - kerf,
        };
        free.remove(i);
        if top.w > EPS && top.h > EPS {
            free.push(top);
        }
        if right.w > EPS && right.h > EPS {
            free.push(right);
        }
        return true;
    }
    false
}

fn fit_orientation(item: &SheetItem, rect: &FreeRect) -> Option<(f64, f64, bool)> {
    if item.w <= rect.w + EPS && item.h <= rect.h + EPS {
        return Some((item.w, item.h, false));
    }
    if item.rotatable && item.h <= rect.w + EPS && item.w <= rect.h + EPS {
        return Some((item.h, item.w, true));
    }
    None
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumberItem {
    pub part_id: String,
    pub name: String,
    pub length: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedLumber {
    /// New sticks; cuts on them come first, numbered from 0.
    pub stick_count: usize,
    /// The given offcuts that were used: cut stick `stick_count + i` is offcut `offcuts_used[i]`.
    #[serde(skip)]
    pub offcuts_used: Vec<usize>,
    pub cuts: Vec<LumberCut>,
    pub used_length: f64,
}

pub fn pack_lumber(items: Vec<LumberItem>, stock_length: f64, kerf: f64) -> PackedLumber {
    pack_lumber_into(items, &[], stock_length, kerf)
}

/// Cuts from `offcuts` (lengths) first, in the order given, then from new sticks.
pub fn pack_lumber_into(mut items: Vec<LumberItem>, offcuts: &[f64], stock_length: f64, kerf: f64) -> PackedLumber {
    items.sort_by(|a, b| {
        if (a.length - b.length).abs() > EPS {
            return b.length.partial_cmp(&a.length).unwrap_or(Ordering::Equal);
        }
        a.part_id.cmp(&b.part_id)
    });

    let mut remaining: Vec<f64> = offcuts.to_vec(); // free length left on each stick
    let mut cuts = Vec::new();
    let mut used_length = 0.0;
    for item in items {
        let stick = match remaining.iter().position(|&left| item.length <= left + EPS) {
            Some(s) => s,
            None => {
                remaining.push(stock_length);
                remaining.len() - 1
            }
        };
        // Consume the cut plus one kerf for the saw.
        remaining[stick] -= item.length + kerf;
        used_length += item.length;
        cuts.push(LumberCut {
            part_id: item.part_id,
            name: item.name,
            length: item.length,
            stick,
        });
    }

    let fixed = offcuts.len();
    let stick_count = remaining.len() - fixed;
    let offcuts_used: Vec<usize> = (0..fixed).filter(|&b| cuts.iter().any(|c| c.stick == b)).collect();
    for c in &mut cuts {
        c.stick = if c.stick >= fixed {
            c.stick - fixed
        } else {
            stick_count + offcuts_used.iter().position(|&b| b == c.stick).unwrap_or(0)
        };
    }
    PackedLumber {
        stick_count,
        offcuts_used,
        cuts,
        used_length,
    }
}

/// One board foot = 144 cubic inches.
pub fn board_feet(length: f64, width: f64, thickness: f64, qty: u32) -> f64 {
    ((thickness * width * length) / 144.0) * qty as f64
}

/// A dowel is a cylinder inside a square blank: the box volume overstates it by 4/π.
pub fn round_board_feet(length: f64, diameter: f64, qty: u32) -> f64 {
    ((std::f64::consts::PI / 4.0) * diameter * diameter * length * qty as f64) / 144.0
}
