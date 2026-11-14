//! Hardware that changes the woodwork: hinge cups need door thickness, slides need side clearance.

use serde_json::{Value, json};
use woodshop_core::lint::lint;
use woodshop_core::spec::{self, Spec};

fn build(parts: Value, movables: Value, thickness: f64) -> Spec {
    let raw = json!({
        "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Cabinet", "units": "in",
        "materials": [{ "id": "ply", "name": "Plywood", "type": "sheet", "thickness": thickness }],
        "parts": parts,
        "movables": movables,
    });
    spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap()
}

fn part(id: &str, l: f64, w: f64, pos: [f64; 3], rot: [f64; 3]) -> Value {
    json!({ "id": id, "name": id, "materialId": "ply", "size": { "l": l, "w": w },
        "transform": { "pos": pos, "rot": rot } })
}

fn messages(spec: &Spec, code: &str) -> Vec<String> {
    lint(spec)
        .into_iter()
        .filter(|i| i.code == code)
        .map(|i| i.message)
        .collect()
}

/// A cabinet 24" wide outside (22.5" opening between 3/4" sides) with a drawer whose box is
/// `box_width` wide, centred at `box_x`. The box is two sides, a back and a bottom.
fn drawer_cabinet(box_width: f64, box_x: f64, slide: Option<&str>) -> Spec {
    let t = 0.75;
    let half = box_width / 2.0;
    let mut drawer = json!({ "id": "dr", "kind": "drawer", "name": "Top drawer",
        "partIds": ["front", "box_l", "box_r", "box_back", "box_bottom"], "frontPartId": "front", "style": "overlay" });
    if let Some(s) = slide {
        drawer["slide"] = json!(s);
    }
    build(
        json!([
            // Cabinet sides: faces square to X, 16" deep, 24" tall.
            part("side_l", 16.0, 24.0, [-11.625, 12.0, 0.0], [0.0, 90.0, 0.0]),
            part("side_r", 16.0, 24.0, [11.625, 12.0, 0.0], [0.0, 90.0, 0.0]),
            // Drawer front faces +Z.
            part("front", 23.0, 6.0, [0.0, 4.0, 8.375], [0.0, 0.0, 0.0]),
            part("box_l", 14.0, 5.0, [box_x - half + t / 2.0, 4.0, 1.0], [0.0, 90.0, 0.0]),
            part("box_r", 14.0, 5.0, [box_x + half - t / 2.0, 4.0, 1.0], [0.0, 90.0, 0.0]),
            part(
                "box_back",
                box_width - 2.0 * t,
                5.0,
                [box_x, 4.0, -5.625],
                [0.0, 0.0, 0.0]
            ),
            part(
                "box_bottom",
                box_width - 2.0 * t,
                14.0,
                [box_x, 1.875, 1.0],
                [90.0, 0.0, 0.0]
            ),
        ]),
        json!([drawer]),
        t,
    )
}

#[test]
fn a_box_that_leaves_half_an_inch_each_side_is_quiet() {
    assert_eq!(
        messages(&drawer_cabinet(21.5, 0.0, None), "movable.slide-clearance"),
        Vec::<String>::new()
    );
}

#[test]
fn a_box_too_wide_for_its_slides_says_what_width_to_make_it() {
    let found = messages(&drawer_cabinet(22.0, 0.0, None), "movable.slide-clearance");
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("22\" wide box in a 22.5\" opening"), "{}", found[0]);
    assert!(found[0].contains("make the box 21.5\" wide"), "{}", found[0]);
}

#[test]
fn a_box_too_narrow_is_flagged_too() {
    // Slides can't span a gap any more than they can squeeze into one.
    assert_eq!(
        messages(&drawer_cabinet(20.0, 0.0, None), "movable.slide-clearance").len(),
        1
    );
}

#[test]
fn the_right_width_off_centre_is_flagged() {
    let found = messages(&drawer_cabinet(21.5, 0.25, None), "movable.slide-clearance");
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("off-centre"), "{}", found[0]);
}

#[test]
fn undermount_slides_take_no_side_clearance() {
    assert!(
        messages(
            &drawer_cabinet(22.0, 0.0, Some("slide.undermount")),
            "movable.slide-clearance"
        )
        .is_empty()
    );
}

fn door(thickness: f64, hinge: &str) -> Spec {
    build(
        json!([part("door", 30.0, 18.0, [0.0, 15.0, 0.0], [0.0, 0.0, 90.0])]),
        json!([{ "id": "d", "kind": "door", "partIds": ["door"], "panelPartId": "door",
            "hingeEdge": "l0", "style": "overlay", "hinge": hinge }]),
        thickness,
    )
}

#[test]
fn a_half_inch_door_is_too_thin_for_a_euro_cup() {
    let found = messages(&door(0.5, "hinge.euro-full-overlay"), "movable.hinge-cup-deep");
    assert_eq!(found.len(), 1, "one finding per door, not per hinge: {found:?}");
    assert!(found[0].contains("0.5\" thick"), "{}", found[0]);
}

#[test]
fn a_three_quarter_door_takes_the_cup_and_a_butt_hinge_needs_none() {
    assert!(messages(&door(0.75, "hinge.euro-full-overlay"), "movable.hinge-cup-deep").is_empty());
    assert!(messages(&door(0.5, "hinge.butt-2-5in"), "movable.hinge-cup-deep").is_empty());
}
