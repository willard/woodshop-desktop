use woodshop_export::{PlanInput, PlanNote, render_plan_pdf};

#[test]
fn every_template_renders_a_pdf() {
    for t in woodshop_core::templates::all() {
        let spec = woodshop_core::templates::find(t.id).unwrap();
        let pdf = render_plan_pdf(&PlanInput {
            title: &spec.name,
            spec: &spec,
            kerf: 0.125,
            date: "Sep 25, 2026",
            notes: vec![PlanNote {
                body: "Cut the legs oversize & trim <after> glue-up".into(),
                pinned: true,
            }],
            thumbnail: None,
            units: Default::default(),
            hardware_prices: Default::default(),
            offcuts: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("{}: {e}", t.id));
        assert!(pdf.starts_with(b"%PDF-"), "{}", t.id);
        assert!(pdf.len() > 5_000, "{}", t.id);
    }
}

#[test]
fn a_plan_with_stock_on_hand_renders() {
    let spec = woodshop_core::templates::find("nightstand").unwrap();
    let on_hand = |id: &str, material: &str, thickness: f64, l: f64, w: Option<f64>| woodshop_core::cutlist::Offcut {
        id: id.into(),
        material: material.into(),
        thickness,
        l,
        w,
    };
    let pdf = render_plan_pdf(&PlanInput {
        title: &spec.name,
        spec: &spec,
        kerf: 0.125,
        date: "Nov 17, 2026",
        notes: vec![],
        thumbnail: None,
        units: Default::default(),
        hardware_prices: Default::default(),
        offcuts: vec![
            on_hand("top", "Birch Plywood", 0.75, 25.0, Some(17.0)),
            on_hand("leg", "Solid Birch (legs/aprons/cleats)", 1.5, 27.0, None),
        ],
    })
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}
