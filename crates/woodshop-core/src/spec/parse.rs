//! The one entry point for any spec entering the app — a stored draft, an imported file, an MCP
//! edit: migrate on read, validate against the schema, then fill the schema defaults so every
//! consumer sees the same fully-populated document.

use serde_json::Value;
use thiserror::Error;

use super::types::{GrainAxis, Spec};
use super::{MigrateError, migrate::migrate_to_latest};

#[derive(Debug, Error, PartialEq)]
pub enum ParseError {
    #[error(transparent)]
    Migrate(#[from] MigrateError),
    #[error("Spec failed validation: {}", .0.join("; "))]
    Invalid(Vec<String>),
}

impl ParseError {
    /// Human-readable messages, one per problem.
    pub fn messages(&self) -> Vec<String> {
        match self {
            ParseError::Migrate(e) => vec![e.to_string()],
            ParseError::Invalid(m) => m.clone(),
        }
    }
}

/// Migrate → validate → type → fill defaults.
pub fn parse(input: Value) -> Result<Spec, ParseError> {
    let migrated = migrate_to_latest(input)?;
    #[cfg(feature = "validate")]
    super::validate::validate(&migrated).map_err(ParseError::Invalid)?;
    let mut spec: Spec = serde_json::from_value(migrated).map_err(|e| ParseError::Invalid(vec![e.to_string()]))?;
    fill_defaults(&mut spec);
    Ok(spec)
}

/// Apply the schema's `default`s for the fields the editor reads unconditionally (the same set
/// the web app's Zod parse filled): material grain, part grainAxis/rot/ops/qty/locked, and the
/// top-level joints/groups/movables arrays. Op-level defaults are left implicit.
pub fn fill_defaults(spec: &mut Spec) {
    for m in &mut spec.materials {
        m.grain.get_or_insert(true);
    }
    for p in &mut spec.parts {
        p.grain_axis.get_or_insert(GrainAxis::L);
        p.transform.rot.get_or_insert([0.0; 3]);
        p.ops.get_or_insert_with(Vec::new);
        p.qty.get_or_insert(1);
        p.locked.get_or_insert(false);
    }
    spec.joints.get_or_insert_with(Vec::new);
    spec.groups.get_or_insert_with(Vec::new);
    spec.movables.get_or_insert_with(Vec::new);
}
