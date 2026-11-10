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
        })
        .unwrap_or_else(|e| panic!("{}: {e}", t.id));
        assert!(pdf.starts_with(b"%PDF-"), "{}", t.id);
        assert!(pdf.len() > 5_000, "{}", t.id);
    }
}
