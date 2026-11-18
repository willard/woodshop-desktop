//! Every layout the packer makes can be cut: each piece once, inside its sheet, never overlapping
//! another or its saw kerf.
use woodshop_core::cutlist::{CutListConfig, compute_cut_list};

const KERF: f64 = 0.125;

#[test]
fn every_template_packs_into_layouts_that_can_be_cut() {
    for t in woodshop_core::templates::all() {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let list = compute_cut_list(&spec, CutListConfig::default());
        for plan in &list.sheets {
            let pieces: u32 = spec
                .parts
                .iter()
                .filter(|p| p.material_id == plan.material_id)
                .map(|p| p.qty())
                .sum();
            assert_eq!(
                plan.placements.len(),
                pieces as usize,
                "{}: every piece placed once",
                t.id
            );
            for (i, a) in plan.placements.iter().enumerate() {
                assert!(a.sheet < plan.sheet_count, "{}: {a:?}", t.id);
                assert!(
                    a.x >= -1e-9
                        && a.y >= -1e-9
                        && a.x + a.w <= plan.sheet_size.l + 1e-6
                        && a.y + a.h <= plan.sheet_size.w + 1e-6,
                    "{}: {a:?} off the sheet",
                    t.id
                );
                for b in &plan.placements[i + 1..] {
                    let apart = a.sheet != b.sheet
                        || a.x + a.w + KERF <= b.x + 1e-6
                        || b.x + b.w + KERF <= a.x + 1e-6
                        || a.y + a.h + KERF <= b.y + 1e-6
                        || b.y + b.h + KERF <= a.y + 1e-6;
                    assert!(apart, "{}: {a:?} overlaps {b:?}", t.id);
                }
            }
        }
    }
}

#[test]
fn another_packing_rule_is_used_when_it_saves_a_sheet() {
    // The nightstand's birch used to take three sheets in all; another rule fits the 3/4" on one.
    let spec = woodshop_core::templates::find("nightstand").unwrap();
    let list = compute_cut_list(&spec, CutListConfig::default());
    assert_eq!(list.totals.sheet_count, 2);
}

#[test]
fn leftovers_are_real_pieces_clear_of_every_part() {
    let apart = |(ax, ay, aw, ah): (f64, f64, f64, f64), (bx, by, bw, bh): (f64, f64, f64, f64)| {
        ax + aw <= bx + 1e-6 || bx + bw <= ax + 1e-6 || ay + ah <= by + 1e-6 || by + bh <= ay + 1e-6
    };
    for t in woodshop_core::templates::all() {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let list = compute_cut_list(&spec, CutListConfig::default());
        for plan in &list.sheets {
            for (i, left) in plan.leftovers.iter().enumerate() {
                let w = left.w.expect("a sheet leftover has a width");
                let rect = (left.x, left.y, left.l, w);
                // Big enough to keep, on the sheet, clear of every part and every other leftover.
                assert!(
                    left.l.max(w) >= 12.0 - 1e-9 && left.l.min(w) >= 6.0 - 1e-9,
                    "{}: {left:?}",
                    t.id
                );
                assert!(left.sheet < plan.sheet_count, "{}: {left:?}", t.id);
                assert!(
                    left.x + left.l <= plan.sheet_size.l + 1e-6 && left.y + w <= plan.sheet_size.w + 1e-6,
                    "{}: {left:?}",
                    t.id
                );
                for p in plan.placements.iter().filter(|p| p.sheet == left.sheet) {
                    assert!(apart(rect, (p.x, p.y, p.w, p.h)), "{}: {left:?} on {p:?}", t.id);
                }
                for other in plan.leftovers[i + 1..].iter().filter(|o| o.sheet == left.sheet) {
                    assert!(apart(rect, (other.x, other.y, other.l, other.w.unwrap())), "{}", t.id);
                }
            }
        }
    }
}

