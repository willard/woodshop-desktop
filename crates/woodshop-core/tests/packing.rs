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
                    a.x >= -1e-9 && a.y >= -1e-9 && a.x + a.length <= plan.stock_length + 1e-6,
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
                assert!((left.x + left.l - plan.stock_length).abs() < 1e-6, "{}: {left:?}", t.id);
            }
        }
    }
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
