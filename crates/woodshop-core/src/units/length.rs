//! Length unit conversion for the display layer. Metric is a conversion on the way in and out,
//! never a second internal unit.

use serde::{Deserialize, Serialize};

/// Millimetres in an inch. Exact by definition.
pub const MM_PER_INCH: f64 = 25.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LengthUnit {
    In,
    Ft,
    Mm,
    Cm,
    M,
}

impl LengthUnit {
    fn per_inch(self) -> f64 {
        match self {
            Self::In => 1.0,
            Self::Ft => 1.0 / 12.0,
            Self::Mm => MM_PER_INCH,
            Self::Cm => MM_PER_INCH / 10.0,
            Self::M => MM_PER_INCH / 1000.0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::In => "in",
            Self::Ft => "ft",
            Self::Mm => "mm",
            Self::Cm => "cm",
            Self::M => "m",
        }
    }
}

/// A value the user typed in `unit`, as decimal inches.
pub fn to_inches(value: f64, unit: LengthUnit) -> f64 {
    value / unit.per_inch()
}

/// Decimal inches, expressed in `unit`.
pub fn from_inches(inches: f64, unit: LengthUnit) -> f64 {
    inches * unit.per_inch()
}

/// Whole feet and the remainder: 38.5 → (3, 2.5). Negative input keeps its sign on the feet.
pub fn feet_and_inches(inches: f64) -> (f64, f64) {
    if !inches.is_finite() {
        return (0.0, 0.0);
    }
    let sign = if inches < 0.0 { -1.0 } else { 1.0 };
    let abs = inches.abs();
    let feet = (abs / 12.0).floor();
    (sign * feet, abs - feet * 12.0)
}
