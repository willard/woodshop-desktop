//! The hardware catalog and where a mounted piece sits on its part.
//!
//! The catalog is data (`resources/hardware.json`): every item has true dimensions and a
//! parametric `model` the 3D view builds its geometry from, so there are no mesh files to ship
//! or license. It is compiled into the core so the app, the cut list, the PDF, the offline viewer
//! and MCP agents all read the same list.
//!
//! A spec refers to items by id in two places: `hardware[]` (a piece mounted on a side of a part)
//! and a movable's `hinge` / `slide` / `pull`.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::spec::{HardwareMount, Part, Side};

pub const CATALOG_JSON: &str = include_str!("../../../resources/hardware.json");

/// What a movable can use an item as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Hinge,
    Slide,
    Pull,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub category: String,
    /// One of them, for a picker: `Bar pull, 96 mm centers`.
    pub name: String,
    /// Several of them, for the hardware list: `bar pulls, 96 mm centers`.
    pub list: String,
    /// The same item as a metric shop stocks it (`Butt hinge 64 mm`), for an item whose name
    /// gives an inch size. The model stays in inches; only the words change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<Names>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    /// `false` for items that only make sense on a movable (drawer slides).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub placeable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `shape` plus that shape's dimensions in inches; the 3D view builds geometry from it.
    pub model: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Names {
    pub name: String,
    pub list: String,
}

impl Item {
    /// The picker name in the reader's units.
    pub fn name_in(&self, units: crate::units::Units) -> &str {
        match (&self.metric, units) {
            (Some(m), crate::units::Units::Metric) => &m.name,
            _ => &self.name,
        }
    }

    /// The hardware-list phrase in the reader's units.
    pub fn list_in(&self, units: crate::units::Units) -> &str {
        match (&self.metric, units) {
            (Some(m), crate::units::Units::Metric) => &m.list,
            _ => &self.list,
        }
    }
}

fn yes() -> bool {
    true
}

fn is_true(v: &bool) -> bool {
    *v
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Catalog {
    pub categories: Vec<Category>,
    pub items: Vec<Item>,
}

pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(CATALOG_JSON).expect("bundled hardware catalog is valid"))
}

pub fn find(id: &str) -> Option<&'static Item> {
    catalog().items.iter().find(|item| item.id == id)
}

/// Default catalog ids for a movable that names none, matching what the app always drew.
pub const DEFAULT_PULL: &str = "knob.round-1-1-4";
pub const DEFAULT_SLIDE: &str = "slide.side-mount";
pub const DEFAULT_HINGE_OVERLAY: &str = "hinge.euro-full-overlay";
pub const DEFAULT_HINGE_INSET: &str = "hinge.butt-2-5in";

/// The size of a part's side, as `(first axis, second axis)` — the range a mount's `(x, y)` may
/// take. Faces: length × width. l-edges: length × thickness. w-edges (ends): width × thickness.
pub fn side_extent(part: &Part, thickness: f64, side: Side) -> (f64, f64) {
    match side {
        Side::Front | Side::Back => (part.size.l, part.size.w),
        Side::L0 | Side::L1 => (part.size.l, thickness),
        Side::W0 | Side::W1 => (part.size.w, thickness),
    }
}

/// Where a mount sits in its part's LOCAL frame (§3.1): the point on the surface, the outward
/// normal, and the direction the piece's long axis runs at `rot: 0`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct MountFrame {
    pub point: [f64; 3],
    pub normal: [f64; 3],
    pub along: [f64; 3],
}

