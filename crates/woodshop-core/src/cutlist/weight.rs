//! How much the finished piece weighs, wood only: each part's volume at a typical density for its
//! material, read from the material's name ("MDF", "Baltic Birch", "Cedar 4x4") and else its
//! species and kind. Densities are air-dried averages; a board varies by 10% or more either way,
//! so this is an estimate for hanging, moving and choosing casters, not a shipping weight.

use crate::spec::{Material, MaterialType, Spec};

/// Pounds per cubic foot, by a word in the material's name: the first match wins, so sheet goods
/// come before the woods they are faced with.
const BY_NAME: &[(&str, f64)] = &[
    ("mdf", 47.0),
    ("hardboard", 55.0),
    ("particle", 42.0),
    ("melamine", 45.0),
    ("osb", 38.0),
    ("baltic", 43.0),
    ("ply", 36.0),
    ("hickory", 51.0),
    ("beech", 45.0),
    ("oak", 45.0),
    ("maple", 44.0),
    ("birch", 43.0),
    ("ash", 41.0),
    ("teak", 41.0),
    ("walnut", 38.0),
    ("cherry", 35.0),
    ("mahogany", 34.0),
    ("fir", 32.0),
    ("pine", 30.0),
    ("spf", 28.0),
    ("poplar", 28.0),
    ("alder", 28.0),
    ("redwood", 26.0),
    ("cedar", 23.0),
];

/// A material's density in pounds per cubic foot.
pub fn density(material: &Material) -> f64 {
    let name = material.name.to_lowercase();
    if let Some(&(_, d)) = BY_NAME.iter().find(|(word, _)| name.contains(word)) {
        return d;
    }
    match (material.kind, material.species) {
        // A sheet named for nothing in the list is taken as plywood, whatever its face veneer.
        (MaterialType::Sheet, _) => 36.0,
        (_, Some(species)) => BY_NAME
            .iter()
            .find(|(word, _)| *word == species.as_str())
            .map_or(30.0, |&(_, d)| d),
        _ => 30.0,
    }
}

/// The design's wood, in pounds: every part at its full blank size, cuts and joinery ignored.
pub fn wood_weight(spec: &Spec) -> f64 {
    spec.parts
        .iter()
        .filter_map(|part| {
            let material = spec.materials.iter().find(|m| m.id == part.material_id)?;
            let t = material.thickness;
            let volume = if material.kind == MaterialType::Round {
                std::f64::consts::PI * t * t / 4.0 * part.size.l
            } else {
                part.size.l * part.size.w * t
            };
            Some(volume * f64::from(part.qty()) * density(material) / 1728.0)
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec;
    use serde_json::json;

    fn material(kind: &str, name: &str, species: Option<&str>) -> Material {
        let mut m = json!({ "id": "m", "type": kind, "name": name, "thickness": 0.75 });
        if let Some(s) = species {
            m["species"] = json!(s);
        }
        serde_json::from_value(m).unwrap()
    }

    #[test]
    fn the_name_says_the_material_before_the_species_does() {
        assert_eq!(density(&material("sheet", "MDF 3/4\"", None)), 47.0);
        assert_eq!(density(&material("sheet", "Baltic Birch 18mm", None)), 43.0);
        // Birch plywood is plywood, not solid birch, whatever species its veneer is given.
        assert_eq!(density(&material("sheet", "Birch Plywood", Some("maple"))), 36.0);
        assert_eq!(density(&material("lumber", "Cedar 4x4", None)), 23.0);
        assert_eq!(density(&material("lumber", "2x4 SPF", None)), 28.0);
        assert_eq!(density(&material("lumber", "Legs", Some("walnut"))), 38.0);
        assert_eq!(density(&material("lumber", "Legs", None)), 30.0);
        assert_eq!(density(&material("sheet", "Panel", None)), 36.0);
    }

    #[test]
    fn a_full_sheet_of_three_quarter_plywood_weighs_what_one_does() {
        let raw = json!({
            "specVersion": spec::migrate::CURRENT_SPEC_VERSION, "name": "Sheet", "units": "in",
            "materials": [{ "id": "ply", "name": "Plywood", "type": "sheet", "thickness": 0.75 }],
            "parts": [{ "id": "p", "name": "Panel", "materialId": "ply", "size": { "l": 96, "w": 48 },
                "transform": { "pos": [0, 0, 0] } }],
        });
        let spec = spec::from_value(spec::migrate_to_latest(raw).unwrap()).unwrap();
        // 2 cubic feet at 36 lb: a sheet of 3/4" plywood is about 70 lb.
        assert!((wood_weight(&spec) - 72.0).abs() < 1e-9);
    }
}
