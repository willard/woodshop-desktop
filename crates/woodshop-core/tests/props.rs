//! Props (spec 1.22): things shown with a piece but not built, such as the totes on a tote rack.

use serde_json::json;
use woodshop_core::cutlist::{CutListConfig, compute_cut_list};
use woodshop_core::geometry::frame::overall_size;
use woodshop_core::lint::lint;
use woodshop_core::spec::{self, Spec};

/// A shelf on two sides, with whatever props are given.
fn shelf(props: serde_json::Value) -> Spec {
    let raw = json!({
        "specVersion": spec::CURRENT_SPEC_VERSION, "units": "in", "name": "Shelf",
        "materials": [{ "id": "ply", "type": "sheet", "name": "Ply", "thickness": 0.75, "sheetSize": { "l": 96, "w": 48 } }],
        "parts": [
            { "id": "p_shelf", "name": "Shelf", "materialId": "ply", "size": { "l": 36, "w": 24 },
              "transform": { "pos": [0, 12.375, 0], "rot": [90, 0, 0] } },
            { "id": "p_side_l", "name": "Left side", "materialId": "ply", "size": { "l": 24, "w": 12 },
              "transform": { "pos": [-18.375, 6, 0], "rot": [0, 90, 0] } },
            { "id": "p_side_r", "name": "Right side", "materialId": "ply", "size": { "l": 24, "w": 12 },
              "transform": { "pos": [18.375, 6, 0], "rot": [0, 90, 0] } }
        ],
        "joints": [
            { "type": "screw", "hostPartId": "p_shelf", "insertPartId": "p_side_l" },
            { "type": "screw", "hostPartId": "p_shelf", "insertPartId": "p_side_r" }
        ],
        "props": props
    });
    spec::parse(raw).expect("valid")
}

fn tote(id: &str, item: &str) -> serde_json::Value {
    json!({ "id": id, "item": item, "pos": [0, 12.75, 0], "rot": 90, "accent": "#ff0000" })
}

fn codes(spec: &Spec) -> Vec<String> {
    lint(spec)
        .into_iter()
        .map(|i| format!("{} {}", i.code, i.message))
        .collect()
}

#[test]
fn a_tote_is_drawn_but_never_listed_counted_or_sized() {
    let bare = shelf(json!([]));
    let with = shelf(json!([tote("pr_tote", "prop.tote-hdx-27gal")]));
    assert_eq!(with.props().len(), 1);
    assert!(
        codes(&with).iter().all(|c| !c.starts_with("prop.")),
        "{:?}",
        codes(&with)
    );

    let list = compute_cut_list(&with, CutListConfig::default());
    let without = compute_cut_list(&bare, CutListConfig::default());
    assert_eq!(list.hardware, without.hardware); // the screws, and no tote
    assert!(list.hardware.iter().all(|h| !h.description.contains("Tote")));
    assert_eq!(list.parts.len(), without.parts.len());
    // The tote stands well above the shelf, but the piece is the same size.
    assert_eq!(overall_size(&with), overall_size(&bare));

    // It round-trips as written.
    let back: Spec = spec::from_value(spec::to_value(&with)).unwrap();
    assert_eq!(back.props(), with.props());
}

#[test]
fn a_prop_must_be_a_catalog_prop_with_its_own_id() {
    let hardware = codes(&shelf(json!([tote("pr_a", "pull.bar-96mm")])));
    assert!(
        hardware.iter().any(|c| c.starts_with("prop.not-a-prop")),
        "{hardware:?}"
    );

    let unknown = codes(&shelf(json!([tote("pr_a", "prop.crate-of-dreams")])));
    assert!(
        unknown.iter().any(|c| c.starts_with("prop.unknown-item")),
        "{unknown:?}"
    );

    let twice = lint(&shelf(json!([
        tote("pr_a", "prop.tote-hdx-27gal"),
        tote("pr_a", "prop.tote-hdx-27gal")
    ])));
    let duplicate = twice.iter().find(|i| i.code == "prop.duplicate-id").expect("duplicate");
    assert!(duplicate.is_error());
    assert_eq!(duplicate.part_id, None);
}

#[test]
fn a_tote_mounted_as_hardware_is_named() {
    let mut spec = shelf(json!([]));
    spec.hardware = Some(vec![
        serde_json::from_value(json!({
            "id": "hw_tote", "item": "prop.tote-hdx-27gal", "partId": "p_shelf", "side": "front", "x": 18, "y": 12
        }))
        .unwrap(),
    ]);
    let found = codes(&spec);
    assert!(found.iter().any(|c| c.starts_with("hardware.is-prop")), "{found:?}");
}
