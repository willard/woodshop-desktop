//! The minimal valid spec for a brand-new design. The schema requires at least one material and
//! one part, so a blank project is seeded with a single base board; the user (or an MCP agent)
//! builds outward from there.

use super::CURRENT_SPEC_VERSION;
use super::types::*;

/// Options for the starter material. Everything defaults to 3/4" birch ply.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
pub struct StarterOptions {
    pub material_type: Option<MaterialType>,
    pub material_name: Option<String>,
    pub species: Option<Species>,
    pub thickness: Option<f64>,
    pub diameter: Option<f64>,
    pub stock_width: Option<f64>,
    pub stock_lengths: Option<Vec<f64>>,
    pub sheet_length: Option<f64>,
    pub sheet_width: Option<f64>,
}

impl StarterOptions {
    /// What a metric shop starts on: 18 mm birch plywood in 2440 × 1220 sheets.
    pub fn metric() -> Self {
        let mm = |v: f64| v / super::super::units::MM_PER_INCH;
        Self {
            material_name: Some("Birch Plywood 18 mm".into()),
            thickness: Some(mm(18.0)),
            sheet_length: Some(mm(2440.0)),
            sheet_width: Some(mm(1220.0)),
            ..Self::default()
        }
    }
}

fn capitalized(species: Species) -> String {
    let s = species.as_str();
    let mut chars = s.chars();
    chars
        .next()
        .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
        .unwrap_or_default()
}

/// Mirrors PHP's float-to-string for the generated names: 1.5 → "1.5", 0.75 → "0.75", 2 → "2".
fn num(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

pub fn minimal(name: &str, opts: &StarterOptions) -> Spec {
    let species_prefix = opts.species.map(|s| format!("{} ", capitalized(s))).unwrap_or_default();

    let (material, part_size) = match opts.material_type.unwrap_or(MaterialType::Sheet) {
        MaterialType::Lumber => {
            let thickness = opts.thickness.unwrap_or(1.5);
            let stock_width = opts.stock_width.unwrap_or(3.5);
            let material = Material {
                id: "mat_lumber".into(),
                kind: MaterialType::Lumber,
                name: opts
                    .material_name
                    .clone()
                    .unwrap_or_else(|| format!("{species_prefix}{}x{}", num(thickness), num(stock_width))),
                thickness,
                sheet_size: None,
                sheet_sizes: None,
                stock_lengths: Some(opts.stock_lengths.clone().unwrap_or_else(|| vec![96.0, 120.0])),
                stock_width: Some(stock_width),
                grain: Some(true),
                species: opts.species,
                cost_per_sheet: None,
                cost_per_board_foot: None,
            };
            (
                material,
                Size2 {
                    l: 24.0,
                    w: stock_width,
                },
            )
        }
        MaterialType::Round => {
            let diameter = opts.diameter.or(opts.thickness).unwrap_or(0.75);
            let material = Material {
                id: "mat_round".into(),
                kind: MaterialType::Round,
                name: opts
                    .material_name
                    .clone()
                    .unwrap_or_else(|| format!("{species_prefix}{}\" Dowel", num(diameter))),
                thickness: diameter,
                sheet_size: None,
                sheet_sizes: None,
                stock_lengths: Some(opts.stock_lengths.clone().unwrap_or_else(|| vec![36.0, 48.0])),
                stock_width: None,
                grain: Some(true),
                species: opts.species,
                cost_per_sheet: None,
                cost_per_board_foot: None,
            };
            (material, Size2 { l: 24.0, w: diameter })
        }
        MaterialType::Sheet => {
            let material = Material {
                id: "mat_ply34".into(),
                kind: MaterialType::Sheet,
                name: opts
                    .material_name
                    .clone()
                    .unwrap_or_else(|| "Birch Plywood 3/4\"".into()),
                thickness: opts.thickness.unwrap_or(0.75),
                sheet_size: Some(Size2 {
                    l: opts.sheet_length.unwrap_or(96.0),
                    w: opts.sheet_width.unwrap_or(48.0),
                }),
                sheet_sizes: None,
                stock_lengths: None,
                stock_width: None,
                grain: Some(true),
                species: opts.species,
                cost_per_sheet: None,
                cost_per_board_foot: None,
            };
            (material, Size2 { l: 24.0, w: 12.0 })
        }
    };

    Spec {
        spec_version: CURRENT_SPEC_VERSION.into(),
        units: "in".into(),
        name: if name.trim().is_empty() {
            "Untitled".into()
        } else {
            name.into()
        },
        parts: vec![Part {
            id: "p_base".into(),
            name: "Base".into(),
            material_id: material.id.clone(),
            size: part_size,
            grain_axis: Some(GrainAxis::L),
            transform: Transform {
                pos: [0.0, part_size.w / 2.0, 0.0],
                rot: Some([0.0; 3]),
            },
            ops: None,
            qty: None,
            locked: None,
        }],
        materials: vec![material],
        joints: Some(vec![]),
        groups: None,
        movables: None,
        hardware: None,
        meta: Some(Meta {
            difficulty: Some(Difficulty::Beginner),
            notes: None,
            tags: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{to_value, validate::validate};

    #[test]
    fn every_starter_is_schema_valid() {
        for t in [MaterialType::Sheet, MaterialType::Lumber, MaterialType::Round] {
            let spec = minimal(
                "Box",
                &StarterOptions {
                    material_type: Some(t),
                    ..Default::default()
                },
            );
            assert_eq!(validate(&to_value(&spec)), Ok(()), "{t:?}");
        }
    }

    #[test]
    fn lumber_name_uses_species_and_sizes() {
        let spec = minimal(
            "",
            &StarterOptions {
                material_type: Some(MaterialType::Lumber),
                species: Some(Species::Oak),
                ..Default::default()
            },
        );
        assert_eq!(spec.name, "Untitled");
        assert_eq!(spec.materials[0].name, "Oak 1.5x3.5");
    }
}
