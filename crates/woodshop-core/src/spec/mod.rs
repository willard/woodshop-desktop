//! The parametric spec: the whole design as one JSON document (schema:
//! `resources/spec.schema.json`). Renderer, linter and cut list are pure functions of it.

#[cfg(feature = "validate")]
pub mod catalog;
pub mod json;
pub mod migrate;
pub mod parse;
pub mod starter;
pub mod types;
#[cfg(feature = "validate")]
pub mod validate;

pub use json::{from_value, to_value};
pub use migrate::{CURRENT_SPEC_VERSION, MigrateError, migrate_to_latest};
pub use parse::{ParseError, fill_defaults, parse};
pub use types::*;
