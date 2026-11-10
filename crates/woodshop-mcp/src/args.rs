//! Tool arguments, checked the way the web server's request validation did: an absent or `null`
//! field is "not given", a present one must have the right shape, and every failure is a sentence
//! the calling agent can act on.

use serde_json::{Map, Value};

pub type Fail = String;

/// `project_id` → `project id`, as the messages name fields.
fn label(key: &str) -> String {
    key.replace('_', " ")
}

pub struct Args<'a> {
    map: &'a Map<String, Value>,
    prefix: String,
}

impl<'a> Args<'a> {
    pub fn new(map: &'a Map<String, Value>) -> Self {
        Self {
            map,
            prefix: String::new(),
        }
    }

    /// The arguments of one element of an array argument (`parts.2.`), for nested messages.
    pub fn nested(map: &'a Map<String, Value>, prefix: String) -> Self {
        Self { map, prefix }
    }

    fn name(&self, key: &str) -> String {
        label(&format!("{}{key}", self.prefix))
    }

    pub fn raw(&self, key: &str) -> Option<&'a Value> {
        self.map.get(key).filter(|v| !v.is_null())
    }

    pub fn has(&self, key: &str) -> bool {
        self.raw(key).is_some()
    }

    fn missing(&self, key: &str, required: &str) -> Fail {
        if required.is_empty() {
            format!("The {} field is required.", self.name(key))
        } else {
            required.to_owned()
        }
    }

    // ---- integers --------------------------------------------------------------------------

    pub fn opt_int(&self, key: &str) -> Result<Option<i64>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        as_int(v)
            .map(Some)
            .ok_or_else(|| format!("The {} field must be an integer.", self.name(key)))
    }

    /// `required` is the message when absent; empty for the generic one.
    pub fn int(&self, key: &str, required: &str) -> Result<i64, Fail> {
        self.opt_int(key)?.ok_or_else(|| self.missing(key, required))
    }

    pub fn opt_int_in(&self, key: &str, min: i64, max: i64) -> Result<Option<i64>, Fail> {
        let v = self.opt_int(key)?;
        if let Some(n) = v {
            if n < min {
                return Err(format!("The {} field must be at least {min}.", self.name(key)));
            }
            if n > max {
                return Err(format!("The {} field must not be greater than {max}.", self.name(key)));
            }
        }
        Ok(v)
    }

    pub fn project_id(&self, required: &str) -> Result<i64, Fail> {
        self.int("project_id", required)
    }

    // ---- numbers ---------------------------------------------------------------------------

    pub fn opt_num(&self, key: &str, min: f64, max: f64) -> Result<Option<f64>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        let n = as_num(v).ok_or_else(|| format!("The {} field must be a number.", self.name(key)))?;
        check_range(&self.name(key), n, min, max)?;
        Ok(Some(n))
    }

    pub fn num(&self, key: &str, min: f64, max: f64, required: &str) -> Result<f64, Fail> {
        self.opt_num(key, min, max)?.ok_or_else(|| self.missing(key, required))
    }

    /// Three numbers, e.g. `pos` or `rot`. `size_msg` is shown when it isn't three long.
    pub fn opt_vec3(&self, key: &str, min: f64, max: f64, size_msg: &str) -> Result<Option<[f64; 3]>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        let items = v
            .as_array()
            .ok_or_else(|| format!("The {} field must be an array.", self.name(key)))?;
        if items.len() != 3 {
            return Err(size_msg.to_owned());
        }
        let mut out = [0.0; 3];
        for (i, item) in items.iter().enumerate() {
            let name = format!("{}.{i}", self.name(key));
            out[i] = as_num(item).ok_or_else(|| format!("The {name} field must be a number."))?;
            check_range(&name, out[i], min, max)?;
        }
        Ok(Some(out))
    }

    pub fn vec3(&self, key: &str, min: f64, max: f64, size_msg: &str) -> Result<[f64; 3], Fail> {
        self.opt_vec3(key, min, max, size_msg)?
            .ok_or_else(|| self.missing(key, ""))
    }

    pub fn opt_nums(&self, key: &str, max_len: usize, min: f64, max: f64) -> Result<Option<Vec<f64>>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        let items = v
            .as_array()
            .ok_or_else(|| format!("The {} field must be an array.", self.name(key)))?;
        if items.len() > max_len {
            return Err(format!(
                "The {} field must not have more than {max_len} items.",
                self.name(key)
            ));
        }
        items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let name = format!("{}.{i}", self.name(key));
                let n = as_num(item).ok_or_else(|| format!("The {name} field must be a number."))?;
                check_range(&name, n, min, max)?;
                Ok(n)
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some)
    }

    // ---- strings ---------------------------------------------------------------------------

    pub fn opt_str(&self, key: &str) -> Result<Option<&'a str>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        v.as_str()
            .map(Some)
            .ok_or_else(|| format!("The {} field must be a string.", self.name(key)))
    }

    pub fn str(&self, key: &str, required: &str) -> Result<&'a str, Fail> {
        match self.opt_str(key)? {
            Some(s) if !s.is_empty() => Ok(s),
            _ => Err(self.missing(key, required)),
        }
    }

    /// A string no longer than `max` characters.
    pub fn opt_str_max(&self, key: &str, max: usize) -> Result<Option<&'a str>, Fail> {
        let s = self.opt_str(key)?;
        if let Some(s) = s
            && s.chars().count() > max
        {
            return Err(format!(
                "The {} field must not be greater than {max} characters.",
                self.name(key)
            ));
        }
        Ok(s)
    }

    pub fn str_max(&self, key: &str, max: usize, required: &str) -> Result<&'a str, Fail> {
        match self.opt_str_max(key, max)? {
            Some(s) if !s.is_empty() => Ok(s),
            _ => Err(self.missing(key, required)),
        }
    }

    /// One of `allowed`; `invalid` is the message otherwise (empty for the generic one).
    pub fn opt_enum(&self, key: &str, allowed: &[&str], invalid: &str) -> Result<Option<&'a str>, Fail> {
        let Some(s) = self.opt_str(key)? else { return Ok(None) };
        if allowed.contains(&s) {
            return Ok(Some(s));
        }
        Err(if invalid.is_empty() {
            format!("The selected {} is invalid.", self.name(key))
        } else {
            invalid.to_owned()
        })
    }

    pub fn enumerated(&self, key: &str, allowed: &[&str], invalid: &str, required: &str) -> Result<&'a str, Fail> {
        self.opt_enum(key, allowed, invalid)?
            .ok_or_else(|| self.missing(key, required))
    }

    pub fn opt_bool(&self, key: &str) -> Result<Option<bool>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        match v {
            Value::Bool(b) => Ok(Some(*b)),
            Value::Number(n) if n.as_i64() == Some(0) || n.as_i64() == Some(1) => Ok(Some(n.as_i64() == Some(1))),
            _ => Err(format!("The {} field must be true or false.", self.name(key))),
        }
    }

    // ---- structures ------------------------------------------------------------------------

    pub fn opt_object(&self, key: &str) -> Result<Option<&'a Map<String, Value>>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        v.as_object()
            .map(Some)
            .ok_or_else(|| format!("The {} field must be an object.", self.name(key)))
    }

    pub fn opt_array(&self, key: &str, max_len: usize) -> Result<Option<&'a Vec<Value>>, Fail> {
        let Some(v) = self.raw(key) else { return Ok(None) };
        let items = v
            .as_array()
            .ok_or_else(|| format!("The {} field must be an array.", self.name(key)))?;
        if items.len() > max_len {
            return Err(format!(
                "The {} field must not have more than {max_len} items.",
                self.name(key)
            ));
        }
        Ok(Some(items))
    }

    /// An array of objects, each handed back as nested `Args`.
    pub fn objects(&self, key: &str, max_len: usize) -> Result<Vec<Args<'a>>, Fail> {
        let Some(items) = self.opt_array(key, max_len)? else {
            return Ok(Vec::new());
        };
        items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                item.as_object()
                    .map(|m| Args::nested(m, format!("{}{key}.{i}.", self.prefix)))
                    .ok_or_else(|| format!("The {}.{i} field must be an object.", self.name(key)))
            })
            .collect()
    }
}

