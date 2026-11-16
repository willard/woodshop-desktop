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

#[test]
fn undermount_slides_need_a_recess_under_the_bottom() {
    // The bottom sits flush with the lower edge of the sides: nowhere for the slides.
    let flush = drawer_cabinet(22.0, 0.0, Some("slide.undermount"));
    let found = messages(&flush, "movable.undermount-recess");
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("has 0\" under its bottom"), "{}", found[0]);
    assert!(found[0].contains("raise the bottom 0.5\""), "{}", found[0]);

    // Raised half an inch, it clears.
    let mut raised = flush;
    let bottom = raised.parts.iter_mut().find(|p| p.id == "box_bottom").unwrap();
    bottom.transform.pos[1] += 0.5;
    assert!(messages(&raised, "movable.undermount-recess").is_empty());

    // Side-mount slides don't care where the bottom is.
    assert!(messages(&drawer_cabinet(21.5, 0.0, None), "movable.undermount-recess").is_empty());
}

/// A 30 × 16 lid lying flat on top of a 16" tall end, hinged along its back edge, with or
/// without a lid stay on the end.
fn chest(stay: Option<&str>) -> Spec {
    let mut spec = build(
        json!([
            part("end", 16.0, 16.0, [-14.625, 8.0, 0.0], [0.0, 90.0, 0.0]),
            part("lid", 30.0, 16.0, [0.0, 16.375, 0.0], [-90.0, 0.0, 0.0]),
        ]),
        json!([{ "id": "mv_lid", "kind": "door", "name": "Lid", "partIds": ["lid"],
            "panelPartId": "lid", "hingeEdge": "l1", "style": "overlay", "hinge": "hinge.butt-3in", "pull": "none" }]),
        0.75,
    );
    if let Some(item) = stay {
        let raw = json!([{ "id": "hw", "item": item, "partId": "end", "side": "front", "x": 8.0, "y": 12.0 }]);
        spec.hardware = Some(serde_json::from_value(raw).unwrap());
    }
    spec
}

#[test]
fn a_lid_without_a_stay_is_flagged() {
    let found = messages(&chest(None), "movable.lid-stay");
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].starts_with("\"Lid\" opens upward"), "{}", found[0]);
}

#[test]
fn a_lid_stay_beside_the_lid_quiets_it() {
    assert!(messages(&chest(Some("lid.stay-soft-close")), "movable.lid-stay").is_empty());
    // A pull is not a stay.
    assert_eq!(messages(&chest(Some("pull.bar-3in")), "movable.lid-stay").len(), 1);
}

#[test]
fn a_side_hung_door_needs_no_stay() {
    assert!(messages(&door(0.75, "hinge.butt-2-5in"), "movable.lid-stay").is_empty());
}

#[test]
fn messages_follow_the_units_they_are_asked_in() {
    use woodshop_core::lint::lint_in;
    use woodshop_core::units::Units;
    let spec = drawer_cabinet(22.0, 0.0, None);
    let say = |units| {
        lint_in(&spec, units)
            .into_iter()
            .find(|i| i.code == "movable.slide-clearance")
            .map(|i| i.message)
            .unwrap()
    };
    let fraction = say(Units::Fraction);
    assert!(fraction.contains("22\" wide box in a 22 1/2\" opening"), "{fraction}");
    assert!(fraction.contains("make the box 21 1/2\" wide"), "{fraction}");
    let metric = say(Units::Metric);
    assert!(metric.contains("559 mm wide box in a 572 mm opening"), "{metric}");
    assert!(metric.contains("13 mm each side"), "{metric}");
    assert!(
        !metric.contains('"') || metric.matches('"').count() == 2,
        "only the drawer's name is quoted: {metric}"
    );
    // Without units, agents and tests keep decimal inches.
    assert_eq!(say(Units::Decimal), messages(&spec, "movable.slide-clearance")[0]);
}
