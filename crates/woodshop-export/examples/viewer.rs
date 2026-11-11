//! Render a template as a standalone 3D plan: `cargo run -p woodshop-export --example viewer -- bookshelf out.html`.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (id, out) = (
        args.get(1).map_or("bookshelf", String::as_str),
        args.get(2).map_or("plan.html", String::as_str),
    );
    let spec = woodshop_core::templates::find(id).expect("known template id");
    let html = woodshop_export::render_viewer_html(&woodshop_export::ViewerInput {
        title: &spec.name,
        spec: woodshop_core::spec::to_value(&spec),
        kerf: 0.125,
        theme: "dark",
        exported_at: "2026-09-25T12:00:00Z",
        notes: vec![woodshop_export::PlanNote {
            body: "Sand to 180 before glue-up.".into(),
            pinned: true,
        }],
        // `WOODSHOP_UNITS=metric` (or decimal) to see the page in other units.
        units: match std::env::var("WOODSHOP_UNITS").as_deref() {
            Ok("metric") => woodshop_core::units::Units::Metric,
            Ok("decimal") => woodshop_core::units::Units::Decimal,
            _ => woodshop_core::units::Units::Fraction,
        },
    });
    std::fs::write(out, html).expect("writable");
}
