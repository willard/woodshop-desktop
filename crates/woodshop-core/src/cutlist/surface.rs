//! How much surface there is to finish: both faces and all four edges of every part (a round part's
//! barrel and ends), joinery and hidden faces counted too, so finish bought on it is never short.

use crate::spec::{MaterialType, Spec};

/// Square feet a quart of finish covers in one coat: a brushed polyurethane or paint label's
/// figure (about 400 a gallon). Oils and thin wipe-ons go further.
pub const SQ_FT_PER_QUART: f64 = 100.0;

/// The design's surface to finish, in square feet.
pub fn finish_area(spec: &Spec) -> f64 {
    spec.parts
        .iter()
        .filter_map(|part| {
            let material = spec.materials.iter().find(|m| m.id == part.material_id)?;
            let (l, t) = (part.size.l, material.thickness);
            let area = if material.kind == MaterialType::Round {
                let r = t / 2.0;
                std::f64::consts::PI * t * l + 2.0 * std::f64::consts::PI * r * r
            } else {
                let w = part.size.w;
                2.0 * (l * w + l * t + w * t)
            };
            Some(area * f64::from(part.qty()) / 144.0)
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec;
    use serde_json::json;

    #[test]
    fn a_panel_has_two_faces_and_four_edges_to_finish() {
        let raw = json!({
            "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Panels", "units": "in",
            "materials": [{ "id": "ply", "name": "Plywood", "type": "sheet", "thickness": 0.75 }],
            "parts": [{ "id": "p", "name": "Panel", "materialId": "ply", "size": { "l": 24, "w": 12 },
                "qty": 2, "transform": { "pos": [0, 0, 0] } }],
        });
        let spec = spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap();
        // Faces 2 × 288 and edges 2 × (18 + 9) square inches, twice over.
        let each = 2.0 * 288.0 + 2.0 * (24.0 * 0.75 + 12.0 * 0.75);
        assert!((finish_area(&spec) - 2.0 * each / 144.0).abs() < 1e-9);
    }
}
