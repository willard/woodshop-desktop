//! The op union of `spec.schema.json`, read back as a catalogue an agent can be told about: one
//! entry per variant, with its required and optional fields, each field's allowed values, and the
//! prose the schema already carries.
//!
//! Derived, never hand-written. An agent authoring over MCP cannot see the JSON Schema, so the
//! `get_conventions` tool has to describe it — and a second hand-maintained description of a union
//! with fourteen branches would be wrong within a release.
//!
//! The union is a `oneOf` keyed by `type` (`const`, or an `enum` where dado and groove share a
//! branch). Some types carry a SECOND discriminator pinned by `const` — `kind` on `curve`,
//! `profile` on `ease` — found here by looking for it rather than by name.

use std::sync::OnceLock;

use serde::Serialize;
use serde_json::{Map, Value};

use super::validate::schema;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpVariant {
    /// `"dado|groove"` for the shared branch, otherwise the one type.
    #[serde(rename = "type")]
    pub kind: String,
    pub types: Vec<String>,
    /// The second `const` property telling this type's variants apart (`kind`, `profile`).
    pub discriminator: Option<String>,
    /// This variant's value of that discriminator (`arc`, `roundover`, …).
    pub variant: Option<String>,
    pub required: Vec<String>,
    pub optional: Vec<String>,
    /// Each property with `$ref`s to `$defs` folded in, in schema order.
    pub fields: Vec<(String, Map<String, Value>)>,
    pub description: Option<String>,
}

