//! On-read spec migrations. Stored specs (older drafts and versions) are upgraded to the current
//! `specVersion` before they are validated or re-saved.
//!
//! Every step is PURE and PERMANENT: never edit or remove one after release; append new steps in
//! order. Steps up to 1.13 were purely additive and only stamp the version; 1.14 mints joint ids.

use serde_json::{Map, Value};
use thiserror::Error;

pub const CURRENT_SPEC_VERSION: &str = "1.15";

#[derive(Debug, Error, PartialEq)]
pub enum MigrateError {
    #[error("Spec must be an object.")]
    NotAnObject,
    #[error("Spec is missing specVersion.")]
    MissingVersion,
    #[error(
        "Spec is at version \"{0}\" but this app only knows \"{CURRENT_SPEC_VERSION}\" (no migration path). Update Woodshop to open it."
    )]
    UnknownVersion(String),
}

type Step = fn(Map<String, Value>) -> Map<String, Value>;

/// The version is a pair of numbers, not a decimal: 1.10 follows 1.9. The chain only matches
/// `from` exactly, so nothing compares versions numerically.
const STEPS: &[(&str, &str, Step)] = &[
    ("1.0", "1.1", |s| stamp(s, "1.1")),    // stopped-dado run extents
    ("1.1", "1.2", |s| stamp(s, "1.2")),    // free rot angles
    ("1.2", "1.3", |s| stamp(s, "1.3")),    // material species
    ("1.3", "1.4", |s| stamp(s, "1.4")),    // curve op
    ("1.4", "1.5", |s| stamp(s, "1.5")),    // one-sided curves
    ("1.5", "1.6", |s| stamp(s, "1.6")),    // groups
    ("1.6", "1.7", |s| stamp(s, "1.7")),    // notch op
    ("1.7", "1.8", |s| stamp(s, "1.8")),    // fasteners
    ("1.8", "1.9", |s| stamp(s, "1.9")),    // pocket-hole face
    ("1.9", "1.10", |s| stamp(s, "1.10")),  // ease op
    ("1.10", "1.11", |s| stamp(s, "1.11")), // stopped eases
    ("1.11", "1.12", |s| stamp(s, "1.12")), // movables
    ("1.12", "1.13", |s| stamp(s, "1.13")), // round stock
    ("1.13", "1.14", mint_joint_ids),       // partial arcs + joint ids
    ("1.14", "1.15", |s| stamp(s, "1.15")), // catalog hardware
];

fn stamp(mut spec: Map<String, Value>, to: &str) -> Map<String, Value> {
    spec.insert("specVersion".into(), Value::String(to.into()));
    spec
}

/// 1.14: every joint gets a stable id. The ids are POSITIONAL (`j{index}`) so every runtime that
/// migrates the same stored document mints the same ids. Existing ids are preserved.
fn mint_joint_ids(spec: Map<String, Value>) -> Map<String, Value> {
    let mut spec = stamp(spec, "1.14");
    let Some(Value::Array(joints)) = spec.get_mut("joints") else {
        return spec;
    };

    let mut taken: Vec<String> = joints
        .iter()
        .filter_map(|j| j.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();

    for (index, joint) in joints.iter_mut().enumerate() {
        let Value::Object(record) = joint else { continue };
        if record.get("id").is_some_and(Value::is_string) {
            continue;
        }
        let mut id = format!("j{index}");
        let mut n = 1;
        while taken.contains(&id) {
            id = format!("j{index}_{n}");
            n += 1;
        }
        taken.push(id.clone());

        // The id leads the object, as `{ id, ...joint }` does in the web app.
        let mut minted = Map::with_capacity(record.len() + 1);
        minted.insert("id".into(), Value::String(id));
        minted.extend(std::mem::take(record));
        *record = minted;
    }
    spec
}

/// Migrate a raw spec value up to [`CURRENT_SPEC_VERSION`]. A current spec is returned as-is.
pub fn migrate_to_latest(input: Value) -> Result<Value, MigrateError> {
    let Value::Object(mut spec) = input else {
        return Err(MigrateError::NotAnObject);
    };
    let version_of = |s: &Map<String, Value>| s.get("specVersion").and_then(Value::as_str).map(str::to_owned);
    let mut version = version_of(&spec).ok_or(MigrateError::MissingVersion)?;

    for _ in 0..=STEPS.len() {
        if version == CURRENT_SPEC_VERSION {
            break;
        }
        let (_, to, migrate) = STEPS
            .iter()
            .find(|(from, _, _)| *from == version)
            .ok_or_else(|| MigrateError::UnknownVersion(version.clone()))?;
        spec = migrate(spec);
        version = version_of(&spec).ok_or(MigrateError::MissingVersion)?;
        debug_assert_eq!(&version, to);
    }
    Ok(Value::Object(spec))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stamps_old_versions_and_mints_positional_joint_ids() {
        let out = migrate_to_latest(json!({
            "specVersion": "1.0",
            "joints": [
                {"type": "butt", "hostPartId": "a", "insertPartId": "b"},
                {"id": "j0", "type": "butt", "hostPartId": "a", "insertPartId": "c"},
                {"type": "butt", "hostPartId": "b", "insertPartId": "c"}
            ]
        }))
        .unwrap();
        assert_eq!(out["specVersion"], CURRENT_SPEC_VERSION);
        let ids: Vec<_> = out["joints"]
            .as_array()
            .unwrap()
            .iter()
            .map(|j| j["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["j0_1", "j0", "j2"]);
        // id leads the object
        assert!(out["joints"][0].as_object().unwrap().keys().next().unwrap() == "id");
    }

    #[test]
    fn rejects_future_and_missing_versions() {
        assert_eq!(
            migrate_to_latest(json!({"specVersion": "9.9"})),
            Err(MigrateError::UnknownVersion("9.9".into()))
        );
        assert_eq!(migrate_to_latest(json!({})), Err(MigrateError::MissingVersion));
        assert_eq!(migrate_to_latest(json!([])), Err(MigrateError::NotAnObject));
    }

    #[test]
    fn current_is_untouched() {
        let v = json!({"specVersion": "1.15", "joints": [{"type": "butt"}]});
        assert_eq!(migrate_to_latest(v.clone()).unwrap(), v);
    }
}