#[test]
fn every_board_layout_can_be_cut() {
    for t in woodshop_core::templates::all() {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let list = compute_cut_list(&spec, CutListConfig::default());
        for plan in &list.lumber {
            let width = |id: &str| list.parts.iter().find(|p| p.part_id == id).unwrap().width;
            let pieces: u32 = spec
                .parts
                .iter()
                .filter(|p| p.material_id == plan.material_id)
                .map(|p| p.qty())
                .sum();
            assert_eq!(plan.cuts.len(), pieces as usize, "{}: every piece cut once", t.id);
            for (i, a) in plan.cuts.iter().enumerate() {
                assert!(a.stick < plan.stick_count, "{}: {a:?}", t.id);
                assert!(
                    a.x >= -1e-9 && a.y >= -1e-9 && a.x + a.length <= plan.board_length(a.stick) + 1e-6,
                    "{}: {a:?} off the board",
                    t.id
                );
                if a.y > 0.0 {
                    let sw = plan.stock_width.expect("only a board of known width is ripped");
                    assert!(a.y + width(&a.part_id) <= sw + 1e-6, "{}: {a:?} off the board", t.id);
                }
                for b in &plan.cuts[i + 1..] {
                    let apart = a.stick != b.stick
                        || a.x + a.length + KERF <= b.x + 1e-6
                        || b.x + b.length + KERF <= a.x + 1e-6
                        || a.y + width(&a.part_id) + KERF <= b.y + 1e-6
                        || b.y + width(&b.part_id) + KERF <= a.y + 1e-6;
                    assert!(apart, "{}: {a:?} overlaps {b:?}", t.id);
                }
            }
            // A board end worth keeping starts past every cut on its board.
            for left in &plan.leftovers {
                let end = plan
                    .cuts
                    .iter()
                    .filter(|c| c.stick == left.sheet)
                    .map(|c| c.x + c.length)
                    .fold(0.0, f64::max);
                assert!(
                    left.x >= end - 1e-6 && left.l >= 12.0 - 1e-9 && left.w.is_none(),
                    "{}: {left:?}",
                    t.id
                );
                assert!(
                    (left.x + left.l - plan.board_length(left.sheet)).abs() < 1e-6,
                    "{}: {left:?}",
                    t.id
                );
            }
        }
    }
}

#[test]
fn a_ripped_board_is_crosscut_to_length_then_ripped() {
    let spec = woodshop_core::templates::find("kitchen-cart").unwrap();
    let list = compute_cut_list(&spec, CutListConfig::default());
    let legs = list.lumber.iter().find(|p| p.material_name.contains("8/4")).unwrap();
    let cuts: Vec<(bool, f64)> = legs.saw_cuts.iter().map(|c| (c.rip, c.off)).collect();
    assert!(!cuts[0].0, "{cuts:?}");
    assert!(cuts.iter().any(|c| c.0), "{cuts:?}");
}

#[test]
fn narrow_parts_are_ripped_side_by_side_when_it_saves_a_board() {
    // The kitchen cart's 1 1/2" maple legs fit two across a 3 1/2" board.
    let spec = woodshop_core::templates::find("kitchen-cart").unwrap();
    let list = compute_cut_list(&spec, CutListConfig::default());
    let maple = list
        .lumber
        .iter()
        .find(|p| p.material_name.starts_with("Maple"))
        .unwrap();
    assert_eq!(maple.stick_count, 1);
    assert!(maple.cuts.iter().any(|c| c.y > 0.0));
    // And the rest of the board is left in one piece, full width, to keep.
    assert_eq!(maple.leftovers.len(), 1);

    // With no board width given, nothing is ripped.
    let mut plain = spec.clone();
    for m in &mut plain.materials {
        m.stock_width = None;
    }
    let list = compute_cut_list(&plain, CutListConfig::default());
    let maple = list
        .lumber
        .iter()
        .find(|p| p.material_name.starts_with("Maple"))
        .unwrap();
    assert_eq!(maple.stick_count, 2);
    assert!(maple.cuts.iter().all(|c| c.y == 0.0));
}

