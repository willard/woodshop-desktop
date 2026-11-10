//! Rows as the app sees them. Timestamps are milliseconds since the Unix epoch.

use serde::{Deserialize, Serialize};
use woodshop_core::spec::Spec;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: i64,
    pub name: String,
    pub part_count: i64,
    pub updated_at: i64,
    pub created_at: i64,
    /// When the thumbnail was last written (cache-busts the image URL); `None` = no thumbnail.
    pub thumbnail_at: Option<i64>,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub draft: Spec,
    pub draft_updated_at: i64,
    pub created_at: i64,
    pub thumbnail_at: Option<i64>,
    pub deleted_at: Option<i64>,
}

/// Who wrote a version: the person at the editor, or an agent over MCP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Author {
    User,
    Mcp,
}

impl Author {
    pub fn as_str(self) -> &'static str {
        match self {
            Author::User => "user",
            Author::Mcp => "mcp",
        }
    }

    pub fn parse(s: &str) -> Self {
        if s == "mcp" { Author::Mcp } else { Author::User }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: i64,
    pub project_id: i64,
    pub label: Option<String>,
    pub created_by: Author,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub project_id: i64,
    pub body: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