impl OpVariant {
    pub fn field(&self, name: &str) -> Option<&Map<String, Value>> {
        self.fields.iter().find(|(n, _)| n == name).map(|(_, f)| f)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EnumInfo {
    pub values: Vec<String>,
    pub description: Option<String>,
}

fn defs() -> &'static Map<String, Value> {
    static EMPTY: OnceLock<Map<String, Value>> = OnceLock::new();
    schema()["$defs"]
        .as_object()
        .unwrap_or_else(|| EMPTY.get_or_init(Map::new))
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default()
}

/// The value(s) a `type` property pins its branch to.
fn pinned(property: &Value) -> Vec<String> {
    if let Some(c) = property.get("const").and_then(Value::as_str) {
        return vec![c.to_owned()];
    }
    strings(&property["enum"])
}

/// A property with a `$ref` to `$defs` folded in. The referring property's own keys (notably its
/// op-specific `description`) win over the shared definition's.
fn resolve(property: &Value) -> Map<String, Value> {
    let Some(obj) = property.as_object() else {
        return Map::new();
    };
    let mut out = Map::new();
    if let Some(target) = obj
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|r| r.strip_prefix("#/$defs/"))
        .and_then(|name| defs().get(name))
        .and_then(Value::as_object)
    {
        out.extend(target.clone());
    }
    for (k, v) in obj {
        if k != "$ref" {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

/// Every variant in the union, in schema order.
pub fn variants() -> &'static [OpVariant] {
    static VARIANTS: OnceLock<Vec<OpVariant>> = OnceLock::new();
    VARIANTS.get_or_init(build)
}

fn build() -> Vec<OpVariant> {
    let mut variants: Vec<OpVariant> = defs()
        .get("op")
        .and_then(|op| op["oneOf"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|branch| {
            let properties = branch["properties"].as_object()?;
            let types = pinned(properties.get("type")?);
            if types.is_empty() {
                return None; // a branch not keyed by `type` isn't addressable by an author
            }
            let required = strings(&branch["required"]);
            let fields: Vec<(String, Map<String, Value>)> =
                properties.iter().map(|(name, p)| (name.clone(), resolve(p))).collect();
            let optional = fields
                .iter()
                .map(|(n, _)| n.clone())
                .filter(|n| !required.contains(n))
                .collect();
            Some(OpVariant {
                kind: types.join("|"),
                types,
                discriminator: None,
                variant: None,
                required,
                optional,
                fields,
                description: branch["description"].as_str().map(str::to_owned),
            })
        })
        .collect();
    mark_discriminators(&mut variants);
    variants
}

/// Tag each variant with the second `const` property distinguishing it from its siblings: one
/// every branch of the type pins with a `const`, to values that don't all agree.
fn mark_discriminators(variants: &mut [OpVariant]) {
    for ty in types_of(variants) {
        let indexes: Vec<usize> = variants
            .iter()
            .enumerate()
            .filter(|(_, v)| v.types.contains(&ty))
            .map(|(i, _)| i)
            .collect();
        if indexes.len() < 2 {
            continue;
        }
        let pinned_in = |i: usize| -> Vec<(String, Value)> {
            variants[i]
                .fields
                .iter()
                .filter(|(n, f)| n != "type" && f.contains_key("const"))
                .map(|(n, f)| (n.clone(), f["const"].clone()))
                .collect()
        };
        let mut candidates: Vec<String> = pinned_in(indexes[0]).into_iter().map(|(n, _)| n).collect();
        for &i in &indexes[1..] {
            let names: Vec<String> = pinned_in(i).into_iter().map(|(n, _)| n).collect();
            candidates.retain(|c| names.contains(c));
        }
        for name in candidates {
            let values: Vec<Value> = indexes
                .iter()
                .map(|&i| variants[i].field(&name).map(|f| f["const"].clone()).unwrap_or_default())
                .collect();
            if values.iter().all(|v| *v == values[0]) {
                continue; // the same value everywhere describes the type, not a variant
            }
            for (&i, value) in indexes.iter().zip(values) {
                variants[i].discriminator = Some(name.clone());
                variants[i].variant = Some(value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()));
            }
            break;
        }
    }
}

fn types_of(variants: &[OpVariant]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in variants {
        for t in &v.types {
            if !out.contains(t) {
                out.push(t.clone());
            }
        }
    }
    out
}

/// Every op type an author may write, in schema order (dado and groove count separately).
pub fn types() -> Vec<String> {
    types_of(variants())
}

/// The variants an author choosing this `type` picks between.
pub fn for_type(ty: &str) -> Vec<&'static OpVariant> {
    variants().iter().filter(|v| v.types.iter().any(|t| t == ty)).collect()
}

pub fn discriminator_for(ty: &str) -> Option<String> {
    for_type(ty).into_iter().find_map(|v| v.discriminator.clone())
}

/// The vocabularies an op author keeps having to guess at: `edge`, `face` and joint `type`.
pub fn enums() -> Vec<(&'static str, EnumInfo)> {
    let defs = defs();
    let mut out = Vec::new();
    for name in ["edge", "face"] {
        out.push((
            name,
            EnumInfo {
                values: strings(&defs.get(name).cloned().unwrap_or_default()["enum"]),
                description: defs
                    .get(name)
                    .and_then(|d| d["description"].as_str())
                    .map(str::to_owned),
            },
        ));
    }
    out.push((
        "jointType",
        EnumInfo {
            values: strings(&defs.get("joint").cloned().unwrap_or_default()["properties"]["type"]["enum"]),
            description: Some("The joinery a `joint` may record between two parts.".into()),
        },
    ));
    out
}

/// A one-line signature per variant, in the shape an author types:
/// `{"type":"curve","edge":"l0|l1|w0|w1","kind":"arc","height":<inches>}  — optional: from, to`
pub fn signatures(ty: &str) -> Vec<String> {
    for_type(ty)
        .into_iter()
        .map(|v| {
            let pairs: Vec<String> = v
                .required
                .iter()
                .map(|name| {
                    let value = if name == "type" {
                        format!("\"{ty}\"")
                    } else {
                        placeholder(v.field(name).unwrap_or(&Map::new()))
                    };
                    format!("\"{name}\":{value}")
                })
                .collect();
            let mut line = format!("{{{}}}", pairs.join(","));
            if !v.optional.is_empty() {
                line.push_str(&format!("  — optional: {}", v.optional.join(", ")));
            }
            line
        })
        .collect()
}

fn placeholder(field: &Map<String, Value>) -> String {
    if let Some(c) = field.get("const") {
        return c.to_string();
    }
    let options = strings(field.get("enum").unwrap_or(&Value::Null));
    if !options.is_empty() {
        return format!("\"{}\"", options.join("|"));
    }
    match field.get("type").and_then(Value::as_str) {
        Some("number") => "<inches>".into(),
        Some("integer") => "<count>".into(),
        Some("boolean") => "<true|false>".into(),
        Some("array") => "[…]".into(),
        Some(other) => format!("<{other}>"),
        None => "<value>".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_every_type_and_the_second_discriminators() {
        let t = types();
        for expected in [
            "dado",
            "groove",
            "rabbet",
            "hole",
            "pocketHoles",
            "screws",
            "miter",
            "curve",
            "notch",
            "ease",
        ] {
            assert!(t.contains(&expected.to_string()), "missing {expected}");
        }
        assert_eq!(discriminator_for("curve").as_deref(), Some("kind"));
        assert_eq!(discriminator_for("ease").as_deref(), Some("profile"));
        assert_eq!(discriminator_for("notch"), None);
        let names: Vec<_> = for_type("curve").iter().filter_map(|v| v.variant.clone()).collect();
        assert_eq!(names, ["arc", "round", "ramp"]);
    }

    #[test]
    fn signatures_read_like_what_an_author_types() {
        let rabbet = signatures("rabbet");
        assert_eq!(
            rabbet,
            [r#"{"type":"rabbet","edge":"l0|l1|w0|w1","width":<inches>,"depth":<inches>}"#]
        );
        let curve = signatures("curve");
        assert!(curve[0].contains(r#""kind":"arc""#), "{curve:?}");
    }

    #[test]
    fn enums_come_from_defs() {
        let e = enums();
        assert_eq!(e[0].1.values, ["l0", "l1", "w0", "w1"]);
        assert_eq!(e[2].1.values.len(), 6);
    }
}
