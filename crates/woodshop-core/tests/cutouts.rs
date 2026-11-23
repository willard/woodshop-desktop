//! A cutout (spec 1.22): an opening or pocket in a face, away from the edges.

use serde_json::json;
use woodshop_core::lint::lint;
use woodshop_core::spec::{self, Spec};

/// A cart top on two sides, with `ops` on the top, and optionally a block standing in the opening.
fn cart(ops: serde_json::Value, block: bool) -> Spec {
    let mut parts = vec![
        json!({ "id": "p_top", "name": "Top", "materialId": "ply", "size": { "l": 36, "w": 24 },
                "transform": { "pos": [0, 30.375, 0], "rot": [90, 0, 0] }, "ops": ops }),
        json!({ "id": "p_side_l", "name": "Left side", "materialId": "ply", "size": { "l": 24, "w": 30 },
                "transform": { "pos": [-17.625, 15, 0], "rot": [0, 90, 0] } }),
        json!({ "id": "p_side_r", "name": "Right side", "materialId": "ply", "size": { "l": 24, "w": 30 },
                "transform": { "pos": [17.625, 15, 0], "rot": [0, 90, 0] } }),
    ];
    if block {
        // Stands up through the opening, as a saw's base would sit in a well.
        parts.push(
            json!({ "id": "p_block", "name": "Block", "materialId": "ply", "size": { "l": 10, "w": 4 },
                "transform": { "pos": [0, 30.375, 0], "rot": [0, 0, 0] } }),
        );
    }
    let raw = json!({
        "specVersion": spec::CURRENT_SPEC_VERSION, "units": "in", "name": "Cart",
        "materials": [{ "id": "ply", "type": "sheet", "name": "Ply", "thickness": 0.75, "sheetSize": { "l": 96, "w": 48 } }],
        "parts": parts,
        "joints": [
            { "type": "screw", "hostPartId": "p_top", "insertPartId": "p_side_l" },
            { "type": "screw", "hostPartId": "p_top", "insertPartId": "p_side_r" }
        ]
    });
    spec::parse(raw).expect("valid")
}

fn codes(spec: &Spec, part: &str) -> Vec<String> {
    lint(spec)
        .into_iter()
        .filter(|i| i.part_id.as_deref() == Some(part))
        .map(|i| format!("{} {}", i.code, i.message))
        .collect()
}

#[test]
fn a_cutout_inside_the_face_is_fine_and_one_off_the_edge_says_use_a_notch() {
    let inside = cart(
        json!([{ "type": "cutout", "face": "front", "x": 18, "y": 12, "length": 21.5, "width": 6.75 }]),
        false,
    );
    assert!(
        codes(&inside, "p_top").iter().all(|c| !c.contains("cutout")),
        "{:?}",
        codes(&inside, "p_top")
    );
    let off = cart(
        json!([{ "type": "cutout", "face": "front", "x": 30, "y": 12, "length": 21.5, "width": 6.75 }]),
        false,
    );
    assert!(
        codes(&off, "p_top")
            .iter()
            .any(|c| c.contains("runs off") && c.contains("notch")),
        "{:?}",
        codes(&off, "p_top")
    );
    let deep = cart(
        json!([{ "type": "cutout", "face": "front", "x": 18, "y": 12, "length": 4, "width": 4, "depth": 1 }]),
        false,
    );
    assert!(codes(&deep, "p_top").iter().any(|c| c.contains("omit depth")));
}

#[test]
fn a_part_may_stand_in_a_through_opening_but_not_through_a_pocket() {
    let pierced = |ops| lint(&cart(ops, true)).iter().any(|i| i.code == "part.pierce");
    let opening = json!([{ "type": "cutout", "face": "front", "x": 18, "y": 12, "length": 12, "width": 6 }]);
    let pocket =
        json!([{ "type": "cutout", "face": "front", "x": 18, "y": 12, "length": 12, "width": 6, "depth": 0.25 }]);
    assert!(!pierced(opening));
    assert!(pierced(pocket));
}
