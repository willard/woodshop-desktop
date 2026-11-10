//! The only fraction math in the app. Woodworkers think in fractions; internally every
//! dimension is decimal inches. Parse on input, format on display.

/// Largest denominator we snap to when formatting (1/16").
pub const DEFAULT_DENOMINATOR: u32 = 16;

/// Parses a length in inches from fraction, mixed, decimal, or integer notation. Returns `None`
/// for anything unparseable or negative: `"3/4"` → 0.75, `"1 1/2"` → 1.5, `"1-1/2"` → 1.5,
/// `"1.5"` → 1.5, `"12"` → 12.
pub fn parse_fraction(input: &str) -> Option<f64> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }
    if is_integer(s) || is_decimal(s) {
        return s.parse().ok();
    }
    if let Some((whole, num, den)) = parse_mixed(s) {
        return (den != 0).then(|| whole as f64 + num as f64 / den as f64);
    }
    if let Some((num, den)) = parse_plain_fraction(s) {
        return (den != 0).then(|| num as f64 / den as f64);
    }
    None
}

/// Parses a coordinate: the same notation as [`parse_fraction`], but a leading minus is allowed.
/// Never returns −0.
pub fn parse_signed_fraction(input: &str) -> Option<f64> {
    let s = input.trim();
    let (negative, rest) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let magnitude = parse_fraction(rest)?;
    Some(if negative && magnitude != 0.0 {
        -magnitude
    } else {
        magnitude
    })
}

/// Decimal inches as a woodworker-friendly string, snapped to the nearest 1/denominator and
/// reduced: 0.75 → `"3/4"`, 1.5 → `"1 1/2"`, 2 → `"2"`. No inch mark.
pub fn format_fraction(value: f64, denominator: u32) -> String {
    if !value.is_finite() {
        return "0".into();
    }
    let abs = value.abs();
    let whole = abs.floor() as i64;
    let mut num = ((abs - whole as f64) * denominator as f64).round() as i64;
    let mut den = denominator as i64;

    // The sign is taken AFTER rounding: a value that snaps to zero has no sign to show.
    let sign = if value < 0.0 && (whole > 0 || num > 0) { "-" } else { "" };

    if num == den {
        return format!("{sign}{}", whole + 1);
    }
    if num == 0 {
        return format!("{sign}{whole}");
    }
    let divisor = gcd(num, den);
    num /= divisor;
    den /= divisor;
    if whole == 0 {
        format!("{sign}{num}/{den}")
    } else {
        format!("{sign}{whole} {num}/{den}")
    }
}

/// [`format_fraction`] at 1/16" with an inch mark — what a drawing or cut list prints.
pub fn inch_label(value: f64) -> String {
    format!("{}\"", format_fraction(value, DEFAULT_DENOMINATOR))
}

fn gcd(mut a: i64, mut b: i64) -> i64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn is_integer(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_decimal(s: &str) -> bool {
    match s.split_once('.') {
        Some((int, frac)) => int.bytes().all(|b| b.is_ascii_digit()) && is_integer(frac),
        None => false,
    }
}

/// `"1 1/2"` or `"1-1/2"`: whole part, then a fraction.
fn parse_mixed(s: &str) -> Option<(u64, u64, u64)> {
    let digits_end = s.find(|c: char| !c.is_ascii_digit())?;
    if digits_end == 0 {
        return None;
    }
    let whole = s[..digits_end].parse().ok()?;
    let rest = &s[digits_end..];
    let trimmed = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '-');
    if trimmed.len() == rest.len() {
        return None;
    }
    let (num, den) = parse_plain_fraction(trimmed)?;
    Some((whole, num, den))
}

/// `"3/4"`, with optional whitespace around the slash.
fn parse_plain_fraction(s: &str) -> Option<(u64, u64)> {
    let (num, den) = s.split_once('/')?;
    let (num, den) = (num.trim_end(), den.trim_start());
    if !is_integer(num) || !is_integer(den) {
        return None;
    }
    Some((num.parse().ok()?, den.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_notations() {
        assert_eq!(parse_fraction("3/4"), Some(0.75));
        assert_eq!(parse_fraction("1 1/2"), Some(1.5));
        assert_eq!(parse_fraction("1-1/2"), Some(1.5));
        assert_eq!(parse_fraction("1.5"), Some(1.5));
        assert_eq!(parse_fraction(".5"), Some(0.5));
        assert_eq!(parse_fraction("12"), Some(12.0));
        assert_eq!(parse_fraction(" 3 / 4 "), Some(0.75));
        assert_eq!(parse_fraction("1/0"), None);
        assert_eq!(parse_fraction("-2"), None);
        assert_eq!(parse_fraction("abc"), None);
        assert_eq!(parse_fraction(""), None);
    }

    #[test]
    fn parses_signed() {
        assert_eq!(parse_signed_fraction("-3 1/2"), Some(-3.5));
        assert_eq!(parse_signed_fraction("-0"), Some(0.0));
        assert!(parse_signed_fraction("-0").unwrap().is_sign_positive());
        assert_eq!(parse_signed_fraction("3/4"), Some(0.75));
    }
}
