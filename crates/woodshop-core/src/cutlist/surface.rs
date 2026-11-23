//! How much surface there is to finish: both faces and all four edges of every part (a round part's
//! barrel and ends), joinery and hidden faces counted too, so finish bought on it is never short.
//! Painted parts need paint instead of a clear coat, stained parts a stain under it, and glass and
//! metal nothing (1.20).

use super::Coating;
use crate::spec::{AppearanceKind, Material, MaterialType, Part, Spec};

/// Square feet a quart of finish covers in one coat: a brushed polyurethane or paint label's
/// figure (about 400 a gallon). Oils and thin wipe-ons go further.
pub const SQ_FT_PER_QUART: f64 = 100.0;

/// A part's whole surface, in square feet, every copy counted.
fn part_area(part: &Part, material: &Material) -> f64 {
    let (l, t) = (part.size.l, material.thickness);
    let area = if material.kind == MaterialType::Round {
        let r = t / 2.0;
        std::f64::consts::PI * t * l + 2.0 * std::f64::consts::PI * r * r
    } else {
        let w = part.size.w;
        2.0 * (l * w + l * t + w * t)
    };
    area * f64::from(part.qty()) / 144.0
}

fn parts_with_material(spec: &Spec) -> impl Iterator<Item = (&Part, &Material)> {
    spec.parts
        .iter()
        .filter_map(|part| Some((part, spec.materials.iter().find(|m| m.id == part.material_id)?)))
}

/// The design's surface to clear-coat, in square feet: bare and stained wood. Painted parts, glass
/// and metal are left out.
pub fn finish_area(spec: &Spec) -> f64 {
    parts_with_material(spec)
        .filter(|(_, m)| matches!(m.look(), AppearanceKind::Wood | AppearanceKind::Stain))
        .map(|(p, m)| part_area(p, m))
        .sum()
}

/// The paints and stains to buy, one row per colour, with the surface each covers.
pub fn coatings(spec: &Spec) -> Vec<Coating> {
    let mut rows: Vec<Coating> = Vec::new();
    for (part, material) in parts_with_material(spec) {
        let Some(look) = material.appearance.as_ref() else {
            continue;
        };
        if !matches!(look.kind, AppearanceKind::Paint | AppearanceKind::Stain) {
            continue;
        }
        add_coating(
            &mut rows,
            Coating {
                kind: look.kind,
                color: look.color.clone(),
                name: look.name.clone(),
                area: part_area(part, material),
            },
        );
    }
    rows
}

/// Adds a row to a list, adding its area to the row of the same paint or stain if there is one.
pub(crate) fn add_coating(rows: &mut Vec<Coating>, row: Coating) {
    let same = |r: &Coating| {
        r.kind == row.kind
            && r.color.as_deref().map(str::to_ascii_lowercase) == row.color.as_deref().map(str::to_ascii_lowercase)
            && r.name.as_deref().map(str::trim) == row.name.as_deref().map(str::trim)
    };
    match rows.iter_mut().find(|r| same(r)) {
        Some(r) => r.area += row.area,
        None => rows.push(row),
    }
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

    #[test]
    fn paint_and_stain_are_listed_by_colour_and_glass_needs_no_finish() {
        let raw = json!({
            "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Cabinet", "units": "in",
            "materials": [
                { "id": "ply", "name": "Plywood", "type": "sheet", "thickness": 0.75,
                  "appearance": { "kind": "paint", "color": "#8A9A5B", "name": "Sage green" } },
                { "id": "mdf", "name": "MDF", "type": "sheet", "thickness": 0.75,
                  "appearance": { "kind": "paint", "color": "#8a9a5b", "name": "Sage green" } },
                { "id": "oak", "name": "Oak", "type": "lumber", "thickness": 0.75,
                  "appearance": { "kind": "stain", "color": "#6b4423" } },
                { "id": "glass", "name": "Glass", "type": "sheet", "thickness": 0.125, "grain": false,
                  "appearance": { "kind": "glass" } }
            ],
            "parts": [
                { "id": "a", "name": "Side", "materialId": "ply", "size": { "l": 12, "w": 12 }, "transform": { "pos": [0, 0, 0] } },
                { "id": "b", "name": "Top", "materialId": "mdf", "size": { "l": 12, "w": 12 }, "transform": { "pos": [0, 20, 0] } },
                { "id": "c", "name": "Rail", "materialId": "oak", "size": { "l": 12, "w": 12 }, "transform": { "pos": [0, 40, 0] } },
                { "id": "d", "name": "Pane", "materialId": "glass", "size": { "l": 12, "w": 12 }, "transform": { "pos": [0, 60, 0] } }
            ],
        });
        let spec = spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap();
        let one = (2.0 * 144.0 + 4.0 * 12.0 * 0.75) / 144.0;
        let rows = coatings(&spec);
        assert_eq!(rows.len(), 2, "{rows:?}");
        assert_eq!(rows[0].kind, AppearanceKind::Paint);
        assert_eq!(rows[0].name.as_deref(), Some("Sage green"));
        assert!((rows[0].area - 2.0 * one).abs() < 1e-9);
        assert_eq!(rows[1].kind, AppearanceKind::Stain);
        // Only the stained rail takes a clear coat: paint covers the panels and glass needs none.
        assert!((finish_area(&spec) - one).abs() < 1e-9);
    }
}
