//! JSON boundary helpers. serde_json writes `18.0` for an `f64` holding 18; the web app (and
//! every stored document) writes `18`. Integral floats are normalized back to integers on the way
//! out so documents round-trip identically and diffs stay quiet.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Number, Value};

/// Serialize to a JSON value with integral floats written as integers.
pub fn to_value<T: Serialize>(value: &T) -> Value {
    let mut v = serde_json::to_value(value).expect("spec types always serialize");
    normalize_numbers(&mut v);
    v
}

pub fn from_value<T: DeserializeOwned>(value: Value) -> serde_json::Result<T> {
    serde_json::from_value(value)
}

/// Rewrite every float with no fractional part (within i64 range) as an integer, in place.
pub fn normalize_numbers(value: &mut Value) {
    match value {
        Value::Number(n) => {
            if let Some(f) = n.as_f64().filter(|_| n.is_f64())
                && f.fract() == 0.0
                && f.abs() < 9.0e15
            {
                // -0.0 becomes 0: a stored "-0" position is noise.
                *n = Number::from(f as i64);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize_numbers),
        Value::Object(map) => map.values_mut().for_each(normalize_numbers),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn integral_floats_become_integers() {
        let mut v = json!({"a": 18.0, "b": [0.75, -0.0, 2.0], "c": "x"});
        normalize_numbers(&mut v);
        assert_eq!(v.to_string(), r#"{"a":18,"b":[0.75,0,2],"c":"x"}"#);
    }
}
