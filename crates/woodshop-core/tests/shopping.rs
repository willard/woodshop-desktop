use std::collections::BTreeMap;

use woodshop_core::cutlist::{CutListConfig, compute_cut_list, shopping_list};
use woodshop_core::spec::Spec;

fn template(id: &str) -> Spec {
    woodshop_core::templates::find(id).unwrap()
}

fn list(specs: &[&Spec], config: &CutListConfig) -> woodshop_core::cutlist::ShoppingList {
    shopping_list(specs, config)
}

#[test]
fn one_design_buys_what_its_own_cut_list_does() {
    let spec = template("dresser");
    let alone = compute_cut_list(&spec, CutListConfig::default());
    let shop = list(&[&spec], &CutListConfig::default());
    assert_eq!(shop.totals.sheet_count, alone.totals.sheet_count);
    assert_eq!(shop.separate_sheets, alone.totals.sheet_count);
    let qty = |rows: &[woodshop_core::cutlist::HardwareRow]| {
        rows.iter().map(|h| (h.key.clone(), h.qty)).collect::<BTreeMap<_, _>>()
    };
    assert_eq!(qty(&shop.hardware), qty(&alone.hardware));
    assert!((shop.totals.board_feet - alone.totals.board_feet).abs() < 1e-9);
}

#[test]
fn the_same_material_in_two_designs_is_bought_once_and_packed_together() {
    let a = template("nightstand");
    let b = template("side-table");
    let both = list(&[&a, &b], &CutListConfig::default());
    let names = |plans: Vec<&str>| {
        let mut n: Vec<String> = plans.iter().map(|s| s.to_lowercase()).collect();
        n.sort();
        n
    };
    // No material appears twice.
    let sheet_names = names(both.sheets.iter().map(|p| p.material_name.as_str()).collect());
    let mut unique = sheet_names.clone();
    unique.dedup();
    assert_eq!(sheet_names, unique);
    // Packed together, never more than bought apart.
    assert!(both.totals.sheet_count <= both.separate_sheets);
    let sticks: usize = both.lumber.iter().map(|p| p.stick_count).sum();
    assert!(sticks <= both.separate_boards);

    // Two of the same design: every piece twice, hardware doubled, and offcuts shared.
    let twice = list(&[&a, &a], &CutListConfig::default());
    let once = list(&[&a], &CutListConfig::default());
    for (h2, h1) in twice.hardware.iter().zip(&once.hardware) {
        assert_eq!(h2.key, h1.key);
        assert_eq!(h2.qty, 2 * h1.qty, "{}", h1.key);
    }
    let placed = |l: &woodshop_core::cutlist::ShoppingList| l.sheets.iter().map(|p| p.placements.len()).sum::<usize>();
    assert_eq!(placed(&twice), 2 * placed(&once));
    assert!(twice.totals.sheet_count <= 2 * once.totals.sheet_count);
}

#[test]
fn hardware_prices_cost_the_summed_quantity() {
    let a = template("dresser");
    let plain = list(&[&a], &CutListConfig::default());
    let key = plain.hardware[0].key.clone();
    let config = CutListConfig {
        hardware_prices: BTreeMap::from([(key.clone(), 2.0)]),
        ..CutListConfig::default()
    };
    let twice = list(&[&a, &a], &config);
    let row = twice.hardware.iter().find(|h| h.key == key).unwrap();
    assert_eq!(row.cost, Some(2.0 * f64::from(row.qty)));
    assert_eq!(twice.totals.hardware_cost, row.cost);
}

#[test]
fn different_stock_is_never_merged() {
    let a = template("nightstand");
    let mut b = a.clone();
    for m in &mut b.materials {
        m.thickness += 0.25;
    }
    let both = list(&[&a, &b], &CutListConfig::default());
    let once = list(&[&a], &CutListConfig::default());
    assert_eq!(
        both.sheets.len() + both.lumber.len(),
        2 * (once.sheets.len() + once.lumber.len())
    );
}