#[test]
fn each_board_is_the_shortest_length_its_cuts_fit() {
    // The kitchen cart's rails (four 25" and four 15") from 1x4 sold at 72" and 96": one 96" board
    // takes three 25" and a 15", and the rest fit a 72" board. All on 72" would take three boards.
    let mut spec = woodshop_core::templates::find("kitchen-cart").unwrap();
    for m in spec.materials.iter_mut().filter(|m| m.name == "Maple 1x4") {
        m.stock_lengths = Some(vec![72.0, 96.0]);
    }
    let list = compute_cut_list(&spec, CutListConfig::default());
    let rails = list.lumber.iter().find(|p| p.material_name == "Maple 1x4").unwrap();
    assert_eq!(rails.board_lengths, vec![96.0, 72.0]);
    assert_eq!(rails.bought(), vec![(96.0, 1), (72.0, 1)]);
    assert_eq!(rails.stock_length, 96.0);
    // The material's stock line says so.
    let sections = woodshop_core::cutlist::group_cut_list(&list);
    let stock = sections
        .iter()
        .find(|s| s.material_name == "Maple 1x4")
        .and_then(|s| s.stock.clone())
        .unwrap();
    let lengths: Vec<_> = stock.lengths.iter().map(|c| (c.count, c.l)).collect();
    assert_eq!((stock.count, lengths), (2, vec![(1, 96.0), (1, 72.0)]));

    // Sold only at 96", nothing changes: no lengths are listed per board.
    let template = woodshop_core::templates::find("kitchen-cart").unwrap();
    let list = compute_cut_list(&template, CutListConfig::default());
    let rails = list.lumber.iter().find(|p| p.material_name == "Maple 1x4").unwrap();
    assert!(rails.board_lengths.is_empty());
    assert_eq!(rails.bought(), vec![(96.0, 2)]);
}

#[test]
fn a_board_is_not_bought_longer_than_its_cuts_need() {
    // The picnic table's 2x4s are sold at 96" and 120"; every board's cuts fit 96".
    let spec = woodshop_core::templates::find("picnic-table").unwrap();
    let list = compute_cut_list(&spec, CutListConfig::default());
    let two_by_four = list.lumber.iter().find(|p| p.material_name.starts_with("2x4")).unwrap();
    assert_eq!(two_by_four.bought(), vec![(96.0, 3)]);
}

#[test]
fn the_cut_order_frees_every_part_on_every_template_sheet() {
    // At the end every part must sit alone on a piece of exactly its size.
    // With the sheets' edges trimmed first, the cuts start from the trimmed sheet.
    for (t, trim) in woodshop_core::templates::all()
        .iter()
        .flat_map(|t| [(t, 0.0), (t, 0.25)])
    {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let config = CutListConfig {
            sheet_trim: trim,
            ..CutListConfig::default()
        };
        let list = compute_cut_list(&spec, config);
        for plan in &list.sheets {
            let (l, w) = (plan.sheet_size.l - 2.0 * plan.trim, plan.sheet_size.w - 2.0 * plan.trim);
            for sheet in 0..plan.sheet_count {
                let cuts: Vec<_> = plan.cuts.iter().filter(|c| c.sheet == sheet).collect();
                let pieces = make_cuts(t.id, &cuts, (plan.trim, plan.trim, l, w));
                for p in plan.placements.iter().filter(|p| p.sheet == sheet) {
                    let freed = pieces.iter().any(|&(x, y, l, w)| {
                        (p.x - x).abs() < 1e-6
                            && (p.y - y).abs() < 1e-6
                            && (p.w - l).abs() < 1e-6
                            && (p.h - w).abs() < 1e-6
                    });
                    assert!(freed, "{}: {p:?} is not cut free", t.id);
                }
            }
        }
    }
}

/// Makes `cuts` in order on a piece (x, y, length, width), each on the piece it crosses edge to
/// edge, and returns the pieces left.
fn make_cuts(
    id: &str,
    cuts: &[&woodshop_core::cutlist::SawCut],
    piece: (f64, f64, f64, f64),
) -> Vec<(f64, f64, f64, f64)> {
    let mut pieces = vec![piece];
    for (i, c) in cuts.iter().enumerate() {
        assert_eq!(c.n as usize, i + 1, "{id}: cuts numbered in order");
        let at = pieces.iter().position(|&(x, y, l, w)| {
            if c.rip {
                (c.x - x).abs() < 1e-6 && (c.l - l).abs() < 1e-6 && c.y > y && c.y < y + w
            } else {
                (c.y - y).abs() < 1e-6 && (c.l - w).abs() < 1e-6 && c.x > x && c.x < x + l
            }
        });
        let (x, y, l, w) = pieces.remove(at.unwrap_or_else(|| panic!("{id}: {c:?} crosses no piece")));
        let off = if c.rip { c.y - y } else { c.x - x };
        assert!((c.off - off).abs() < 1e-6, "{id}: {c:?} fence setting");
        if c.rip {
            pieces.push((x, y, l, c.y - y));
            pieces.push((x, c.y + KERF, l, y + w - c.y - KERF));
        } else {
            pieces.push((x, y, c.x - x, w));
            pieces.push((c.x + KERF, y, x + l - c.x - KERF, w));
        }
    }
    pieces
}

