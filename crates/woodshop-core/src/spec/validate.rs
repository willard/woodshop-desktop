//! Structural validation against the canonical JSON Schema (`resources/spec.schema.json`).
//! Semantic buildability rules live in [`crate::lint`]; this is shape only.
//!
//! The messages matter as much as the verdict. Their readers are a person looking at a rejected
//! save and an agent authoring over MCP that cannot see the schema, so every failure names what
//! the schema would accept. The two tagged unions (`op`, `movable`) are narrowed to the branch
//! the author meant — by `type`/`kind`, then by `kind`/`profile` for curves and eases — so a bad
//! `gauge` on a `screws` op is not reported as "width is required" from a dado branch.

use std::sync::LazyLock;

use jsonschema::error::ValidationErrorKind;
use jsonschema::{ValidationError, Validator};
use serde_json::Value;

/// The schema source of truth, shared with the UI build and the MCP resource.
pub const SCHEMA_JSON: &str = include_str!("../../../../resources/spec.schema.json");

struct Compiled {
    schema: Value,
    validator: Validator,
}

static COMPILED: LazyLock<Compiled> = LazyLock::new(|| {
    let schema: Value = serde_json::from_str(SCHEMA_JSON).expect("bundled schema is valid JSON");
    let validator = jsonschema::validator_for(&schema).expect("bundled schema compiles");
    Compiled { schema, validator }
});

/// The parsed schema document.
pub fn schema() -> &'static Value {
    &COMPILED.schema
}

/// Validate a raw spec value. `Ok(())` when valid, else human-readable errors, each prefixed
/// with the JSON pointer of the offending value.
pub fn validate(spec: &Value) -> Result<(), Vec<String>> {
    let mut messages = Vec::new();
    for error in COMPILED.validator.iter_errors(spec) {
        collect(&error, spec, &mut messages);
    }
    // Several branches can report one sentence identically; keep the first of each.
    let mut seen = std::collections::HashSet::new();
    messages.retain(|m| seen.insert(m.clone()));
    if messages.is_empty() { Ok(()) } else { Err(messages) }
}

pub fn passes(spec: &Value) -> bool {
    COMPILED.validator.is_valid(spec)
}

/// Which tagged union a `oneOf` failure belongs to.
#[derive(Clone, Copy)]
enum Union {
    Op,
    Movable,
}

impl Union {
    fn def(self) -> &'static str {
        match self {
            Union::Op => "op",
            Union::Movable => "movable",
        }
    }

    /// The first discriminator: `type` for ops, `kind` for movables.
    fn tag(self) -> &'static str {
        match self {
            Union::Op => "type",
            Union::Movable => "kind",
        }
    }

    fn of(path: &str) -> Option<Union> {
        let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        match segs.as_slice() {
            ["parts", _, "ops", _] => Some(Union::Op),
            ["movables", _] => Some(Union::Movable),
            _ => None,
        }
    }
}

/// Second discriminator for types that span several branches.
fn discriminator_for(op_type: &str) -> Option<&'static str> {
    match op_type {
        "curve" => Some("kind"),
        "ease" => Some("profile"),
        _ => None,
    }
}

fn branches(union: Union) -> &'static [Value] {
    schema()["$defs"][union.def()]["oneOf"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// Whether a branch pins `property` to `value`, by `const` or by `enum` membership.
fn branch_declares(branch: &Value, property: &str, value: &str) -> bool {
    let declared = &branch["properties"][property];
    if let Some(c) = declared.get("const") {
        return c == value;
    }
    declared
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|values| values.iter().any(|v| v == value))
}

