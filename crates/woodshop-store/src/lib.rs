//! The local project library. One SQLite database (WAL, so the app and the MCP server can share
//! it) holds projects, their append-only version history, shop notes and settings; thumbnails are
//! PNG files beside it, served to the webview through Tauri's asset protocol.
//!
//! Specs go in already parsed (typed, validated) and come out migrated to the current version.
//! Every draft write advances `draft_updated_at`; writers pass the value they last read so two
//! writers (the editor and an MCP agent) cannot silently overwrite each other.

mod archive;
mod model;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use thiserror::Error;
use woodshop_core::spec::{self, Spec};

pub use archive::{ArchiveError, ArchivedNote, ArchivedVersion, ProjectArchive};
pub use model::*;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Project {0} not found.")]
    ProjectNotFound(i64),
    #[error("Version {0} not found.")]
    VersionNotFound(i64),
    #[error("Note {0} not found.")]
    NoteNotFound(i64),
    /// The stored draft moved on since the writer last read it.
    #[error("A newer version of this draft exists.")]
    Conflict { draft: Box<Spec>, draft_updated_at: i64 },
    #[error("Stored spec for project {project} is unreadable: {message}")]
    CorruptSpec { project: i64, message: String },
    #[error("A project name can't be empty.")]
    EmptyName,
}

pub type Result<T> = std::result::Result<T, StoreError>;

const MIGRATIONS: &[&str] = &[include_str!("schema.sql")];

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Store {
    conn: Connection,
    thumbnails: Option<PathBuf>,
}

