//! Render a template's plan to a PDF file: `cargo run -p woodshop-export --example plan -- bookshelf out.pdf`.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (id, out) = (
        args.get(1).map_or("bookshelf", String::as_str),
        args.get(2).map_or("plan.pdf", String::as_str),
    );
    let spec = woodshop_core::templates::find(id).expect("known template id");
    let pdf = woodshop_export::render_plan_pdf(&woodshop_export::PlanInput {
        title: &spec.name,
        spec: &spec,
        kerf: 0.125,
        date: "Sep 25, 2026",
        notes: vec![woodshop_export::PlanNote {
            body: "Cut the sides first, then the shelves.".into(),
            pinned: true,
        }],
        thumbnail: None,
        units: match std::env::var("WOODSHOP_UNITS").as_deref() {
            Ok("metric") => woodshop_core::units::Units::Metric,
            Ok("decimal") => woodshop_core::units::Units::Decimal,
            _ => woodshop_core::units::Units::Fraction,
        },
    })
    .expect("renders");
    std::fs::write(out, pdf).expect("writable");
}
