//! Hardware prices: the user's price list, by hardware row key, costs the hardware list and adds
//! it to the estimate.

use std::collections::BTreeMap;

use serde_json::json;
use woodshop_core::cutlist::{CutListConfig, HardwareKind, compute_cut_list};
use woodshop_core::spec::{self, Spec};
use woodshop_core::units::Units;

fn shelf(cost_per_sheet: Option<f64>) -> Spec {
    let mut material = json!({ "id": "ply", "name": "Birch Plywood", "type": "sheet", "thickness": 0.75,
        "sheetSize": { "l": 96, "w": 48 } });
    if let Some(c) = cost_per_sheet {
        material["costPerSheet"] = json!(c);
    }
    let raw = json!({
        "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Shelf", "units": "in",
        "materials": [material],
        "parts": [{ "id": "s", "name": "Shelf", "materialId": "ply", "size": { "l": 30, "w": 11.25 },
            "transform": { "pos": [0, 0, 0], "rot": [0, 0, 0] }, "qty": 4, "edgeBand": ["l1"] }],
        "hardware": [
            { "id": "hw_1", "item": "pull.bar-96mm", "partId": "s", "side": "front", "x": 15, "y": 5 },
            { "id": "hw_2", "item": "pull.bar-96mm", "partId": "s", "side": "back", "x": 15, "y": 5 },
        ],
    });
    spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap()
}

fn priced(prices: &[(&str, f64)], units: Units, spec: &Spec) -> woodshop_core::cutlist::CutList {
    compute_cut_list(
        spec,
        CutListConfig {
            units,
            hardware_prices: prices
                .iter()
                .map(|(k, v)| (k.to_string(), *v))
                .collect::<BTreeMap<_, _>>(),
            ..CutListConfig::default()
        },
    )
}

#[test]
fn priced_rows_have_a_cost_and_add_to_the_estimate() {
    let spec = shelf(Some(60.0));
    let list = priced(
        &[("item|pull.bar-96mm", 6.5), ("edgeBanding|0.75|ft", 0.4)],
        Units::Fraction,
        &spec,
    );
    let pull = list.hardware.iter().find(|h| h.key == "item|pull.bar-96mm").unwrap();
    assert_eq!(pull.qty, 2);
    assert_eq!((pull.unit_price, pull.cost), (Some(6.5), Some(13.0)));
    let banding = list
        .hardware
        .iter()
        .find(|h| h.kind == HardwareKind::EdgeBanding)
        .unwrap();
    assert_eq!(banding.key, "edgeBanding|0.75|ft");
    assert_eq!(banding.cost, Some(0.4 * 11.0)); // 11 ft, as the banding test works out
    assert_eq!(list.totals.material_cost, Some(60.0));
    let hardware = 13.0 + 4.4;
    assert!((list.totals.hardware_cost.unwrap() - hardware).abs() < 1e-9);
    assert!((list.totals.estimated_cost.unwrap() - (60.0 + hardware)).abs() < 1e-9);
}

#[test]
fn hardware_alone_makes_an_estimate_and_nothing_priced_makes_none() {
    let spec = shelf(None);
    assert_eq!(priced(&[], Units::Fraction, &spec).totals.estimated_cost, None);
    let list = priced(&[("item|pull.bar-96mm", 5.0)], Units::Fraction, &spec);
    assert_eq!(list.totals.material_cost, None);
    assert_eq!(list.totals.estimated_cost, Some(10.0));
    // Unpriced rows are left alone.
    assert!(
        list.hardware
            .iter()
            .filter(|h| h.key != "item|pull.bar-96mm")
            .all(|h| h.cost.is_none())
    );
}

#[test]
fn a_key_names_the_same_thing_whatever_the_units_except_banding_sold_by_another_length() {
    let spec = shelf(None);
    let keys = |units| {
        let mut k: Vec<String> = priced(&[], units, &spec).hardware.into_iter().map(|h| h.key).collect();
        k.sort();
        k
    };
    let (inches, metric) = (keys(Units::Fraction), keys(Units::Metric));
    assert!(inches.contains(&"item|pull.bar-96mm".to_string()) && metric.contains(&"item|pull.bar-96mm".to_string()));
    // A price per foot is not a price per metre.
    assert!(inches.contains(&"edgeBanding|0.75|ft".to_string()));
    assert!(metric.contains(&"edgeBanding|0.75|m".to_string()));
}
