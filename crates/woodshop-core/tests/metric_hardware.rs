//! A metric user's hardware list names what a metric shop sells, with no inch marks in it.

use woodshop_core::cutlist::{compute_hardware, compute_hardware_in};
use woodshop_core::hardware::catalog;
use woodshop_core::templates;
use woodshop_core::units::Units;

#[test]
fn every_item_sized_in_inches_has_a_metric_name() {
    for item in &catalog().items {
        let inch = item.name.contains('"') || item.list.contains('"');
        match &item.metric {
            Some(m) => {
                assert!(inch, "{}: a metric name for an item that needs none", item.id);
                assert!(!m.name.contains('"') && !m.list.contains('"'), "{}: {m:?}", item.id);
                assert!(m.name.contains(" mm") && m.list.contains(" mm"), "{}: {m:?}", item.id);
            }
            None => assert!(!inch, "{}: \"{}\" has no metric name", item.id, item.name),
        }
        assert_eq!(item.name_in(Units::Fraction), item.name);
    }
}

#[test]
fn no_template_hardware_list_shows_an_inch_in_metric() {
    for summary in templates::all() {
        let spec = templates::find(summary.id).unwrap();
        let metric = compute_hardware_in(&spec, Units::Metric);
        let inches = compute_hardware(&spec);
        for row in &metric {
            assert!(!row.description.contains('"'), "{}: {}", summary.id, row.description);
        }
        // Only the words change. The list is sorted by its words, so compare without order.
        let counts = |rows: &[woodshop_core::cutlist::HardwareRow]| {
            let mut c: Vec<String> = rows.iter().map(|r| format!("{:?} {}", r.kind, r.qty)).collect();
            c.sort();
            c
        };
        assert_eq!(counts(&metric), counts(&inches), "{}", summary.id);
    }
}

#[test]
fn trade_sizes_for_fasteners_and_slides_exact_sizes_for_dowels() {
    let descriptions = |id: &str| -> Vec<String> {
        compute_hardware_in(&templates::find(id).unwrap(), Units::Metric)
            .into_iter()
            .map(|r| r.description)
            .collect()
    };
    let nightstand = descriptions("nightstand");
    for expected in [
        "30 mm coarse-thread pocket screws",
        "4 × 40 mm wood screws",
        "300 mm side-mount soft-close drawer slides (pairs)",
        "bar pulls, 128 mm centers",
    ] {
        assert!(
            nightstand.iter().any(|d| d == expected),
            "{expected} in {nightstand:#?}"
        );
    }
    let cabinet = descriptions("wall-cabinet");
    assert!(cabinet.iter().any(|d| d == "32 mm round cabinet knobs"), "{cabinet:#?}");
    let chest = descriptions("toy-chest");
    assert!(chest.iter().any(|d| d == "75 mm butt hinges"), "{chest:#?}");
    assert!(chest.iter().any(|d| d == "100 mm chest handles"), "{chest:#?}");
    // A dowel has to fit the hole: 3/8" is 9.5 mm, not a 10 mm dowel.
    let any = templates::all()
        .into_iter()
        .flat_map(|t| descriptions(t.id))
        .find(|d| d.ends_with("dowels"));
    if let Some(dowel) = any {
        assert!(dowel.starts_with("9.5 × "), "{dowel}");
    }
}
