//! The template gallery: finished designs a new project can start from. Bundled into the binary
//! (the app works offline) and parsed like any stored spec, so an older template is migrated.

use serde::Serialize;

use crate::spec::{self, Difficulty, Spec};

const TEMPLATES: &[(&str, &str)] = &[
    ("bookshelf", include_str!("../../../resources/templates/bookshelf.json")),
    (
        "coffee-table",
        include_str!("../../../resources/templates/coffee-table.json"),
    ),
    ("desk", include_str!("../../../resources/templates/desk.json")),
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
        "record-stand",
        include_str!("../../../resources/templates/record-stand.json"),
    ),
    (
        "record-stand-dado",
        include_str!("../../../resources/templates/record-stand-dado.json"),
    ),
    (
        "side-table",
        include_str!("../../../resources/templates/side-table.json"),
    ),
    ("workbench", include_str!("../../../resources/templates/workbench.json")),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub id: &'static str,
    pub name: String,
    pub difficulty: Option<Difficulty>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub part_count: usize,
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
            Some(TemplateSummary {
                id,
                name: spec.name.clone(),
                difficulty: meta.difficulty,
                notes: meta.notes,
                tags: meta.tags.unwrap_or_default(),
                part_count: spec.parts.len(),
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
    fn every_template_parses() {
        for (id, _) in super::TEMPLATES {
            assert!(super::find(id).is_some(), "template {id} does not parse");
        }
        assert_eq!(super::all().len(), super::TEMPLATES.len());
    }
}
