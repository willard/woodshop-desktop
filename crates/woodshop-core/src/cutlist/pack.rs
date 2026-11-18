//! Deterministic packers: 2D guillotine for sheet goods, 1D first-fit-decreasing for sticks. The
//! same spec always packs the same way.

use std::cmp::Ordering;

use super::types::{Leftover, LumberCut, Placement};

const EPS: f64 = 1e-6;

/// The smallest sheet leftover worth keeping: this long on one side and wide on the other.
pub const KEEP_LONG: f64 = 12.0;
pub const KEEP_SHORT: f64 = 6.0;
/// The shortest board leftover worth keeping.
pub const KEEP_BOARD: f64 = 12.0;

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
    /// Pieces worth keeping once the parts are cut out, on the sheets as numbered above.
    #[serde(skip)]
    pub leftovers: Vec<Leftover>,
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

/// Which free space a piece goes into.
#[derive(Clone, Copy)]
enum Choice {
    /// The first that fits.
    First,
    /// The one leaving the least on the tighter side.
    BestShortSide,
    /// The one leaving the least area.
    BestArea,
}

/// How the space left around a placed piece is cut in two (both are table-saw cuts).
#[derive(Clone, Copy)]
enum Split {
    /// A strip across the full width above the piece, the rest beside it.
    Across,
    /// A strip the full height beside the piece, the rest above it.
    Along,
    /// Along the side with less left over.
    Shorter,
    /// Along the side with more left over.
    Longer,
}

/// Largest longer side first, then area, then part id.
fn order_by_side(a: &SheetItem, b: &SheetItem) -> Ordering {
    let (side_a, side_b) = (a.w.max(a.h), b.w.max(b.h));
    if (side_a - side_b).abs() > EPS {
        return side_b.partial_cmp(&side_a).unwrap_or(Ordering::Equal);
    }
    order(a, b)
}

/// Packs onto `offcuts` (length, width) first, in the order given, then onto new sheets.
///
/// Several first-fit rules are tried and the one buying the fewest sheets (then using the fewest
/// offcuts) wins; on a tie the first rule, the long-standing one, is kept, so a layout only changes
/// when another saves stock.
pub fn pack_guillotine_into(
    items: Vec<SheetItem>,
    offcuts: &[(f64, f64)],
    sheet_l: f64,
    sheet_w: f64,
    kerf: f64,
) -> PackedSheets {
    let keep = |r: &FreeRect| r.w.max(r.h) >= KEEP_LONG - EPS && r.w.min(r.h) >= KEEP_SHORT - EPS;
    pack_best(items, offcuts, sheet_l, sheet_w, kerf, &keep, false)
}

/// The best of every rule's layout, as described on [`pack_guillotine_into`]; `keep` says which
/// free rects are leftovers. With `most_kept`, a tie goes to the layout leaving the most to keep.
fn pack_best(
    items: Vec<SheetItem>,
    offcuts: &[(f64, f64)],
    sheet_l: f64,
    sheet_w: f64,
    kerf: f64,
    keep: &dyn Fn(&FreeRect) -> bool,
    most_kept: bool,
) -> PackedSheets {
    let kept = |p: &PackedSheets| p.leftovers.iter().map(|l| l.l * l.w.unwrap_or(0.0)).sum::<f64>();
    let mut by_area = items;
    by_area.sort_by(order);
    let mut by_side: Vec<&SheetItem> = by_area.iter().collect();
    by_side.sort_by(|a, b| order_by_side(a, b));
    let by_area: Vec<&SheetItem> = by_area.iter().collect();

    let mut best: Option<PackedSheets> = None;
    for items in [&by_area, &by_side] {
        for choice in [Choice::First, Choice::BestShortSide, Choice::BestArea] {
            for split in [Split::Across, Split::Along, Split::Shorter, Split::Longer] {
                let packed = pack_with(items, offcuts, (sheet_l, sheet_w), kerf, (choice, split), keep);
                let better = best.as_ref().is_none_or(|b| {
                    let (now, was) = (
                        (packed.sheet_count, packed.offcuts_used.len()),
                        (b.sheet_count, b.offcuts_used.len()),
                    );
                    now < was || (most_kept && now == was && kept(&packed) > kept(b) + EPS)
                });
                if better {
                    best = Some(packed);
                }
            }
        }
    }
    best.expect("at least one rule runs")
}