fn branch_tag_values(branch: &Value, property: &str) -> Vec<String> {
    let declared = &branch["properties"][property];
    if let Some(c) = declared.get("const").and_then(Value::as_str) {
        return vec![c.to_owned()];
    }
    declared
        .get("enum")
        .and_then(Value::as_array)
        .map(|vs| vs.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default()
}

/// `"arc" (edge, height), "round" (edge, radius), "ramp" (edge, height, low)`.
pub fn variant_choices(op_type: &str) -> String {
    let Some(disc) = discriminator_for(op_type) else {
        return String::new();
    };
    branches(Union::Op)
        .iter()
        .filter(|b| branch_declares(b, "type", op_type))
        .filter_map(|b| {
            let name = b["properties"][disc]["const"].as_str()?;
            let needs: Vec<&str> = b["required"]
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .filter(|r| *r != "type" && *r != disc)
                .collect();
            Some(format!("\"{name}\" ({})", needs.join(", ")))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn collect(error: &ValidationError<'_>, root: &Value, out: &mut Vec<String>) {
    let path = error.instance_path().to_string();

    if let ValidationErrorKind::OneOfNotValid { context } = error.kind()
        && let Some(union) = Union::of(&path)
    {
        narrow(union, &path, error.instance(), context, root, out);
        return;
    }

    out.push(prefixed(&path, &message(error, None)));
}

/// Report only the branch the author chose; name the options when the choice itself is wrong.
fn narrow(
    union: Union,
    path: &str,
    instance: &Value,
    context: &[Vec<ValidationError<'static>>],
    root: &Value,
    out: &mut Vec<String>,
) {
    let all = branches(union);
    let tag = union.tag();
    let Some(written) = instance.get(tag).and_then(Value::as_str) else {
        let options = all.iter().flat_map(|b| branch_tag_values(b, tag)).collect::<Vec<_>>();
        let msg = if instance.is_object() {
            format!("{} {tag} is missing — use {}.", union.def(), quote_list(&options))
        } else {
            format!("{} must be an object.", union.def())
        };
        out.push(prefixed(path, &msg));
        return;
    };

    let chosen: Vec<usize> = (0..all.len())
        .filter(|&i| branch_declares(&all[i], tag, written))
        .collect();

    if chosen.is_empty() {
        let mut options = all.iter().flat_map(|b| branch_tag_values(b, tag)).collect::<Vec<_>>();
        options.dedup();
        out.push(prefixed(
            &format!("{path}/{tag}"),
            &format!(
                "\"{written}\" is not a valid {} {tag} — use {}.",
                union.def(),
                quote_list(&options)
            ),
        ));
        return;
    }

    let mut picked = chosen.clone();
    if let (Union::Op, Some(disc)) = (union, discriminator_for(written)) {
        let second = instance.get(disc).and_then(Value::as_str);
        let exact: Vec<usize> = chosen
            .iter()
            .copied()
            .filter(|&i| second.is_some_and(|s| branch_declares(&all[i], disc, s)))
            .collect();
        if exact.is_empty() {
            let msg = match second {
                Some(s) => format!(
                    "\"{s}\" is not a valid {written} {disc} — use {}.",
                    variant_choices(written)
                ),
                None => format!(
                    "{} {written} needs a {disc}: {}.",
                    article(written),
                    variant_choices(written)
                ),
            };
            out.push(prefixed(&format!("{path}/{disc}"), &msg));
            return;
        }
        picked = exact;
    }

    for i in picked {
        let branch = &all[i];
        for sub in context.get(i).into_iter().flatten() {
            let sub_path = sub.instance_path().to_string();
            if let ValidationErrorKind::OneOfNotValid { .. } = sub.kind() {
                collect(sub, root, out);
                continue;
            }
            out.push(prefixed(&sub_path, &message(sub, Some(branch))));
        }
    }
}

/// One leaf error as a sentence naming what the schema will accept.
fn message(error: &ValidationError<'_>, branch: Option<&Value>) -> String {
    let path = error.instance_path().to_string();
    let subject = subject(&path);
    match error.kind() {
        ValidationErrorKind::Enum { options } => {
            let values: Vec<String> = options
                .as_array()
                .map(|vs| vs.iter().map(|v| v.to_string()).collect())
                .unwrap_or_default();
            let note = if values == ["\"l0\"", "\"l1\"", "\"w0\"", "\"w1\""] {
                " Edge indexing is zero-based: the two length edges are l0 and l1 (never l2), the \
                 two width edges w0 and w1. l0 is the edge at width 0, l1 the edge at full width."
            } else {
                ""
            };
            format!(
                "{} is not a valid {subject} — use {}.{note}",
                wrote(error.instance()),
                values.join(", ")
            )
        }
        ValidationErrorKind::Constant { expected_value } => {
            format!(
                "{} is not a valid {subject} — must be {expected_value}.",
                wrote(error.instance())
            )
        }
        ValidationErrorKind::AdditionalProperties { unexpected } => {
            let accepted = branch
                .and_then(|b| b["properties"].as_object())
                .map(|p| {
                    format!(
                        " — this variant accepts only: {}.",
                        p.keys().cloned().collect::<Vec<_>>().join(", ")
                    )
                })
                .unwrap_or_default();
            format!(
                "Unknown propert{} {}{accepted}",
                if unexpected.len() == 1 { "y" } else { "ies" },
                quote_list(unexpected)
            )
        }
        _ => error.to_string(),
    }
}

fn prefixed(path: &str, message: &str) -> String {
    if path.is_empty() {
        message.to_owned()
    } else {
        format!("{path}: {message}")
    }
}

fn subject(path: &str) -> &str {
    path.rsplit('/')
        .next()
        .filter(|s| !s.is_empty() && s.parse::<usize>().is_err())
        .unwrap_or("value")
}

fn wrote(value: &Value) -> String {
    match value {
        Value::Array(_) | Value::Object(_) => "that".into(),
        v => v.to_string(),
    }
}

fn article(noun: &str) -> &'static str {
    if noun.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    }
}

fn quote_list<S: AsRef<str>>(values: &[S]) -> String {
    values
        .iter()
        .map(|v| format!("\"{}\"", v.as_ref()))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Value {
        json!({
            "specVersion": "1.15", "units": "in", "name": "T",
            "materials": [{"id": "mat_a", "type": "sheet", "name": "Ply", "thickness": 0.75, "sheetSize": {"l": 96, "w": 48}}],
            "parts": [{"id": "p_a", "name": "A", "materialId": "mat_a", "size": {"l": 10, "w": 5}, "transform": {"pos": [0, 0, 0]}}]
        })
    }

    #[test]
    fn valid_spec_passes() {
        assert_eq!(validate(&base()), Ok(()));
    }

    #[test]
    fn bad_edge_names_the_edges() {
        let mut s = base();
        s["parts"][0]["ops"] = json!([{"type": "rabbet", "edge": "l2", "width": 0.5, "depth": 0.25}]);
        let errs = validate(&s).unwrap_err();
        assert_eq!(errs.len(), 1, "{errs:?}");
        assert!(
            errs[0].starts_with("/parts/0/ops/0/edge: \"l2\" is not a valid edge — use \"l0\""),
            "{errs:?}"
        );
    }

    #[test]
    fn screws_error_is_not_reported_as_dado_fields() {
        let mut s = base();
        s["parts"][0]["ops"] =
            json!([{"type": "screws", "face": "front", "axis": "l", "offset": 1, "count": 2, "gauge": "#9"}]);
        let errs = validate(&s).unwrap_err();
        assert_eq!(errs.len(), 1, "{errs:?}");
        assert!(errs[0].contains("gauge") && errs[0].contains("\"#8\""), "{errs:?}");
    }

    #[test]
    fn unknown_curve_kind_lists_variants() {
        let mut s = base();
        s["parts"][0]["ops"] = json!([{"type": "curve", "edge": "l0", "kind": "wave", "height": 1}]);
        let errs = validate(&s).unwrap_err();
        assert_eq!(errs.len(), 1, "{errs:?}");
        assert!(
            errs[0].contains("\"wave\" is not a valid curve kind — use \"arc\" (edge, height)"),
            "{errs:?}"
        );
    }

    #[test]
    fn unknown_op_type_lists_types() {
        let mut s = base();
        s["parts"][0]["ops"] = json!([{"type": "mortise"}]);
        let errs = validate(&s).unwrap_err();
        assert!(
            errs[0].contains("\"mortise\" is not a valid op type — use \"dado\", \"groove\", \"rabbet\""),
            "{errs:?}"
        );
    }

    #[test]
    fn extra_property_lists_accepted_ones() {
        let mut s = base();
        s["parts"][0]["ops"] = json!([{"type": "miter", "edge": "l0", "angle": 45, "bevel": true}]);
        let errs = validate(&s).unwrap_err();
        assert!(
            errs[0].contains("\"bevel\"") && errs[0].contains("accepts only: type, edge, angle"),
            "{errs:?}"
        );
    }
}
