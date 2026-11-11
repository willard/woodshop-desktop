//! How a length is shown to and read from a person. Storage is always decimal inches; this is
//! the one place that decides what "3/4", "0.75\"" or "19 mm" means on screen and on paper.
//!
//! Three systems: shop fractions (`3 1/2"`), decimal inches (`3.5"`) and metric millimetres
//! (`89 mm`). Whatever the system, input may name its own unit: `450mm`, `45 cm`, `17 3/4"`,
//! `1' 6"`. A bare number is read in the current system, except that a fraction is always
//! inches (nobody writes millimetres as fractions).

use serde::{Deserialize, Serialize};

use super::fraction::{DEFAULT_DENOMINATOR, format_fraction, parse_fraction};
use super::length::MM_PER_INCH;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Units {
    /// Shop fractions to 1/16": `3 1/2"`.
    #[default]
    Fraction,
    /// Decimal inches: `3.5"`.
    Decimal,
    /// Millimetres: `89 mm`.
    Metric,
}

impl Units {
    /// The unit a bare number is read in, for field labels: `in` or `mm`.
    pub fn suffix(self) -> &'static str {
        match self {
            Units::Fraction | Units::Decimal => "in",
            Units::Metric => "mm",
        }
    }
}

/// Trailing zeros and a bare point trimmed: 3.500 → "3.5", 2.0 → "2".
fn trim(text: String) -> String {
    if !text.contains('.') {
        return text;
    }
    let t = text.trim_end_matches('0').trim_end_matches('.');
    if t == "-0" { "0".into() } else { t.into() }
}

/// Millimetres the way a metric shop writes them: whole mm, but one decimal under 10 mm, where
/// a tenth matters (a 3.2 mm kerf, a 6.4 mm hole).
fn mm(inches: f64) -> String {
    let v = inches * MM_PER_INCH;
    if v.abs() < 10.0 {
        trim(format!("{v:.1}"))
    } else {
        trim(format!("{:.0}", v.round()))
    }
}

/// A length for an input field, without a unit mark: `3 1/2`, `3.5`, `89`.
pub fn format_length_value(inches: f64, units: Units) -> String {
    if !inches.is_finite() {
        return "0".into();
    }
    match units {
        Units::Fraction => format_fraction(inches, DEFAULT_DENOMINATOR),
        Units::Decimal => trim(format!("{inches:.3}")),
        Units::Metric => mm(inches),
    }
}

/// A length to read: `3 1/2"`, `3.5"`, `89 mm`.
pub fn format_length(inches: f64, units: Units) -> String {
    let value = format_length_value(inches, units);
    match units {
        Units::Fraction | Units::Decimal => format!("{value}\""),
        Units::Metric => format!("{value} mm"),
    }
}

/// Two lengths as a size: `24" × 16"`, `610 × 406 mm`.
pub fn format_size(a: f64, b: f64, units: Units) -> String {
    match units {
        Units::Metric => format!("{} × {} mm", mm(a), mm(b)),
        _ => format!("{} × {}", format_length(a, units), format_length(b, units)),
    }
}

/// Reads a length typed by a person, in inches. `None` when unreadable or negative.
pub fn parse_length(input: &str, units: Units) -> Option<f64> {
    let s = input.trim().to_ascii_lowercase();
    if s.is_empty() {
        return None;
    }
    // Feet, alone or with inches after them: 2', 2 ft, 1' 6", 1ft 6 1/2in.
    for mark in ["'", "ft"] {
        if let Some((feet, rest)) = s.split_once(mark) {
            let feet: f64 = feet.trim().parse().ok().filter(|f: &f64| *f >= 0.0)?;
            let rest = rest.trim();
            let inches = if rest.is_empty() { 0.0 } else { parse_inches(rest)? };
            return Some(feet * 12.0 + inches);
        }
    }
    for (suffix, per_inch) in [
        ("mm", MM_PER_INCH),
        ("cm", MM_PER_INCH / 10.0),
        ("m", MM_PER_INCH / 1000.0),
    ] {
        if let Some(number) = s.strip_suffix(suffix) {
            let n: f64 = number.trim().parse().ok()?;
            return (n >= 0.0 && n.is_finite()).then_some(n / per_inch);
        }
    }
    if s.ends_with('"') || s.ends_with("in") {
        return parse_inches(&s);
    }
    // A bare number: inches unless the person works in millimetres. A fraction is inches.
    let is_fraction = s.contains('/');
    match units {
        Units::Metric if !is_fraction => {
            let n: f64 = s.parse().ok()?;
            (n >= 0.0 && n.is_finite()).then_some(n / MM_PER_INCH)
        }
        _ => parse_fraction(&s),
    }
}

