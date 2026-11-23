//! Doors and drawers (§3.3). Shop tables and derivations shared by the cut list, the linter, the
//! renderer and the presets: one definition of "how many hinges does this door take".

use std::collections::HashMap;

use crate::geometry::local_axes_world;
use crate::spec::{Edge, Movable, Part, Spec, Vec3};

/// How far an overlay door/drawer front laps the opening, per side.
pub const OVERLAY_ALLOWANCE: f64 = 0.5;
/// The gap an inset door leaves to the opening, per side.
pub const INSET_REVEAL: f64 = 0.0625;
/// Side clearance a drawer box leaves for its slides, per side.
pub const SLIDE_CLEARANCE: f64 = 0.5;
/// Stock side-mount slide lengths.
pub const SLIDE_LENGTHS: [f64; 8] = [10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0];
/// A movable farther than this from the rest of the assembly has nothing to mount hardware on.
pub const HARDWARE_REACH: f64 = 1.0;

/// Two hinges, and a third once the hinge edge runs past 40".
pub fn hinge_count_for(hinge_edge_length: f64) -> u32 {
    if hinge_edge_length > 40.0 { 3 } else { 2 }
}

/// Longest stock slide that fits the box depth; the shortest stock size when nothing does.
pub fn slide_length_for(box_depth: f64) -> f64 {
    SLIDE_LENGTHS
        .iter()
        .copied()
        .rfind(|&l| l <= box_depth)
        .unwrap_or(SLIDE_LENGTHS[0])
}

/// Length of the panel edge the hinges mount on.
pub fn hinge_edge_length(panel: &Part, hinge_edge: Edge) -> f64 {
    if hinge_edge.is_l_edge() {
        panel.size.l
    } else {
        panel.size.w
    }
}

/// The anchor's world front normal (local +Z) — a drawer's pull-out direction.
pub fn front_normal(anchor: &Part) -> Vec3 {
    local_axes_world(anchor)[2]
}

/// Extent of a set of parts along a world direction (a drawer's depth along its front normal).
pub fn extent_along(parts: &[&Part], thickness_of: impl Fn(&Part) -> f64, axis: Vec3) -> f64 {
    if parts.is_empty() {
        return 0.0;
    }
    let dot = |u: Vec3| u[0] * axis[0] + u[1] * axis[1] + u[2] * axis[2];
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for part in parts {
        let [ax, ay, az] = local_axes_world(part);
        let half = [part.size.l / 2.0, part.size.w / 2.0, thickness_of(part) / 2.0];
        let centre = dot(part.transform.pos);
        let reach = (dot(ax) * half[0]).abs() + (dot(ay) * half[1]).abs() + (dot(az) * half[2]).abs();
        lo = lo.min(centre - reach);
        hi = hi.max(centre + reach);
    }
    hi - lo
}

/// partId → the movable it belongs to. First wins; the linter errors duplicates.
pub fn movable_member_of(spec: &Spec) -> HashMap<&str, &Movable> {
    let mut by_part = HashMap::new();
    for movable in spec.movables() {
        for id in movable.part_ids() {
            by_part.entry(id.as_str()).or_insert(movable);
        }
    }
    by_part
}

/// Hinges sit this far in from each end of the hinge edge.
pub const HINGE_INSET: f64 = 3.0;

/// How far a leaf reaches out from its hinge edge: the panel's other dimension.
pub fn leaf_depth(leaf: &Part, hinge_edge: Edge) -> f64 {
    if hinge_edge.is_l_edge() {
        leaf.size.w
    } else {
        leaf.size.l
    }
}

/// The folding bracket a leaf `depth` deep gets when it names none: the longest whose arm stops
/// at least an inch short of the free edge, or the shortest there is.
pub fn leaf_support_for(depth: f64) -> Option<&'static crate::hardware::Item> {
    let arm = |item: &crate::hardware::Item| item.model.get("arm").and_then(serde_json::Value::as_f64);
    let mut brackets: Vec<&crate::hardware::Item> = crate::hardware::catalog()
        .items
        .iter()
        .filter(|i| i.model.get("shape").and_then(|s| s.as_str()) == Some("foldingBracket"))
        .collect();
    brackets.sort_by(|a, b| arm(a).partial_cmp(&arm(b)).unwrap_or(std::cmp::Ordering::Equal));
    brackets
        .iter()
        .rev()
        .find(|i| arm(i).is_some_and(|a| a <= depth - 1.0))
        .or(brackets.first())
        .copied()
}
/// Wood a cup bore must leave behind it, or the bit's point comes through the show face.
pub const CUP_FLOOR: f64 = 0.0625;

/// Where each hinge sits along the hinge edge, measured from the edge's centre: evenly spaced
/// between the two inset positions, so a third hinge lands in the middle. On an edge too short
/// for the insets they all collapse to the centre, and one position is returned.
pub fn hinge_offsets(hinge_edge_length: f64) -> Vec<f64> {
    let reach = (hinge_edge_length / 2.0 - HINGE_INSET).max(0.0);
    if reach == 0.0 {
        return vec![0.0];
    }
    let count = hinge_count_for(hinge_edge_length);
    (0..count)
        .map(|i| (-1.0 + 2.0 * f64::from(i) / f64::from(count - 1)) * reach)
        .collect()
}

