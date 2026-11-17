//! Hardware finishes (1.16): a finish names itself on the hardware list and keeps differently
//! finished pieces on rows of their own.

use serde_json::json;
use woodshop_core::cutlist::{CutListConfig, HardwareKind, compute_cut_list};
use woodshop_core::spec::{self, Spec};

/// The nightstand: one inset drawer with a 128 mm bar pull, plus `extra` mounted hardware.
fn nightstand(finish: Option<&str>, extra: serde_json::Value) -> Spec {
    let path = format!(
        "{}/../../resources/templates/nightstand.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let mut raw: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    if raw.get("spec").is_some() {
        raw = raw["spec"].take();
    }
    if let Some(f) = finish {
        raw["movables"][0]["finish"] = json!(f);
    }
    raw["hardware"] = extra;
    spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap()
}

fn knobs(spec: &Spec) -> Vec<(String, u32)> {
    compute_cut_list(spec, CutListConfig::default())
        .hardware
        .into_iter()
        .filter(|r| r.kind == HardwareKind::Knob)
        .map(|r| (r.description, r.qty))
        .collect()
}

#[test]
fn a_finished_pull_says_its_finish() {
    let plain = knobs(&nightstand(None, json!([])));
    assert_eq!(plain.len(), 1);
    assert!(!plain[0].0.contains("black"), "{plain:?}");
    let black = knobs(&nightstand(Some("black"), json!([])));
    assert_eq!(black.len(), 1);
    assert!(black[0].0.ends_with(", matte black"), "{black:?}");
}

#[test]
fn the_same_pull_in_two_finishes_is_two_rows_and_in_one_finish_is_one() {
    let mount = |id: &str, finish: &str| {
        json!({ "id": id, "item": "pull.bar-128mm", "partId": "p_drawer_front", "side": "front",
                "x": 5, "y": 3, "finish": finish })
    };
    let mixed = knobs(&nightstand(Some("brass"), json!([mount("hw_a", "black")])));
    assert_eq!(mixed.len(), 2, "{mixed:?}");
    let matched = knobs(&nightstand(Some("brass"), json!([mount("hw_a", "brass")])));
    assert_eq!(matched.len(), 1, "{matched:?}");
    assert_eq!(matched[0].1, 2);
    assert!(matched[0].0.ends_with(", brass"));
}

#[test]
fn an_unknown_finish_is_refused() {
    let path = format!(
        "{}/../../resources/templates/nightstand.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let mut raw: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    if raw.get("spec").is_some() {
        raw = raw["spec"].take();
    }
    raw["movables"][0]["finish"] = json!("gold");
    let raw = spec::migrate_to_latest(raw).unwrap();
    assert!(spec::validate::validate(&raw).is_err());
}
