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
