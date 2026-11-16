//! Edge banding (1.16): banded edges add up, per material, into banding to buy.

use serde_json::json;
use woodshop_core::cutlist::{CutListConfig, HardwareKind, compute_cut_list};
use woodshop_core::spec::{self, Spec};
use woodshop_core::units::Units;

fn shelves(edge_band: serde_json::Value, qty: u32) -> Spec {
    let raw = json!({
        "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Shelves", "units": "in",
        "materials": [{ "id": "ply", "name": "Birch Plywood", "type": "sheet", "thickness": 0.75,
            "sheetSize": { "l": 96, "w": 48 } }],
        "parts": [{ "id": "s", "name": "Shelf", "materialId": "ply", "size": { "l": 30, "w": 11.25 },
            "transform": { "pos": [0, 0, 0], "rot": [0, 0, 0] }, "qty": qty, "edgeBand": edge_band }],
    });
    spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap()
}

fn banding(spec: &Spec, units: Units) -> Vec<(String, u32)> {
    compute_cut_list(
        spec,
        CutListConfig {
            units,
            ..CutListConfig::default()
        },
    )
    .hardware
    .into_iter()
    .filter(|r| r.kind == HardwareKind::EdgeBanding)
    .map(|r| (r.description, r.qty))
    .collect()
}

#[test]
fn banded_edges_add_up_with_a_tenth_spare() {
    // Four shelves banded along the front (a 30" l1 edge): 120" = 10 ft, plus a tenth = 11 ft.
    let spec = shelves(json!(["l1"]), 4);
    assert_eq!(
        banding(&spec, Units::Fraction),
        vec![("Feet of 3/4\" edge banding (Birch Plywood)".to_string(), 11)]
    );
    // 3.048 m, plus a tenth, up to whole metres.
    assert_eq!(
        banding(&spec, Units::Metric),
        vec![("Metres of 19 mm edge banding (Birch Plywood)".to_string(), 4)]
    );
}

#[test]
fn ends_count_their_width_and_unbanded_parts_buy_nothing() {
    // Front and both ends: 30 + 11.25 + 11.25 = 52.5" → 4.8 ft → 5 ft.
    assert_eq!(banding(&shelves(json!(["l1", "w0", "w1"]), 1), Units::Fraction)[0].1, 5);
    assert!(banding(&shelves(json!([]), 1), Units::Fraction).is_empty());
}
