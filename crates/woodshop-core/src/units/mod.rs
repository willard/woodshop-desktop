//! Display-layer conversions. Storage is always decimal inches.

pub mod fraction;
pub mod length;

pub use fraction::{format_fraction, inch_label, parse_fraction, parse_signed_fraction};
pub use length::{LengthUnit, MM_PER_INCH, feet_and_inches, from_inches, to_inches};