pub fn mount_frame(part: &Part, thickness: f64, mount: &HardwareMount) -> MountFrame {
    let (hl, hw, ht) = (part.size.l / 2.0, part.size.w / 2.0, thickness / 2.0);
    let (x, y) = (mount.x, mount.y);
    match mount.side {
        Side::Front => MountFrame {
            point: [-hl + x, -hw + y, ht],
            normal: [0.0, 0.0, 1.0],
            along: [1.0, 0.0, 0.0],
        },
        Side::Back => MountFrame {
            point: [-hl + x, -hw + y, -ht],
            normal: [0.0, 0.0, -1.0],
            along: [1.0, 0.0, 0.0],
        },
        Side::L0 => MountFrame {
            point: [-hl + x, -hw, -ht + y],
            normal: [0.0, -1.0, 0.0],
            along: [1.0, 0.0, 0.0],
        },
        Side::L1 => MountFrame {
            point: [-hl + x, hw, -ht + y],
            normal: [0.0, 1.0, 0.0],
            along: [1.0, 0.0, 0.0],
        },
        Side::W0 => MountFrame {
            point: [-hl, -hw + x, -ht + y],
            normal: [-1.0, 0.0, 0.0],
            along: [0.0, 1.0, 0.0],
        },
        Side::W1 => MountFrame {
            point: [hl, -hw + x, -ht + y],
            normal: [1.0, 0.0, 0.0],
            along: [0.0, 1.0, 0.0],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every shape the 3D view can draw and the fields it reads: numbers, or (for the named
    /// ones) a flag or a word. `resources/DATA.md` documents each, for contributors.
    const SHAPES: &[(&str, &[&str])] = &[
        ("knob", &["diameter", "projection", "square"]),
        ("barPull", &["centers", "length", "diameter", "projection"]),
        ("archPull", &["centers", "diameter", "projection"]),
        ("cupPull", &["width", "height", "projection"]),
        ("buttHinge", &["height", "width", "knuckle"]),
        ("pianoHinge", &["length", "width", "knuckle"]),
        ("teeHinge", &["length", "height", "knuckle"]),
        ("euroHinge", &["cup", "cupDepth", "boring", "overlay", "arm"]),
        ("slide", &["mount", "height", "thickness"]),
        ("caster", &["wheel", "height", "plate", "swivel", "brake"]),
        ("leveler", &["base", "height", "stem"]),
        ("cornerBracket", &["leg", "width", "thickness"]),
        ("flatPlate", &["length", "width", "thickness"]),
        ("shelfPin", &["diameter", "length"]),
        ("barrelBolt", &["length", "width", "projection"]),
        ("hasp", &["length", "width", "projection"]),
        ("block", &["length", "width", "projection"]),
        ("lidStay", &["length", "width", "projection"]),
        ("chestHandle", &["width", "height", "projection"]),
        ("hook", &["height", "width", "projection", "double"]),
    ];
    const FLAGS: &[&str] = &["square", "swivel", "brake", "double"];

    #[test]
    fn every_model_uses_its_shapes_fields() {
        for item in &catalog().items {
            let shape = item.model["shape"].as_str().unwrap();
            let (_, fields) = SHAPES
                .iter()
                .find(|(s, _)| *s == shape)
                .unwrap_or_else(|| panic!("{}: unknown shape {shape}", item.id));
            for (key, value) in item.model.iter().filter(|(k, _)| *k != "shape") {
                assert!(
                    fields.contains(&key.as_str()),
                    "{}: {shape} has no field {key}",
                    item.id
                );
                let ok = match key.as_str() {
                    k if FLAGS.contains(&k) => value.is_boolean(),
                    "mount" => matches!(value.as_str(), Some("side" | "under")),
                    _ => value.as_f64().is_some_and(|n| n >= 0.0),
                };
                assert!(ok, "{}: {key} = {value}", item.id);
            }
        }
    }

    #[test]
    fn the_contributor_guide_documents_every_shape() {
        let guide = include_str!("../../../resources/DATA.md");
        for (shape, fields) in SHAPES {
            let heading = guide
                .lines()
                .position(|l| l.starts_with("#### ") && l.contains(&format!("`{shape}`")))
                .unwrap_or_else(|| panic!("DATA.md has no section for {shape}"));
            let section: String = guide
                .lines()
                .skip(heading + 1)
                .take_while(|l| !l.starts_with('#'))
                .collect::<Vec<_>>()
                .join("\n");
            for field in *fields {
                assert!(
                    section.contains(&format!("`{field}`")),
                    "DATA.md: {shape} does not explain {field}"
                );
            }
        }
    }

    #[test]
    fn catalog_is_well_formed() {
        let c = catalog();
        assert!(c.items.len() >= 60, "{} items", c.items.len());
        let mut ids: Vec<&str> = c.items.iter().map(|i| i.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), c.items.len(), "ids are unique");
        for item in &c.items {
            assert!(
                c.categories.iter().any(|cat| cat.id == item.category),
                "{}: category",
                item.id
            );
            assert!(
                item.model.get("shape").is_some_and(Value::is_string),
                "{}: shape",
                item.id
            );
            for (key, value) in &item.model {
                if let Some(n) = value.as_f64() {
                    assert!((0.0..60.0).contains(&n), "{}: {key} = {n}", item.id);
                }
            }
        }
        for id in [DEFAULT_PULL, DEFAULT_SLIDE, DEFAULT_HINGE_OVERLAY, DEFAULT_HINGE_INSET] {
            assert!(find(id).is_some(), "default {id} exists");
        }
        assert!(!find(DEFAULT_SLIDE).unwrap().placeable);
        assert_eq!(find("pull.bar-96mm").unwrap().role, Some(Role::Pull));
    }
}
