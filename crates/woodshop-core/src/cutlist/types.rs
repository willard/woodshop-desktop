//! Cut list types. Everything is derived from the spec and never stored. Decimal inches.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    /// 0-based sheet index within its material group. Indices from `sheet_count` on are the
    /// user's own offcuts, in the order of [`SheetPlan::offcuts`].
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
    /// Sheets to buy.
    pub sheet_count: usize,
    pub placements: Vec<Placement>,
    /// Fraction of used sheet area that is offcut (0..1).
    pub waste: f64,
    pub cost: Option<f64>,
    /// The user's offcuts that pieces are cut from, before any sheet is bought. Placement sheet
    /// `sheet_count + i` is offcut `i`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub offcuts: Vec<UsedOffcut>,
    /// Pieces worth keeping once the parts are cut out.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub leftovers: Vec<Leftover>,
}

/// A piece left over once a plan's parts are cut, big enough to keep: at least 12" by 6" of
/// sheet, or 12" of board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Leftover {
    /// The sheet or stick it is left on, numbered as the plan's placements or cuts are.
    pub sheet: usize,
    /// Where it starts: along the length, and across the width on a sheet (as placements are).
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Length (along the grain), and width for a piece of sheet.
    pub l: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
}

/// One of the user's offcuts a plan cuts pieces from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsedOffcut {
    pub id: String,
    /// Length (along the grain), and width for a sheet offcut.
    pub l: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
}

/// A piece of stock the user already has: a part sheet or a short board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offcut {
    pub id: String,
    /// The material it is, by name ("Baltic Birch 18mm"); matched with the thickness.
    pub material: String,
    pub thickness: f64,
    /// Length along the grain.
    pub l: f64,
    /// Width, for a sheet offcut; a board offcut is used for its length.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
}

impl Offcut {
    /// Whether this offcut is `material`: the same name (any case) and thickness to a 64th.
    pub fn is(&self, material: &crate::spec::Material) -> bool {
        self.material.trim().eq_ignore_ascii_case(material.name.trim())
            && (self.thickness - material.thickness).abs() < 1.0 / 64.0
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumberCut {
    pub part_id: String,
    pub name: String,
    pub length: f64,
    /// 0-based stick index. Indices from `stick_count` on are the user's own offcuts, in the
    /// order of [`LumberPlan::offcuts`].
    pub stick: usize,
    /// Where the cut starts along the board.
    #[serde(default)]
    pub x: f64,
    /// Where it starts across the board, when narrow parts are ripped side by side.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub y: f64,
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumberPlan {
    pub material_id: String,
    pub material_name: String,
    pub stock_length: f64,
    /// The board width, when the material gives one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stock_width: Option<f64>,
    /// Boards to buy.
    pub stick_count: usize,
    /// Each bought board's length, where they differ: a board is cut from the shortest listed
    /// length its cuts fit. Empty when every board is `stock_length`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub board_lengths: Vec<f64>,
    pub cuts: Vec<LumberCut>,
    pub waste: f64,
    pub cost: Option<f64>,
    /// The user's offcuts cut from first. Cut stick `stick_count + i` is offcut `i`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub offcuts: Vec<UsedOffcut>,
    /// Board ends worth keeping once the parts are cut.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub leftovers: Vec<Leftover>,
}

impl LumberPlan {
    /// The length of bought board `i`.
    pub fn board_length(&self, i: usize) -> f64 {
        self.board_lengths.get(i).copied().unwrap_or(self.stock_length)
    }

    /// The boards to buy as (length, how many), longest first.
    pub fn bought(&self) -> Vec<(f64, usize)> {
        let mut out: Vec<(f64, usize)> = Vec::new();
        for i in 0..self.stick_count {
            let l = self.board_length(i);
            match out.iter_mut().find(|(len, _)| (len - l).abs() < 1e-9) {
                Some((_, n)) => *n += 1,
                None => out.push((l, 1)),
            }
        }
        out.sort_by(|a, b| b.0.total_cmp(&a.0));
        out
    }
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
    /// Any other catalog hardware mounted on a part (1.15): casters, brackets, latches…
    Other,
    /// Edge banding for the banded edges of one material (1.16), in whole feet or metres.
    EdgeBanding,
}

/// One line of the hardware list: the metal to buy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareRow {
    /// Stable for the same thing to buy, whatever the units or wording: what a price is kept by.
    pub key: String,
    pub kind: HardwareKind,
    /// Shop notation, e.g. `#8 × 1 1/4" wood screws`.
    pub description: String,
    pub qty: u32,
    /// Estimated from a joint rather than counted off a fastener op.
    #[serde(default, skip_serializing_if = "is_false")]
    pub derived: bool,
    /// The price of one (or one foot or metre of banding), from the user's price list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price: Option<f64>,
    /// `qty × unit_price`, when it has a price.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutListTotals {
    pub board_feet: f64,
    pub sheet_count: usize,
    /// Materials plus priced hardware; `None` when nothing has a price.
    pub estimated_cost: Option<f64>,
    /// What the priced sheets and lumber cost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_cost: Option<f64>,
    /// What the priced hardware costs (rows without a price count nothing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware_cost: Option<f64>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CutListConfig {
    /// Saw kerf between adjacent pieces.
    pub kerf: f64,
    /// How the hardware list words its sizes. The cut list's numbers are inches regardless.
    #[serde(default)]
    pub units: crate::units::Units,
    /// The user's hardware prices, by [`HardwareRow::key`]: each, or per foot or metre of banding.
    #[serde(default, rename = "hardwarePrices", skip_serializing_if = "BTreeMap::is_empty")]
    pub hardware_prices: BTreeMap<String, f64>,
    /// Stock the user already has, used before anything is bought.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub offcuts: Vec<Offcut>,
}

impl Default for CutListConfig {
    fn default() -> Self {
        Self {
            kerf: 0.125,
            units: crate::units::Units::Fraction,
            hardware_prices: BTreeMap::new(),
            offcuts: Vec::new(),
        }
    }
}
