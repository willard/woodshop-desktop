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