fn pack_with(
    items: &[&SheetItem],
    offcuts: &[(f64, f64)],
    (sheet_l, sheet_w): (f64, f64),
    kerf: f64,
    (choice, split): (Choice, Split),
    keep: &dyn Fn(&FreeRect) -> bool,
) -> PackedSheets {
    let mut sheets: Vec<Vec<FreeRect>> = offcuts
        .iter()
        .map(|&(w, h)| vec![FreeRect { x: 0.0, y: 0.0, w, h }])
        .collect();
    let mut placements = Vec::new();
    let mut used_area = 0.0;

    for item in items {
        let placed = (0..sheets.len()).any(|s| place(item, &mut sheets[s], s, kerf, choice, split, &mut placements));
        if !placed {
            sheets.push(vec![FreeRect {
                x: 0.0,
                y: 0.0,
                w: sheet_l,
                h: sheet_w,
            }]);
            let s = sheets.len() - 1;
            place(item, &mut sheets[s], s, kerf, choice, split, &mut placements);
        }
        used_area += item.w * item.h;
    }

    // New sheets first, numbered from 0; then the offcuts that were used.
    let fixed = offcuts.len();
    let sheet_count = sheets.len() - fixed;
    let offcuts_used: Vec<usize> = (0..fixed)
        .filter(|&b| placements.iter().any(|p| p.sheet == b))
        .collect();
    let renumber = |s: usize| {
        if s >= fixed {
            Some(s - fixed)
        } else {
            offcuts_used.iter().position(|&b| b == s).map(|i| sheet_count + i)
        }
    };
    for p in &mut placements {
        p.sheet = renumber(p.sheet).unwrap_or(0);
    }
    // The free space left on every sheet cut into, as the separate pieces the guillotine cuts make.
    let mut leftovers: Vec<Leftover> = sheets
        .iter()
        .enumerate()
        .filter_map(|(s, free)| renumber(s).map(|n| (n, free)))
        .flat_map(|(sheet, free)| {
            free.iter().filter(|r| keep(r)).map(move |r| Leftover {
                sheet,
                x: r.x,
                y: r.y,
                l: r.w,
                w: Some(r.h),
            })
        })
        .collect();
    leftovers.sort_by_key(|l| l.sheet);
    PackedSheets {
        sheet_count,
        offcuts_used,
        placements,
        used_area,
        leftovers,
    }
}

/// Places `item` in one of a sheet's free rects, chosen by `choice`, and splits what is left.
fn place(
    item: &SheetItem,
    free: &mut Vec<FreeRect>,
    sheet: usize,
    kerf: f64,
    choice: Choice,
    split: Split,
    out: &mut Vec<Placement>,
) -> bool {
    let mut pick: Option<(usize, f64, f64, bool, f64)> = None;
    for (i, rect) in free.iter().enumerate() {
        for (w, h, rotated) in orientations(item, rect) {
            let score = match choice {
                Choice::First => 0.0,
                Choice::BestShortSide => (rect.w - w).min(rect.h - h),
                Choice::BestArea => rect.w * rect.h - w * h,
            };
            if pick.is_none_or(|(.., best)| score < best - EPS) {
                pick = Some((i, w, h, rotated, score));
            }
        }
        if matches!(choice, Choice::First) && pick.is_some() {
            break;
        }
    }
    let Some((i, w, h, rotated, _)) = pick else {
        return false;
    };
    let rect = free[i];
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
    let (left_w, left_h) = (rect.w - w - kerf, rect.h - h - kerf);
    let across = match split {
        Split::Across => true,
        Split::Along => false,
        Split::Shorter => left_w < left_h,
        Split::Longer => left_w >= left_h,
    };
    // Two offcuts separated by the kerf: one spans the rect's full width (across) or full height.
    let (top, right) = if across {
        (
            FreeRect {
                x: rect.x,
                y: rect.y + h + kerf,
                w: rect.w,
                h: left_h,
            },
            FreeRect {
                x: rect.x + w + kerf,
                y: rect.y,
                w: left_w,
                h,
            },
        )
    } else {
        (
            FreeRect {
                x: rect.x,
                y: rect.y + h + kerf,
                w,
                h: left_h,
            },
            FreeRect {
                x: rect.x + w + kerf,
                y: rect.y,
                w: left_w,
                h: rect.h,
            },
        )
    };
    free.remove(i);
    if top.w > EPS && top.h > EPS {
        free.push(top);
    }
    if right.w > EPS && right.h > EPS {
        free.push(right);
    }
    true
}