impl Store {
    /// Open (creating if needed) the library in `dir`: `dir/woodshop.db` and `dir/thumbnails/`.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let thumbnails = dir.join("thumbnails");
        std::fs::create_dir_all(&thumbnails)?;
        let conn = Connection::open(dir.join("woodshop.db"))?;
        Self::init(conn, Some(thumbnails))
    }

    /// Open a library database file directly: a backup, say. Migrated if it is older; no thumbnails.
    /// Open a COPY of a backup, never the backup itself: opening switches the file to WAL mode.
    pub fn open_file(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?, None)
    }

    /// A consistent copy of the whole library database at `path`, made while the app and an MCP
    /// agent keep working (SQLite's `VACUUM INTO`: one read transaction, compacted). Thumbnails
    /// are not included; they are redrawn the next time a project is opened.
    pub fn backup_to(&self, path: &Path) -> Result<()> {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        self.conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])?;
        Ok(())
    }

    /// A throwaway library for tests; thumbnails are not supported.
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?, None)
    }

    fn init(conn: Connection, thumbnails: Option<PathBuf>) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // The MCP server and the app share the file; wait out the other writer instead of failing.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let store = Self { conn, thumbnails };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let current: i64 = self.conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current.max(0) as usize) {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i as i64 + 1)?;
            tx.commit()?;
        }
        Ok(())
    }

    /// Changes whenever ANOTHER connection commits to the database — how the open editor notices
    /// an MCP agent's edit without polling the rows themselves.
    pub fn data_version(&self) -> Result<i64> {
        Ok(self.conn.pragma_query_value(None, "data_version", |r| r.get(0))?)
    }

    // -----------------------------------------------------------------------------------------
    // Projects

    pub fn list_projects(&self, trashed: bool) -> Result<Vec<ProjectSummary>> {
        let sql = format!(
            "SELECT id, name, part_count, draft_updated_at, created_at, thumbnail_at, deleted_at
             FROM projects WHERE deleted_at IS {} NULL ORDER BY draft_updated_at DESC, id DESC",
            if trashed { "NOT" } else { "" }
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(ProjectSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                part_count: r.get(2)?,
                updated_at: r.get(3)?,
                created_at: r.get(4)?,
                thumbnail_at: r.get(5)?,
                deleted_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_project(&self, name: &str, spec: &Spec) -> Result<Project> {
        let name = clean_name(name)?;
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO projects (name, draft, spec_version, part_count, draft_updated_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![name, spec_json(spec), spec.spec_version, spec.parts.len() as i64, now],
        )?;
        self.get_project(self.conn.last_insert_rowid())
    }

    pub fn get_project(&self, id: i64) -> Result<Project> {
        let row = self
            .conn
            .query_row(
                "SELECT id, name, draft, draft_updated_at, created_at, thumbnail_at, deleted_at FROM projects WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, Option<i64>>(5)?,
                        r.get::<_, Option<i64>>(6)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::ProjectNotFound(id))?;
        let (id, name, draft, draft_updated_at, created_at, thumbnail_at, deleted_at) = row;
        Ok(Project {
            id,
            name,
            draft: read_spec(id, &draft)?,
            draft_updated_at,
            created_at,
            thumbnail_at,
            deleted_at,
        })
    }

    pub fn rename_project(&self, id: i64, name: &str) -> Result<()> {
        let name = clean_name(name)?;
        self.touch(
            self.conn
                .execute("UPDATE projects SET name = ?2 WHERE id = ?1", params![id, name])?,
            id,
        )
    }

    /// Soft delete: the project moves to the trash and can be restored.
    pub fn trash_project(&self, id: i64) -> Result<()> {
        self.touch(
            self.conn.execute(
                "UPDATE projects SET deleted_at = ?2 WHERE id = ?1",
                params![id, now_ms()],
            )?,
            id,
        )
    }

    pub fn restore_project(&self, id: i64) -> Result<()> {
        self.touch(
            self.conn
                .execute("UPDATE projects SET deleted_at = NULL WHERE id = ?1", [id])?,
            id,
        )
    }

    /// Permanent delete of a trashed project, its history, notes and thumbnail.
    pub fn delete_project_forever(&self, id: i64) -> Result<()> {
        self.touch(
            self.conn
                .execute("DELETE FROM projects WHERE id = ?1 AND deleted_at IS NOT NULL", [id])?,
            id,
        )?;
        if let Some(path) = self.thumbnail_path(id) {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    /// Give an imported project the dates it had where it came from: created, last edited, and
    /// trashed (if it was), so the library orders and files it as before.
    pub fn set_project_dates(&self, id: i64, created_at: i64, updated_at: i64, deleted_at: Option<i64>) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE projects SET created_at = ?2, draft_updated_at = ?3, deleted_at = ?4 WHERE id = ?1",
            params![id, created_at, updated_at, deleted_at],
        )?;
        self.touch(changed, id)
    }

    /// A copy of the project's current draft as a new project (history not carried over).
    pub fn duplicate_project(&self, id: i64) -> Result<Project> {
        let source = self.get_project(id)?;
        let copy = self.create_project(&format!("{} (copy)", source.name), &source.draft)?;
        if let (Some(from), Some(to)) = (self.thumbnail_path(id), self.thumbnail_path(copy.id))
            && from.exists()
        {
            std::fs::copy(from, to)?;
            self.conn.execute(
                "UPDATE projects SET thumbnail_at = ?2 WHERE id = ?1",
                params![copy.id, now_ms()],
            )?;
        }
        self.get_project(copy.id)
    }

    /// Overwrite the working draft. `base_updated_at` is the `draft_updated_at` the writer last
    /// read; if the stored draft has moved on since, this refuses with the current draft so the
    /// caller can offer "keep mine / take theirs". `None` forces the write.
    pub fn save_draft(&self, id: i64, spec: &Spec, base_updated_at: Option<i64>) -> Result<i64> {
        let tx = self.conn.unchecked_transaction()?;
        let current: i64 = tx
            .query_row("SELECT draft_updated_at FROM projects WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or(StoreError::ProjectNotFound(id))?;
        if let Some(base) = base_updated_at
            && base != current
        {
            drop(tx);
            let project = self.get_project(id)?;
            return Err(StoreError::Conflict {
                draft: Box::new(project.draft),
                draft_updated_at: current,
            });
        }
        // Strictly increasing, so a write in the same millisecond still reads as newer.
        let stamp = now_ms().max(current + 1);
        tx.execute(
            "UPDATE projects SET draft = ?2, spec_version = ?3, part_count = ?4, draft_updated_at = ?5 WHERE id = ?1",
            params![id, spec_json(spec), spec.spec_version, spec.parts.len() as i64, stamp],
        )?;
        tx.commit()?;
        Ok(stamp)
    }

    fn touch(&self, changed: usize, id: i64) -> Result<()> {
        if changed == 0 {
            Err(StoreError::ProjectNotFound(id))
        } else {
            Ok(())
        }
    }

    // -----------------------------------------------------------------------------------------
    // Versions

    pub fn list_versions(&self, project_id: i64) -> Result<Vec<VersionSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, label, created_by, created_at FROM versions
             WHERE project_id = ?1 ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([project_id], version_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Save `spec` as a named version and make it the working draft.
    pub fn create_version(
        &self,
        project_id: i64,
        spec: &Spec,
        label: Option<&str>,
        by: Author,
    ) -> Result<(VersionSummary, i64)> {
        let version = self.insert_version(project_id, spec, label, by)?;
        let stamp = self.save_draft(project_id, spec, None)?;
        Ok((version, stamp))
    }

    fn insert_version(&self, project_id: i64, spec: &Spec, label: Option<&str>, by: Author) -> Result<VersionSummary> {
        self.conn.execute(
            "INSERT INTO versions (project_id, spec, spec_version, created_by, label, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                project_id,
                spec_json(spec),
                spec.spec_version,
                by.as_str(),
                label,
                now_ms()
            ],
        )?;
        self.get_version_summary(self.conn.last_insert_rowid())
    }

    fn get_version_summary(&self, id: i64) -> Result<VersionSummary> {
        self.conn
            .query_row(
                "SELECT id, project_id, label, created_by, created_at FROM versions WHERE id = ?1",
                [id],
                version_summary,
            )
            .optional()?
            .ok_or(StoreError::VersionNotFound(id))
    }

    pub fn get_version_spec(&self, project_id: i64, version_id: i64) -> Result<Spec> {
        let json: String = self
            .conn
            .query_row(
                "SELECT spec FROM versions WHERE id = ?1 AND project_id = ?2",
                [version_id, project_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(StoreError::VersionNotFound(version_id))?;
        read_spec(project_id, &json)
    }

    /// Preserve the current draft as a restore point before something overwrites it in place —
    /// unless it is already the latest version.
    pub fn snapshot_draft(&self, project_id: i64, label: &str, by: Author) -> Result<()> {
        let project = self.get_project(project_id)?;
        let latest: Option<String> = self
            .conn
            .query_row(
                "SELECT spec FROM versions WHERE project_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
                [project_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(latest) = latest
            && read_spec(project_id, &latest).ok().as_ref() == Some(&project.draft)
        {
            return Ok(());
        }
        self.insert_version(project_id, &project.draft, Some(label), by)?;
        Ok(())
    }

    /// Make a version the working draft. Versions are append-only: the current draft is kept as a
    /// restore point first, so a restore can itself be undone.
    pub fn restore_version(&self, project_id: i64, version_id: i64) -> Result<(Spec, i64)> {
        let spec = self.get_version_spec(project_id, version_id)?;
        self.snapshot_draft(project_id, "Before restore", Author::User)?;
        let stamp = self.save_draft(project_id, &spec, None)?;
        Ok((spec, stamp))
    }

    // -----------------------------------------------------------------------------------------
    // Notes

    pub fn list_notes(&self, project_id: i64) -> Result<Vec<Note>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, body, pinned, created_at, updated_at FROM notes
             WHERE project_id = ?1 ORDER BY pinned DESC, updated_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([project_id], note_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_note(&self, project_id: i64, body: &str) -> Result<Note> {
        self.get_project(project_id)?;
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO notes (project_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![project_id, body.trim(), now],
        )?;
        self.get_note(self.conn.last_insert_rowid())
    }

    pub fn update_note(&self, id: i64, body: Option<&str>, pinned: Option<bool>) -> Result<Note> {
        let changed = self.conn.execute(
            "UPDATE notes SET body = COALESCE(?2, body), pinned = COALESCE(?3, pinned), updated_at = ?4 WHERE id = ?1",
            params![id, body.map(str::trim), pinned, now_ms()],
        )?;
        if changed == 0 {
            return Err(StoreError::NoteNotFound(id));
        }
        self.get_note(id)
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        match self.conn.execute("DELETE FROM notes WHERE id = ?1", [id])? {
            0 => Err(StoreError::NoteNotFound(id)),
            _ => Ok(()),
        }
    }

    fn get_note(&self, id: i64) -> Result<Note> {
        self.conn
            .query_row(
                "SELECT id, project_id, body, pinned, created_at, updated_at FROM notes WHERE id = ?1",
                [id],
                note_row,
            )
            .optional()?
            .ok_or(StoreError::NoteNotFound(id))
    }

    // -----------------------------------------------------------------------------------------
    // Settings — a flat JSON object the UI owns.

    pub fn settings(&self) -> Result<serde_json::Map<String, Value>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = serde_json::Map::new();
        for row in rows {
            let (k, v) = row?;
            map.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
        }
        Ok(map)
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<()> {
        if value.is_null() {
            self.conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
        } else {
            self.conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![key, value.to_string()],
            )?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------------------------
    // Thumbnails

    pub fn thumbnail_path(&self, id: i64) -> Option<PathBuf> {
        self.thumbnails.as_ref().map(|dir| dir.join(format!("{id}.png")))
    }

    /// Store a PNG snapshot of the model; returns the file path.
    pub fn save_thumbnail(&self, id: i64, png: &[u8]) -> Result<PathBuf> {
        const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
        if !png.starts_with(PNG_MAGIC) {
            return Err(StoreError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "thumbnail must be a PNG",
            )));
        }
        let path = self.thumbnail_path(id).ok_or_else(|| {
            StoreError::Io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "no thumbnail directory",
            ))
        })?;
        self.get_project(id)?;
        let tmp = path.with_extension("png.tmp");
        std::fs::write(&tmp, png)?;
        std::fs::rename(&tmp, &path)?;
        self.conn.execute(
            "UPDATE projects SET thumbnail_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?;
        Ok(path)
    }

    // -----------------------------------------------------------------------------------------
    // Archives (.woodshop files)

    pub fn export_archive(&self, id: i64) -> Result<ProjectArchive> {
        let project = self.get_project(id)?;
        let mut versions = Vec::new();
        for v in self.list_versions(id)? {
            versions.push(archive::ArchivedVersion {
                label: v.label.clone(),
                created_by: v.created_by,
                created_at: v.created_at,
                spec: self.get_version_spec(id, v.id)?,
            });
        }
        let notes = self
            .list_notes(id)?
            .into_iter()
            .map(|n| archive::ArchivedNote {
                body: n.body,
                pinned: n.pinned,
                created_at: n.created_at,
            })
            .collect();
        let thumbnail = self
            .thumbnail_path(id)
            .filter(|p| p.exists())
            .map(std::fs::read)
            .transpose()?;
        Ok(ProjectArchive {
            name: project.name,
            draft: project.draft,
            versions,
            notes,
            thumbnail,
        })
    }

    /// Recreate an archived project as a new project in this library.
    pub fn import_archive(&self, archive: ProjectArchive) -> Result<Project> {
        let project = self.create_project(&archive.name, &archive.draft)?;
        let tx = self.conn.unchecked_transaction()?;
        // Oldest first, so ids follow history order.
        for v in archive.versions.iter().rev() {
            tx.execute(
                "INSERT INTO versions (project_id, spec, spec_version, created_by, label, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    project.id,
                    spec_json(&v.spec),
                    v.spec.spec_version,
                    v.created_by.as_str(),
                    v.label,
                    v.created_at
                ],
            )?;
        }
        for n in &archive.notes {
            tx.execute(
                "INSERT INTO notes (project_id, body, pinned, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![project.id, n.body, n.pinned, n.created_at],
            )?;
        }
        tx.commit()?;
        if let Some(png) = &archive.thumbnail
            && self.thumbnails.is_some()
        {
            self.save_thumbnail(project.id, png)?;
        }
        self.get_project(project.id)
    }
}

fn clean_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(StoreError::EmptyName);
    }
    Ok(trimmed.chars().take(120).collect())
}

fn spec_json(spec: &Spec) -> String {
    spec::to_value(spec).to_string()
}

/// Stored specs are migrated on read; a row that no longer parses is reported, not hidden.
fn read_spec(project: i64, json: &str) -> Result<Spec> {
    let raw: Value = serde_json::from_str(json).map_err(|e| StoreError::CorruptSpec {
        project,
        message: e.to_string(),
    })?;
    spec::parse(raw).map_err(|e| StoreError::CorruptSpec {
        project,
        message: e.to_string(),
    })
}

fn version_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<VersionSummary> {
    Ok(VersionSummary {
        id: r.get(0)?,
        project_id: r.get(1)?,
        label: r.get(2)?,
        created_by: Author::parse(&r.get::<_, String>(3)?),
        created_at: r.get(4)?,
    })
}

fn note_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        project_id: r.get(1)?,
        body: r.get(2)?,
        pinned: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

#[cfg(test)]
mod tests;
