use woodshop_core::cutlist::{CutListConfig, compute_cut_list};
use woodshop_core::units::Units;
use woodshop_export::{LabelsInput, part_labels, render_labels_pdf};

fn config(units: Units, offcuts: Vec<woodshop_core::cutlist::Offcut>) -> CutListConfig {
    CutListConfig {
        units,
        offcuts,
        ..Default::default()
    }
}

fn template(id: &str) -> woodshop_core::spec::Spec {
    woodshop_core::templates::find(id).unwrap()
}

#[test]
fn every_piece_gets_one_label_in_cutting_order() {
    let mut spec = template("dresser");
    spec.parts[0].qty = Some(3);
    let cut_list = compute_cut_list(&spec, CutListConfig::default());
    let labels = part_labels(&spec, config(Units::Fraction, Vec::new()));
    let pieces: u32 = cut_list.parts.iter().map(|r| r.qty).sum();
    assert_eq!(labels.len(), pieces as usize);

    // Sheet goods first, sheet by sheet; then boards, board by board.
    let order: Vec<(char, usize)> = labels
        .iter()
        .filter(|l| !l.source.is_empty())
        .map(|l| {
            let (kind, n) = l.source.split_once(' ').unwrap();
            (kind.chars().next().unwrap(), n.parse().unwrap())
        })
        .collect();
    let first_board = order.iter().position(|(k, _)| *k == 'B').unwrap_or(order.len());
    assert!(order[first_board..].iter().all(|(k, _)| *k == 'B'), "{order:?}");

    // A part cut several times is numbered "n of qty", each number once.
    let row = cut_list.parts.iter().find(|r| r.qty > 1).expect("a repeated part");
    let mut counts: Vec<&str> = labels
        .iter()
        .filter(|l| l.name == row.name && l.size.contains(" × "))
        .map(|l| l.count.as_str())
        .collect();
    counts.sort();
    counts.dedup();
    assert!(counts.contains(&format!("1 of {}", row.qty).as_str()), "{counts:?}");
    assert!(counts.contains(&format!("{0} of {0}", row.qty).as_str()), "{counts:?}");
    // A part cut once has no count.
    let once = cut_list.parts.iter().find(|r| r.qty == 1).unwrap();
    assert_eq!(labels.iter().find(|l| l.name == once.name).unwrap().count, "");
}

#[test]
fn sizes_follow_the_units() {
    let spec = template("nightstand");
    let inches = part_labels(&spec, config(Units::Fraction, Vec::new()));
    assert!(inches[0].size.contains('"'), "{}", inches[0].size);
    let metric = part_labels(&spec, config(Units::Metric, Vec::new()));
    assert!(metric[0].size.ends_with(" mm"), "{}", metric[0].size);
}

#[test]
fn every_template_prints_its_labels() {
    for t in woodshop_core::templates::all() {
        let spec = template(t.id);
        for units in [Units::Fraction, Units::Metric] {
            let pdf = render_labels_pdf(&LabelsInput {
                title: &spec.name,
                spec: &spec,
                kerf: 0.125,
                units,
                skip: 0,
                offcuts: Vec::new(),
                sheet_trim: 0.0,
            })
            .unwrap_or_else(|e| panic!("{}: {e}", t.id));
            assert!(pdf.starts_with(b"%PDF-"), "{}", t.id);
        }
    }
}

#[test]
#[ignore = "writes sample sheets for a look"]
fn dump() {
    let dir = std::env::var("LABELS_OUT").unwrap();
    for (units, name) in [(Units::Fraction, "letter"), (Units::Metric, "a4")] {
        let spec = template("workbench-drawers");
        let pdf = render_labels_pdf(&LabelsInput {
            title: &spec.name,
            spec: &spec,
            kerf: 0.125,
            units,
            skip: 4,
            offcuts: Vec::new(),
            sheet_trim: 0.0,
        })
        .unwrap();
        std::fs::write(format!("{dir}/labels-{name}.pdf"), pdf).unwrap();
    }
}

#[test]
fn printing_can_start_partway_down_a_used_sheet() {
    let spec = template("nightstand");
    let input = |skip| LabelsInput {
        title: "x",
        spec: &spec,
        kerf: 0.125,
        units: Units::Fraction,
        skip,
        offcuts: Vec::new(),
        sheet_trim: 0.0,
    };
    let fresh = render_labels_pdf(&input(0)).unwrap();
    let used = render_labels_pdf(&input(7)).unwrap();
    assert_ne!(fresh, used);
    // More than a sheet's worth is never skipped: at most one label short of a full sheet.
    assert_eq!(
        render_labels_pdf(&input(29)).unwrap(),
        render_labels_pdf(&input(500)).unwrap()
    );
    assert_eq!(woodshop_export::labels_per_sheet(Units::Metric), 21);
}

#[test]
fn a_piece_cut_from_stock_on_hand_says_so() {
    let spec = template("nightstand");
    let top = woodshop_core::cutlist::Offcut {
        id: "top".into(),
        material: "Birch Plywood".into(),
        thickness: 0.75,
        l: 25.0,
        w: Some(17.0),
    };
    let labels = part_labels(&spec, config(Units::Fraction, vec![top.clone()]));
    let label = labels.iter().find(|l| l.name == "Top Panel").unwrap();
    assert_eq!(label.source, "On hand 1");
    // And the plan draws it, captioned.
    let pdf = render_labels_pdf(&LabelsInput {
        title: "x",
        spec: &spec,
        kerf: 0.125,
        units: Units::Fraction,
        skip: 0,
        offcuts: vec![top],
        sheet_trim: 0.0,
    })
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}
