use woodshop_core::cutlist::{CutList, CutListConfig, Offcut, compute_cut_list};
use woodshop_core::spec::Spec;

fn nightstand() -> Spec {
    let mut spec = woodshop_core::templates::find("nightstand").unwrap();
    for m in &mut spec.materials {
        m.cost_per_sheet = m.sheet_size.map(|_| 60.0);
        m.cost_per_board_foot = m.sheet_size.is_none().then_some(8.0);
    }
    spec
}

fn offcut(id: &str, material: &str, thickness: f64, l: f64, w: Option<f64>) -> Offcut {
    Offcut {
        id: id.into(),
        material: material.into(),
        thickness,
        l,
        w,
    }
}

fn cut(spec: &Spec, offcuts: Vec<Offcut>) -> CutList {
    compute_cut_list(
        spec,
        CutListConfig {
            offcuts,
            ..CutListConfig::default()
        },
    )
}

#[test]
fn pieces_come_off_your_offcuts_before_anything_is_bought() {
    let spec = nightstand();
    let before = cut(&spec, vec![]);
    let drawer = |c: &CutList| {
        c.sheets
            .iter()
            .find(|p| p.material_name.contains("drawer"))
            .unwrap()
            .clone()
    };
    assert_eq!(drawer(&before).sheet_count, 1);

    // A 30" × 26" piece of the 1/2" drawer ply holds the whole drawer box: no sheet to buy, no cost.
    let after = cut(
        &spec,
        vec![offcut("o1", "birch plywood (drawer parts)", 0.5, 30.0, Some(26.0))],
    );
    let plan = drawer(&after);
    assert_eq!(plan.sheet_count, 0);
    assert_eq!(plan.cost, Some(0.0));
    assert_eq!(plan.offcuts.len(), 1);
    assert_eq!(plan.offcuts[0].id, "o1");
    // Every piece is on the offcut (sheet index sheet_count + 0) and inside it.
    for p in &plan.placements {
        assert_eq!(p.sheet, 0);
        assert!(p.x + p.w <= 30.0 + 1e-9 && p.y + p.h <= 26.0 + 1e-9, "{p:?}");
    }
    assert_eq!(after.totals.sheet_count, before.totals.sheet_count - 1);
    assert!(after.totals.estimated_cost.unwrap() < before.totals.estimated_cost.unwrap());
}

#[test]
fn offcut_layouts_are_numbered_after_the_bought_sheets() {
    let spec = nightstand();
    // A scrap of the 3/4" ply big enough for the top only; the rest still needs a sheet.
    let list = cut(&spec, vec![offcut("top", "Birch Plywood", 0.75, 25.0, Some(17.0))]);
    let plan = list.sheets.iter().find(|p| p.material_name == "Birch Plywood").unwrap();
    assert_eq!(plan.sheet_count, 1);
    assert_eq!(plan.offcuts.len(), 1);
    let on_offcut: Vec<_> = plan.placements.iter().filter(|p| p.sheet == plan.sheet_count).collect();
    assert_eq!(on_offcut.len(), 1);
    assert_eq!(on_offcut[0].name, "Top Panel");
}

#[test]
fn a_board_offcut_saves_the_wood_cut_from_it() {
    let spec = nightstand();
    let before = cut(&spec, vec![]);
    let after = cut(
        &spec,
        vec![offcut("b", "Solid Birch (legs/aprons/cleats)", 1.5, 27.0, None)],
    );
    let (b, a) = (&before.lumber[0], &after.lumber[0]);
    assert_eq!(a.offcuts.len(), 1);
    let from_offcut: Vec<_> = a.cuts.iter().filter(|c| c.stick >= a.stick_count).collect();
    // Two 25 1/4" legs, side by side across the board's width, fit a 27" offcut.
    let lengths: Vec<f64> = from_offcut.iter().map(|c| c.length).collect();
    assert_eq!(lengths, [25.25, 25.25]);
    // Their board feet (2 × 25.25 × 1.5 × 1.5 / 144) at $8 come off the cost.
    let saved = 2.0 * 25.25 * 1.5 * 1.5 / 144.0 * 8.0;
    assert!(
        (b.cost.unwrap() - a.cost.unwrap() - saved).abs() < 1e-9,
        "{} {}",
        b.cost.unwrap(),
        a.cost.unwrap()
    );
}

#[test]
fn offcuts_of_other_stock_or_too_small_are_left_alone() {
    let spec = nightstand();
    let before = cut(&spec, vec![]);
    let list = cut(
        &spec,
        vec![
            offcut("thick", "Birch Plywood", 1.0, 96.0, Some(48.0)),
            offcut("oak", "Red Oak Plywood", 0.75, 96.0, Some(48.0)),
            offcut("tiny", "Birch Plywood", 0.75, 4.0, Some(4.0)),
            offcut("no width", "Birch Plywood", 0.75, 48.0, None),
        ],
    );
    assert_eq!(list.totals.sheet_count, before.totals.sheet_count);
    assert!(list.sheets.iter().all(|p| p.offcuts.is_empty()));
    assert_eq!(list, before);
}
