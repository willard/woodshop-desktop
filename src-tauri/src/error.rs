//! The one error shape every command returns. The webview switches on `kind`; `message` is always
//! fit to show a person.

use serde::Serialize;
use serde_json::Value;
use woodshop_store::{ArchiveError, StoreError};

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandError {
    NotFound {
        message: String,
    },
    /// The draft moved on since the caller read it (another window, or an MCP agent).
    #[serde(rename_all = "camelCase")]
    Conflict {
        message: String,
        draft: Value,
        draft_updated_at: i64,
    },
    /// The input failed schema validation or could not be read.
    Invalid {
        message: String,
        issues: Vec<String>,
    },
    Io {
        message: String,
    },
    Internal {
        message: String,
    },
}

pub type CmdResult<T> = Result<T, CommandError>;

impl CommandError {
    pub fn invalid(issues: Vec<String>) -> Self {
        let message = issues.first().cloned().unwrap_or_else(|| "Invalid input.".into());
        Self::Invalid { message, issues }
    }

    pub fn internal(e: impl std::fmt::Display) -> Self {
        Self::Internal { message: e.to_string() }
    }
}

impl From<StoreError> for CommandError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::ProjectNotFound(_) | StoreError::VersionNotFound(_) | StoreError::NoteNotFound(_) => {
                Self::NotFound { message: e.to_string() }
            }
            StoreError::Conflict {
                ref draft,
                draft_updated_at,
            } => Self::Conflict {
                message: e.to_string(),
                draft: woodshop_core::spec::to_value(draft.as_ref()),
                draft_updated_at,
            },
            StoreError::EmptyName => Self::invalid(vec![e.to_string()]),
            StoreError::Io(ref io) => Self::Io {
                message: io.to_string(),
            },
            StoreError::Sql(_) | StoreError::CorruptSpec { .. } => Self::internal(e),
        }
    }
}

impl From<ArchiveError> for CommandError {
    fn from(e: ArchiveError) -> Self {
        match e {
            ArchiveError::Io(io) => Self::Io {
                message: io.to_string(),
            },
            other => Self::invalid(vec![other.to_string()]),
        }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self {
        Self::Io { message: e.to_string() }
    }
}

impl From<woodshop_core::spec::ParseError> for CommandError {
    fn from(e: woodshop_core::spec::ParseError) -> Self {
        Self::invalid(e.messages())
    }
}