/// As [`parse_length`], but a leading minus is allowed (positions are signed). Never −0.
pub fn parse_signed_length(input: &str, units: Units) -> Option<f64> {
    let s = input.trim();
    let (negative, rest) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let magnitude = parse_length(rest, units)?;
    Some(if negative && magnitude != 0.0 {
        -magnitude
    } else {
        magnitude
    })
}

fn parse_inches(s: &str) -> Option<f64> {
    let s = s.trim().trim_end_matches('"').trim_end_matches("in").trim();
    parse_fraction(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_in_each_system() {
        assert_eq!(format_length(3.5, Units::Fraction), "3 1/2\"");
        assert_eq!(format_length(3.5, Units::Decimal), "3.5\"");
        assert_eq!(format_length(3.5, Units::Metric), "89 mm");
        assert_eq!(format_length(0.75, Units::Metric), "19 mm");
        assert_eq!(format_length(0.125, Units::Metric), "3.2 mm");
        assert_eq!(format_length(0.0, Units::Metric), "0 mm");
        assert_eq!(format_length_value(1.0 / 3.0, Units::Decimal), "0.333");
        assert_eq!(format_length_value(-0.0001, Units::Decimal), "0");
        assert_eq!(format_size(24.0, 16.0, Units::Metric), "610 × 406 mm");
        assert_eq!(format_size(24.0, 16.0, Units::Fraction), "24\" × 16\"");
    }

    #[test]
    fn reads_what_people_type() {
        let close = |a: Option<f64>, b: f64| assert!((a.unwrap() - b).abs() < 1e-9, "{a:?} vs {b}");
        // A bare number follows the system.
        close(parse_length("19", Units::Metric), 19.0 / 25.4);
        close(parse_length("19", Units::Fraction), 19.0);
        close(parse_length("3.5", Units::Decimal), 3.5);
        // A named unit wins in any system.
        close(parse_length("450mm", Units::Fraction), 450.0 / 25.4);
        close(parse_length("45 cm", Units::Fraction), 450.0 / 25.4);
        close(parse_length("1.2 m", Units::Decimal), 1200.0 / 25.4);
        close(parse_length("17 3/4\"", Units::Metric), 17.75);
        close(parse_length("17.75in", Units::Metric), 17.75);
        close(parse_length("1' 6\"", Units::Metric), 18.0);
        close(parse_length("2ft", Units::Metric), 24.0);
        close(parse_length("1' 6 1/2", Units::Metric), 18.5);
        // A fraction is always inches.
        close(parse_length("3/4", Units::Metric), 0.75);
        // Signed positions.
        close(parse_signed_length("-25", Units::Metric), -25.0 / 25.4);
        assert_eq!(parse_signed_length("-0", Units::Metric), Some(0.0));
        // Nonsense and negatives.
        assert_eq!(parse_length("", Units::Metric), None);
        assert_eq!(parse_length("abc", Units::Metric), None);
        assert_eq!(parse_length("-3", Units::Fraction), None);
        assert_eq!(parse_length("12 furlongs", Units::Fraction), None);
    }

    #[test]
    fn round_trips_what_it_shows() {
        for units in [Units::Fraction, Units::Decimal, Units::Metric] {
            for v in [0.75, 3.5, 17.716535, 48.0] {
                let shown = format_length_value(v, units);
                let back = parse_length(&shown, units).unwrap();
                assert_eq!(format_length_value(back, units), shown, "{units:?} {v}");
            }
        }
    }
}
