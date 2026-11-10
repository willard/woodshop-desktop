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
