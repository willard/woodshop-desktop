//! The template gallery: finished designs a new project can start from. Bundled into the binary
//! (the app works offline) and parsed like any stored spec, so an older template is migrated.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Serialize;

use crate::cutlist::{CutListConfig, compute_cut_list};
use crate::geometry::{OverallSize, overall_size};
use crate::spec::{self, Author, Difficulty, Spec};

/// What the gallery says about each template, for someone choosing one: kept apart from the
/// design's own `meta.notes`, which are build notes for the maker (and for agents).
const GALLERY_JSON: &str = include_str!("../../../resources/template-gallery.json");

fn gallery() -> &'static HashMap<String, String> {
    static GALLERY: OnceLock<HashMap<String, String>> = OnceLock::new();
    GALLERY.get_or_init(|| serde_json::from_str(GALLERY_JSON).expect("bundled template gallery is valid"))
}

// Every `resources/templates/*.json`, by file name (see build.rs).
include!(concat!(env!("OUT_DIR"), "/templates.rs"));

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
    /// The maker the plan comes from (`meta.author`), for the card's credit.
    pub author: Option<Author>,
    pub part_count: usize,
    /// Finished size, inches: width × depth × height.
    pub overall: Option<OverallSize>,
    /// What to buy, from the cut list at the default kerf.
    pub sheet_count: usize,
    pub board_feet: f64,
    /// The tools it needs beyond the tape measure and clamps every build has, by name.
    pub tools: Vec<String>,
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
                build_steps: None,
                author: None,
            });
            let totals = compute_cut_list(&spec, CutListConfig::default()).totals;
            Some(TemplateSummary {
                id,
                name: spec.name.clone(),
                difficulty: meta.difficulty,
                summary: gallery().get(*id).cloned(),
                notes: meta.notes,
                tags: meta.tags.unwrap_or_default(),
                author: meta.author,
                part_count: spec.parts.len(),
                overall: overall_size(&spec),
                sheet_count: totals.sheet_count,
                board_feet: totals.board_feet,
                tools: crate::tools::card_tools(&spec),
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

    /// Every template could be built as drawn: the design checks find nothing, and no two parts
    /// fill the same space, except where one is let into the other (a dado, a rabbet, or a dowel
    /// in its hole). The checks allow some overlap a saw cannot make; this does not.
    #[test]
    fn every_template_builds_without_parts_running_into_each_other() {
        use crate::geometry::obb_penetration;
        use crate::spec::JointType;

        for (id, _) in super::TEMPLATES {
            let spec = super::find(id).unwrap();
            let issues: Vec<String> = crate::lint::lint(&spec).into_iter().map(|i| i.message).collect();
            assert!(issues.is_empty(), "{id}: {issues:#?}");
            let joints = spec.joints.as_deref().unwrap_or_default();
            for (i, a) in spec.parts.iter().enumerate() {
                for b in &spec.parts[i + 1..] {
                    let let_in = joints.iter().any(|j| {
                        matches!(j.kind, JointType::Dado | JointType::Rabbet | JointType::Dowel)
                            && ((j.host_part_id == a.id && j.insert_part_id == b.id)
                                || (j.host_part_id == b.id && j.insert_part_id == a.id))
                    });
                    let depth = obb_penetration(a, spec.thickness_of(a).unwrap(), b, spec.thickness_of(b).unwrap());
                    assert!(
                        let_in || depth <= 0.03,
                        "{id}: \"{}\" and \"{}\" overlap by {depth:.3}\"",
                        a.name,
                        b.name
                    );
                }
            }
        }
    }
}
