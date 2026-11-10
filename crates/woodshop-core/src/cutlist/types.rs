//! Cut list types. Everything is derived from the spec and never stored. Decimal inches.

use serde::{Deserialize, Serialize};

fn is_false(b: &bool) -> bool {
    !*b
}

/// One row of the parts table: a distinct part and how many to cut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartRow {
    pub part_id: String,
    pub name: String,
    pub material_id: String,
    pub material_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub species: Option<String>,
    /// Has a curve op: cut the rectangular blank, then template.
    #[serde(default, skip_serializing_if = "is_false")]
    pub curved: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub notched: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub mitered: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub eased: bool,
    pub length: f64,
    pub width: f64,
    pub thickness: f64,
    pub qty: u32,
    pub board_feet: f64,
}

/// A placed piece on a sheet (origin bottom-left; x along length, y along width).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub part_id: String,
    pub name: String,
    /// 0-based sheet index within its material group.
    pub sheet: usize,
    pub x: f64,
    pub y: f64,
    /// Footprint after any grain-legal rotation.
    pub w: f64,
    pub h: f64,
    pub rotated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SheetSize {
    pub l: f64,
    pub w: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPlan {
    pub material_id: String,
    pub material_name: String,
    pub sheet_size: SheetSize,
    pub sheet_count: usize,
    pub placements: Vec<Placement>,
    /// Fraction of used sheet area that is offcut (0..1).
    pub waste: f64,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumberCut {
    pub part_id: String,
    pub name: String,
    pub length: f64,
    /// 0-based stick index.
    pub stick: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumberPlan {
    pub material_id: String,
    pub material_name: String,
    pub stock_length: f64,
    pub stick_count: usize,
    pub cuts: Vec<LumberCut>,
    pub waste: f64,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HardwareKind {
    PocketScrew,
    WoodScrew,
    Dowel,
    Hinge,
    DrawerSlide,
    Knob,
}

/// One line of the hardware list: the metal to buy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardwareRow {
    pub kind: HardwareKind,
    /// Shop notation, e.g. `#8 × 1 1/4" wood screws`.
    pub description: String,
    pub qty: u32,
    /// Estimated from a joint rather than counted off a fastener op.
    #[serde(default, skip_serializing_if = "is_false")]
    pub derived: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutListTotals {
    pub board_feet: f64,
    pub sheet_count: usize,
    pub estimated_cost: Option<f64>,
    /// Overall offcut fraction across all material (0..1).
    pub waste_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CutList {
    pub parts: Vec<PartRow>,
    pub sheets: Vec<SheetPlan>,
    pub lumber: Vec<LumberPlan>,
    pub hardware: Vec<HardwareRow>,
    pub totals: CutListTotals,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CutListConfig {
    /// Saw kerf between adjacent pieces.
    pub kerf: f64,
}

impl Default for CutListConfig {
    fn default() -> Self {
        Self { kerf: 0.125 }
    }
}