#[test]
fn the_cut_order_frees_every_piece_on_every_template_board() {
    for t in woodshop_core::templates::all() {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let list = compute_cut_list(&spec, CutListConfig::default());
        for plan in &list.lumber {
            let width = |id: &str| spec.parts.iter().find(|p| p.id == id).unwrap().size.w;
            for board in 0..plan.stick_count {
                let on_board: Vec<_> = plan.cuts.iter().filter(|c| c.stick == board).collect();
                let across = plan
                    .stock_width
                    .unwrap_or_else(|| on_board.iter().map(|c| width(&c.part_id)).fold(0.0, f64::max));
                let cuts: Vec<_> = plan.saw_cuts.iter().filter(|c| c.sheet == board).collect();
                let pieces = make_cuts(t.id, &cuts, (0.0, 0.0, plan.board_length(board), across));
                for c in &on_board {
                    let w = width(&c.part_id).min(across - c.y);
                    let freed = pieces.iter().any(|&(x, y, l, pw)| {
                        (c.x - x).abs() < 1e-6
                            && (c.y - y).abs() < 1e-6
                            && (c.length - l).abs() < 1e-6
                            && (w - pw).abs() < 1e-6
                    });
                    assert!(freed, "{}: {c:?} is not cut free", t.id);
                }
            }
        }
    }
}

#[test]
fn trimmed_sheets_keep_every_part_and_leftover_inside_the_trimmed_edges() {
    let mut trimmed = 0;
    for t in woodshop_core::templates::all() {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let plain = compute_cut_list(&spec, CutListConfig::default());
        let config = CutListConfig {
            sheet_trim: 0.5,
            ..CutListConfig::default()
        };
        let list = compute_cut_list(&spec, config);
        for (plan, before) in list.sheets.iter().zip(&plain.sheets) {
            assert_eq!(
                plan.placements.len(),
                before.placements.len(),
                "{}: every piece placed",
                t.id
            );
            assert!(plan.sheet_count >= before.sheet_count, "{}", t.id);
            if plan.trim == 0.0 {
                continue;
            }
            trimmed += 1;
            let (lo, hi_l, hi_w) = (
                0.5 - 1e-6,
                plan.sheet_size.l - 0.5 + 1e-6,
                plan.sheet_size.w - 0.5 + 1e-6,
            );
            for p in &plan.placements {
                assert!(
                    p.x >= lo && p.y >= lo && p.x + p.w <= hi_l && p.y + p.h <= hi_w,
                    "{}: {p:?} in the trimmed border",
                    t.id
                );
            }
            for l in &plan.leftovers {
                let w = l.w.unwrap_or(0.0);
                assert!(
                    l.x >= lo && l.y >= lo && l.x + l.l <= hi_l && l.y + w <= hi_w,
                    "{}: {l:?} in the trimmed border",
                    t.id
                );
            }
        }
    }
    assert!(trimmed > 10, "most sheet plans take the trim ({trimmed})");
}

#[test]
fn a_part_as_big_as_the_sheet_keeps_the_factory_edges() {
    // A part the size of the whole sheet: trimming would leave it no room.
    let mut spec = woodshop_core::templates::find("bookshelf").unwrap();
    let sheet = spec.materials.iter().find(|m| m.sheet_size.is_some()).unwrap().clone();
    let size = sheet.sheet_size.unwrap();
    let part = spec
        .parts
        .iter_mut()
        .find(|p| p.material_id == sheet.id && p.grain_axis() != woodshop_core::spec::GrainAxis::W)
        .unwrap();
    let id = part.id.clone();
    part.size.l = size.l;
    part.size.w = size.w;
    let config = CutListConfig {
        sheet_trim: 0.25,
        ..CutListConfig::default()
    };
    let list = compute_cut_list(&spec, config);
    let plan = list.sheets.iter().find(|p| p.material_id == sheet.id).unwrap();
    assert_eq!(plan.trim, 0.0);
    assert!(
        plan.placements
            .iter()
            .any(|p| p.part_id == id && p.w * p.h == size.l * size.w)
    );
}
