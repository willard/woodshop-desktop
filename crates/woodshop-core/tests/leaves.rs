//! A drop leaf or fold-down wing (spec 1.22): stored raised, held by folding brackets.

use serde_json::json;
use woodshop_core::cutlist::{CutListConfig, compute_cut_list};
use woodshop_core::lint::lint;
use woodshop_core::spec::{self, Spec};

/// A cart top with a 24"-deep wing hinged to its right end, raised level.
fn cart(leaf: serde_json::Value) -> Spec {
    let raw = json!({
        "specVersion": spec::CURRENT_SPEC_VERSION, "units": "in", "name": "Cart",
        "materials": [{ "id": "ply", "type": "sheet", "name": "Ply", "thickness": 0.75, "sheetSize": { "l": 96, "w": 48 } }],
        "parts": [
            { "id": "p_top", "name": "Top", "materialId": "ply", "size": { "l": 36, "w": 24 },
              "transform": { "pos": [0, 30.375, 0], "rot": [90, 0, 0] } },
            { "id": "p_side_l", "name": "Left side", "materialId": "ply", "size": { "l": 24, "w": 30 },
              "transform": { "pos": [-17.625, 15, 0], "rot": [0, 90, 0] } },
            { "id": "p_side_r", "name": "Right side", "materialId": "ply", "size": { "l": 24, "w": 30 },
              "transform": { "pos": [17.625, 15, 0], "rot": [0, 90, 0] } },
            { "id": "p_wing", "name": "Wing", "materialId": "ply", "size": { "l": 24, "w": 24 },
              "transform": { "pos": [30, 30.375, 0], "rot": [90, 0, 0] } }
        ],
        "joints": [
            { "type": "screw", "hostPartId": "p_top", "insertPartId": "p_side_l" },
            { "type": "screw", "hostPartId": "p_top", "insertPartId": "p_side_r" }
        ],
        "movables": [leaf]
    });
    spec::parse(raw).expect("valid")
}

fn wing(extra: serde_json::Value) -> serde_json::Value {
    let mut leaf =
        json!({ "id": "mv_wing", "kind": "leaf", "partIds": ["p_wing"], "leafPartId": "p_wing", "hingeEdge": "w0" });
    for (k, v) in extra.as_object().unwrap() {
        leaf[k] = v.clone();
    }
    leaf
}

fn codes(spec: &Spec) -> Vec<String> {
    lint(spec)
        .into_iter()
        .map(|i| format!("{} {}", i.code, i.message))
        .collect()
}

#[test]
fn a_raised_wing_overhangs_with_no_door_warnings_and_is_held_by_its_hardware() {
    let found = codes(&cart(wing(json!({}))));
    for code in [
        "movable.oversize",
        "movable.lid-stay",
        "movable.leaf-support",
        "part.unfastened",
    ] {
        assert!(found.iter().all(|c| !c.starts_with(code)), "{code}: {found:?}");
    }
}

#[test]
fn the_hardware_list_gets_hinges_and_the_longest_bracket_that_fits() {
    let list = compute_cut_list(&cart(wing(json!({}))), CutListConfig::default()).hardware;
    let line = |needle: &str| list.iter().find(|h| h.description.contains(needle)).map(|h| h.qty);
    assert_eq!(line("butt hinges"), Some(2));
    // 24" deep: a 20" bracket stops short of the edge.
    assert_eq!(line("20\" folding shelf brackets"), Some(2));
    assert!(list.iter().all(|h| !h.description.contains("knob")), "{list:?}");

    let piano = compute_cut_list(
        &cart(wing(
            json!({ "hinge": "hinge.piano-24in", "support": "bracket.folding-16in" }),
        )),
        CutListConfig::default(),
    )
    .hardware;
    assert!(
        piano.iter().any(|h| h.description.contains("piano") && h.qty == 1),
        "{piano:?}"
    );
    assert!(
        piano
            .iter()
            .any(|h| h.description.contains("16\" folding") && h.qty == 2)
    );
}

#[test]
fn brackets_that_are_too_short_or_too_long_or_not_brackets_are_named() {
    let short = codes(&cart(wing(json!({ "support": "bracket.folding-10in" }))));
    assert!(short.iter().any(|c| c.contains("less than halfway")), "{short:?}");
    let caster = codes(&cart(wing(json!({ "support": "caster.swivel-3in" }))));
    assert!(caster.iter().any(|c| c.contains("not a folding bracket")), "{caster:?}");
}

#[test]
fn a_wing_hung_on_its_brackets_lists_no_hinges_and_says_how_to_hang_it() {
    let hung = cart(wing(json!({ "hinge": "none", "support": "bracket.folding-20in" })));
    let list = compute_cut_list(&hung, CutListConfig::default()).hardware;
    assert!(list.iter().all(|h| !h.description.contains("hinge")), "{list:?}");
    assert!(
        list.iter()
            .any(|h| h.description.contains("20\" folding shelf brackets") && h.qty == 2),
        "{list:?}"
    );
    // "none" is not an unknown catalog hinge.
    let found = codes(&hung);
    assert!(
        found.iter().all(|c| !c.starts_with("movable.hardware-unknown")),
        "{found:?}"
    );

    let steps = woodshop_core::assembly::assembly_order(&hung);
    let hang = steps
        .iter()
        .find(|s| s.heading.starts_with("Hang"))
        .expect("a hang step");
    assert!(
        hang.lines.iter().any(|l| l.contains("screw it to the arms")),
        "{hang:?}"
    );
    assert!(hang.lines.iter().all(|l| !l.contains("Hinge it")), "{hang:?}");
}