/// A hole the chosen hardware needs that nobody authored: the cup of a concealed hinge.
///
/// Borings are DERIVED from the movable every time they are needed — by the 3D view, the shop
/// templates, the plan and the linter — and never written into `part.ops`, so changing the hinge
/// or resizing the door cannot leave stale holes behind.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Boring {
    pub part_id: String,
    pub movable_id: String,
    /// The catalog item that asks for the hole.
    pub item: String,
    pub hole: crate::spec::Hole,
}

/// Every hole the design's door hardware needs: for each door hung on concealed (Euro) hinges,
/// one cup per hinge in the panel's back face, centred `boring` in from the hinge edge.
pub fn derived_borings(spec: &Spec) -> Vec<Boring> {
    use crate::spec::{Face, Hole, HolePurpose};
    let mut out = Vec::new();
    for movable in spec.movables() {
        let Movable::Door {
            id,
            panel_part_id,
            hinge_edge,
            hinge,
            ..
        } = movable
        else {
            continue;
        };
        // No hinge named means the generic "overlay cabinet hinges" of the hardware list: nothing
        // says they are concealed, so nothing is bored.
        let Some(item_id) = hinge.as_deref() else { continue };
        let Some(item) = crate::hardware::find(item_id) else {
            continue;
        };
        let num = |key: &str| item.model.get(key).and_then(serde_json::Value::as_f64);
        if item.model.get("shape").and_then(|s| s.as_str()) != Some("euroHinge") {
            continue;
        }
        let (Some(cup), Some(cup_depth), Some(boring)) = (num("cup"), num("cupDepth"), num("boring")) else {
            continue;
        };
        let Some(panel) = spec.part(panel_part_id) else {
            continue;
        };
        let (l, w) = (panel.size.l, panel.size.w);
        for offset in hinge_offsets(hinge_edge_length(panel, *hinge_edge)) {
            let (x, y) = match hinge_edge {
                Edge::L0 => (l / 2.0 + offset, boring),
                Edge::L1 => (l / 2.0 + offset, w - boring),
                Edge::W0 => (boring, w / 2.0 + offset),
                Edge::W1 => (l - boring, w / 2.0 + offset),
            };
            out.push(Boring {
                part_id: panel.id.clone(),
                movable_id: id.clone(),
                item: item.id.clone(),
                hole: Hole {
                    face: Face::Back,
                    x,
                    y,
                    diameter: cup,
                    depth: Some(cup_depth),
                    purpose: Some(HolePurpose::Hardware),
                },
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec;
    use serde_json::json;

    fn door_spec(hinge: Option<&str>, hinge_edge: &str, l: f64, w: f64) -> Spec {
        let mut door = json!({ "id": "d", "kind": "door", "partIds": ["p_door"], "panelPartId": "p_door",
            "hingeEdge": hinge_edge, "style": "overlay" });
        if let Some(h) = hinge {
            door["hinge"] = json!(h);
        }
        let raw = json!({
            "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Cabinet", "units": "in",
            "materials": [{ "id": "ply", "name": "Plywood", "type": "sheet", "thickness": 0.75 }],
            "parts": [{ "id": "p_door", "name": "Door", "materialId": "ply", "size": { "l": l, "w": w },
                "transform": { "pos": [0, 0, 0] } }],
            "movables": [door],
        });
        spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap()
    }

    #[test]
    fn a_leaf_gets_the_longest_bracket_that_stops_short_of_its_edge() {
        let arm = |depth: f64| leaf_support_for(depth).unwrap().model["arm"].as_f64().unwrap();
        assert_eq!(arm(24.0), 20.0);
        assert_eq!(arm(18.0), 16.0);
        assert_eq!(arm(16.5), 12.0);
        assert_eq!(arm(6.0), 10.0, "nothing fits: the shortest");
    }

    #[test]
    fn hinges_spread_between_the_insets() {
        assert_eq!(hinge_offsets(30.0), vec![-12.0, 12.0]);
        assert_eq!(hinge_offsets(48.0), vec![-21.0, 0.0, 21.0]);
        // Too short for two: one, in the middle.
        assert_eq!(hinge_offsets(5.0), vec![0.0]);
    }

    #[test]
    fn a_euro_hinge_bores_a_cup_per_hinge_in_the_back_face() {
        // Hinged on w0 (the x = 0 end): cups 22.5 mm in from it, 3" from each end of the 30" edge.
        let borings = derived_borings(&door_spec(Some("hinge.euro-full-overlay"), "w0", 18.0, 30.0));
        assert_eq!(borings.len(), 2);
        let h = &borings[0].hole;
        assert_eq!(h.face, crate::spec::Face::Back);
        assert!((h.x - 0.8858).abs() < 1e-9 && (h.y - 3.0).abs() < 1e-9, "{h:?}");
        assert!((borings[1].hole.y - 27.0).abs() < 1e-9);
        assert!((h.diameter - 1.378).abs() < 1e-9);
        assert_eq!(h.depth, Some(0.4724));

        // The far long edge: measured back from it.
        let l1 = derived_borings(&door_spec(Some("hinge.euro-inset"), "l1", 30.0, 18.0));
        assert!((l1[0].hole.y - (18.0 - 0.8858)).abs() < 1e-9 && (l1[0].hole.x - 3.0).abs() < 1e-9);
    }

    #[test]
    fn surface_hinges_and_unnamed_hinges_bore_nothing() {
        assert!(derived_borings(&door_spec(Some("hinge.butt-2-5in"), "w0", 18.0, 30.0)).is_empty());
        assert!(derived_borings(&door_spec(None, "w0", 18.0, 30.0)).is_empty());
    }
}