fn check_range(name: &str, n: f64, min: f64, max: f64) -> Result<(), Fail> {
    if n < min {
        return Err(format!("The {name} field must be at least {}.", fmt(min)));
    }
    if n > max {
        return Err(format!("The {name} field must not be greater than {}.", fmt(max)));
    }
    Ok(())
}

fn fmt(n: f64) -> String {
    woodshop_core::geometry::frame::php_float(n)
}

/// An integer, from a JSON integer, an integral float, or a digit string (as agents send them).
fn as_int(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok().filter(|f: &f64| f.is_finite()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_and_rejects_like_request_validation() {
        let v = json!({"project_id": "7", "length": 0.05, "pos": [1, 2], "name": null, "kind": "box"});
        let a = Args::new(v.as_object().unwrap());
        assert_eq!(a.project_id(""), Ok(7));
        assert_eq!(
            a.opt_num("length", 0.1, 120.0),
            Err("The length field must be at least 0.1.".into())
        );
        assert_eq!(a.opt_vec3("pos", -240.0, 240.0, "three"), Err("three".into()));
        assert_eq!(a.opt_str("name"), Ok(None));
        assert_eq!(
            a.opt_enum("kind", &["door", "drawer"], ""),
            Err("The selected kind is invalid.".into())
        );
        assert_eq!(a.str("part_id", "Give a part."), Err("Give a part.".into()));
    }
}