/// The ways `item` fits `rect`: as it is first, then turned if it may be.
fn orientations(item: &SheetItem, rect: &FreeRect) -> Vec<(f64, f64, bool)> {
    let mut out = Vec::with_capacity(2);
    if item.w <= rect.w + EPS && item.h <= rect.h + EPS {
        out.push((item.w, item.h, false));
    }
    if item.rotatable && item.h <= rect.w + EPS && item.w <= rect.h + EPS {
        out.push((item.h, item.w, true));
    }
    out
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumberItem {
    pub part_id: String,
    pub name: String,
    pub length: f64,
    /// Across the board; 0 when not known, and then the part is never ripped beside another.
    #[serde(default)]
    pub width: f64,
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
    /// Board ends worth keeping, on the sticks as numbered above.
    #[serde(skip)]
    pub leftovers: Vec<Leftover>,
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
        let start = if stick < offcuts.len() {
            offcuts[stick]
        } else {
            stock_length
        };
        let x = start - remaining[stick];
        // Consume the cut plus one kerf for the saw.
        remaining[stick] -= item.length + kerf;
        used_length += item.length;
        cuts.push(LumberCut {
            part_id: item.part_id,
            name: item.name,
            length: item.length,
            stick,
            x,
            y: 0.0,
        });
    }

    let fixed = offcuts.len();
    let stick_count = remaining.len() - fixed;
    let offcuts_used: Vec<usize> = (0..fixed).filter(|&b| cuts.iter().any(|c| c.stick == b)).collect();
    let renumber = |s: usize| {
        if s >= fixed {
            Some(s - fixed)
        } else {
            offcuts_used.iter().position(|&b| b == s).map(|i| stick_count + i)
        }
    };
    for c in &mut cuts {
        c.stick = renumber(c.stick).unwrap_or(0);
    }
    let mut leftovers: Vec<Leftover> = remaining
        .iter()
        .enumerate()
        .filter(|&(_, &left)| left >= KEEP_BOARD - EPS)
        .filter_map(|(s, &left)| {
            // The cut-off end of the board.
            let start = if s < fixed { offcuts[s] } else { stock_length } - left;
            renumber(s).map(|sheet| Leftover {
                sheet,
                x: start,
                y: 0.0,
                l: left,
                w: None,
            })
        })
        .collect();
    leftovers.sort_by_key(|l| l.sheet);
    PackedLumber {
        stick_count,
        offcuts_used,
        leftovers,
        cuts,
        used_length,
    }
}

/// Like [`pack_lumber_into`], but where the board width is known and narrow parts can be ripped
/// side by side, lays the boards out as strips (crosscuts and rips, grain along the board) and
/// keeps that layout when it buys fewer boards. Offcuts are taken to be full width.
pub fn pack_boards_into(
    items: Vec<LumberItem>,
    offcuts: &[f64],
    stock_length: f64,
    stock_width: Option<f64>,
    kerf: f64,
) -> PackedLumber {
    let strips = stock_width.filter(|&sw| {
        let narrowest = items.iter().map(|i| i.width).fold(f64::INFINITY, f64::min);
        items.iter().all(|i| i.width > EPS && i.width <= sw + EPS) && 2.0 * narrowest + kerf <= sw + EPS
    });
    let Some(sw) = strips else {
        return pack_lumber_into(items, offcuts, stock_length, kerf);
    };
    let sheet_items = items
        .iter()
        .map(|i| SheetItem {
            part_id: i.part_id.clone(),
            name: i.name.clone(),
            w: i.length,
            h: i.width,
            rotatable: false,
        })
        .collect();
    let single = pack_lumber_into(items, offcuts, stock_length, kerf);
    let bins: Vec<(f64, f64)> = offcuts.iter().map(|&l| (l, sw)).collect();
    // Only a full-width end is a board worth keeping.
    let keep = |r: &FreeRect| r.w >= KEEP_BOARD - EPS && r.h >= sw - EPS;
    let ripped = pack_best(sheet_items, &bins, stock_length, sw, kerf, &keep, true);
    if (ripped.sheet_count, ripped.offcuts_used.len()) >= (single.stick_count, single.offcuts_used.len()) {
        return single;
    }
    PackedLumber {
        stick_count: ripped.sheet_count,
        offcuts_used: ripped.offcuts_used,
        // As board length, so two strips side by side count once, as one length of board would.
        used_length: ripped.used_area / sw,
        cuts: ripped
            .placements
            .into_iter()
            .map(|p| LumberCut {
                part_id: p.part_id,
                name: p.name,
                length: p.w,
                stick: p.sheet,
                x: p.x,
                y: p.y,
            })
            .collect(),
        leftovers: ripped
            .leftovers
            .into_iter()
            .map(|l| Leftover { w: None, y: 0.0, ..l })
            .collect(),
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
