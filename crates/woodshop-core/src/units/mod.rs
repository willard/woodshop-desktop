//! Display-layer conversions. Storage is always decimal inches.

pub mod display;
pub mod fraction;
pub mod length;

pub use display::{Units, format_length, format_length_value, format_size, parse_length, parse_signed_length};
pub use fraction::{format_fraction, inch_label, parse_fraction, parse_signed_fraction};
pub use length::{LengthUnit, MM_PER_INCH, feet_and_inches, from_inches, to_inches};
