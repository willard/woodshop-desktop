//! The template gallery: finished designs a new project can start from. Bundled into the binary
//! (the app works offline) and parsed like any stored spec, so an older template is migrated.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Serialize;

use crate::cutlist::{CutListConfig, compute_cut_list};
use crate::geometry::{OverallSize, overall_size};
use crate::spec::{self, Difficulty, Spec};

/// What the gallery says about each template, for someone choosing one: kept apart from the
/// design's own `meta.notes`, which are build notes for the maker (and for agents).
const GALLERY_JSON: &str = include_str!("../../../resources/template-gallery.json");

fn gallery() -> &'static HashMap<String, String> {
    static GALLERY: OnceLock<HashMap<String, String>> = OnceLock::new();
    GALLERY.get_or_init(|| serde_json::from_str(GALLERY_JSON).expect("bundled template gallery is valid"))
}

const TEMPLATES: &[(&str, &str)] = &[
    (
        "base-cabinet",
        include_str!("../../../resources/templates/base-cabinet.json"),
    ),
    ("bookshelf", include_str!("../../../resources/templates/bookshelf.json")),
    (
        "coffee-table",
        include_str!("../../../resources/templates/coffee-table.json"),
    ),
    ("desk", include_str!("../../../resources/templates/desk.json")),
    (
        "dining-table",
        include_str!("../../../resources/templates/dining-table.json"),
    ),
    ("dresser", include_str!("../../../resources/templates/dresser.json")),
    (
        "entry-bench",
        include_str!("../../../resources/templates/entry-bench.json"),
    ),
    (
        "entry-shelf",
        include_str!("../../../resources/templates/entry-shelf.json"),
    ),
    (
        "kitchen-cart",
        include_str!("../../../resources/templates/kitchen-cart.json"),
    ),
    (
        "media-console",
        include_str!("../../../resources/templates/media-console.json"),
    ),
    (
        "mobile-workbench",
        include_str!("../../../resources/templates/mobile-workbench.json"),
    ),
    (
        "nightstand",
        include_str!("../../../resources/templates/nightstand.json"),
    ),
    (
        "picnic-table",
        include_str!("../../../resources/templates/picnic-table.json"),
    ),
    (
        "planter-box",
        include_str!("../../../resources/templates/planter-box.json"),
    ),
    (
        "raised-bed",
        include_str!("../../../resources/templates/raised-bed.json"),
    ),
    (
        "record-stand",
        include_str!("../../../resources/templates/record-stand.json"),
    ),
    (
        "record-stand-dado",
        include_str!("../../../resources/templates/record-stand-dado.json"),
    ),
    ("sawhorse", include_str!("../../../resources/templates/sawhorse.json")),
    ("shoe-rack", include_str!("../../../resources/templates/shoe-rack.json")),
    (
        "side-table",
        include_str!("../../../resources/templates/side-table.json"),
    ),
    (
        "step-stool",
        include_str!("../../../resources/templates/step-stool.json"),
    ),
    ("tool-tote", include_str!("../../../resources/templates/tool-tote.json")),
    ("toy-chest", include_str!("../../../resources/templates/toy-chest.json")),
    (
        "wall-cabinet",
        include_str!("../../../resources/templates/wall-cabinet.json"),
    ),
    ("workbench", include_str!("../../../resources/templates/workbench.json")),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub id: &'static str,
    pub name: String,
    pub difficulty: Option<Difficulty>,
    /// One or two sentences for someone choosing a design (`resources/template-gallery.json`).
    pub summary: Option<String>,
    /// The design's build notes (`meta.notes`).
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub part_count: usize,
    /// Finished size, inches: width × depth × height.
    pub overall: Option<OverallSize>,
    /// What to buy, from the cut list at the default kerf.
    pub sheet_count: usize,
    pub board_feet: f64,
}

/// Every template, sorted by name.
pub fn all() -> Vec<TemplateSummary> {
    let mut out: Vec<TemplateSummary> = TEMPLATES
        .iter()
        .filter_map(|(id, _)| {
            let spec = find(id)?;
            let meta = spec.meta.clone().unwrap_or(spec::Meta {
                difficulty: None,
                notes: None,
                tags: None,
            });
            let totals = compute_cut_list(&spec, CutListConfig::default()).totals;
            Some(TemplateSummary {
                id,
                name: spec.name.clone(),
                difficulty: meta.difficulty,
                summary: gallery().get(*id).cloned(),
                notes: meta.notes,
                tags: meta.tags.unwrap_or_default(),
                part_count: spec.parts.len(),
                overall: overall_size(&spec),
                sheet_count: totals.sheet_count,
                board_feet: totals.board_feet,
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// A template's spec, migrated, validated and with defaults filled.
pub fn find(id: &str) -> Option<Spec> {
    let (_, json) = TEMPLATES.iter().find(|(t, _)| *t == id)?;
    let raw = serde_json::from_str(json).ok()?;
    spec::parse(raw).ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_template_has_a_gallery_description() {
        for (id, _) in super::TEMPLATES {
            let summary = super::gallery()
                .get(*id)
                .unwrap_or_else(|| panic!("{id}: no gallery text"));
            assert!(
                (40..=260).contains(&summary.len()),
                "{id}: one or two sentences, not {} characters",
                summary.len()
            );
        }
        assert_eq!(
            super::gallery().len(),
            super::TEMPLATES.len(),
            "no gallery text for a missing template"
        );
        for t in super::all() {
            assert!(t.overall.is_some(), "{}: overall size", t.id);
            assert!(t.sheet_count > 0 || t.board_feet > 0.0, "{}: something to buy", t.id);
        }
    }

    #[test]
    fn every_template_parses() {
        for (id, _) in super::TEMPLATES {
            assert!(super::find(id).is_some(), "template {id} does not parse");
        }
        assert_eq!(super::all().len(), super::TEMPLATES.len());
    }
}
