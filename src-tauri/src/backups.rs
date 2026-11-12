//! Automatic backups of the project library. Once a day (checked at launch and every hour after)
//! the database is copied to `<library>/backups/woodshop-<ms>.db`, and only the newest
//! [`KEEP`] are kept. Restoring copies a project OUT of a backup into the library as a new
//! project, so a restore never overwrites anything: the worst case is a project you didn't need.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use woodshop_store::{Project, ProjectSummary, Store, now_ms};

use crate::commands::Library;
use crate::error::{CmdResult, CommandError};

/// How many daily backups to keep.
pub const KEEP: usize = 7;
/// A backup newer than this counts as today's.
const DAY_MS: i64 = 22 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// The file name, which is also the backup's id.
    pub file: String,
    pub created_at: i64,
    pub bytes: u64,
}

pub fn dir_of(library: &Path) -> PathBuf {
    library.join("backups")
}

/// Every backup in the folder, newest first. Files that are not ours are ignored.
pub fn list(library: &Path) -> Vec<BackupInfo> {
    let Ok(entries) = std::fs::read_dir(dir_of(library)) else {
        return Vec::new();
    };
    let mut out: Vec<BackupInfo> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            let created_at = file.strip_prefix("woodshop-")?.strip_suffix(".db")?.parse().ok()?;
            Some(BackupInfo {
                bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                file,
                created_at,
            })
        })
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    out
}

/// Make a backup now and drop the oldest beyond [`KEEP`].
pub fn make(store: &Store, library: &Path) -> woodshop_store::Result<BackupInfo> {
    let dir = dir_of(library);
    std::fs::create_dir_all(&dir)?;
    let created_at = now_ms();
    let file = format!("woodshop-{created_at}.db");
    store.backup_to(&dir.join(&file))?;
    for old in list(library).into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(dir.join(old.file));
    }
    let bytes = std::fs::metadata(dir.join(&file)).map(|m| m.len()).unwrap_or(0);
    Ok(BackupInfo {
        file,
        created_at,
        bytes,
    })
}

/// Make today's backup if there is none yet.
fn ensure_daily(library: &Path) {
    let fresh = list(library).first().is_some_and(|b| now_ms() - b.created_at < DAY_MS);
    if fresh {
        return;
    }
    match Store::open(library).and_then(|store| make(&store, library)) {
        Ok(b) => log::info!("library backed up to {}", b.file),
        Err(e) => log::warn!("daily backup failed: {e}"),
    }
}

/// Back up at launch (off the startup path) and keep checking hourly while the app runs.
pub fn spawn_daily(library: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            ensure_daily(&library);
            std::thread::sleep(Duration::from_secs(60 * 60));
        }
    });
}

/// A backup file named by the UI, checked to be one of ours (no paths, no traversal).
fn resolve(library: &Path, file: &str) -> CmdResult<PathBuf> {
    if !list(library).iter().any(|b| b.file == file) {
        return Err(CommandError::NotFound {
            message: format!("There is no backup \"{file}\"."),
        });
    }
    Ok(dir_of(library).join(file))
}

/// Opens a private copy of a backup (opening a database can change the file it opens).
fn open_copy(path: &Path) -> CmdResult<(Store, PathBuf)> {
    let copy = std::env::temp_dir().join(format!("woodshop-restore-{}.db", now_ms()));
    std::fs::copy(path, &copy)?;
    Ok((Store::open_file(&copy)?, copy))
}

fn cleanup(copy: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", copy.display()));
    }
}

#[tauri::command]
pub fn list_backups(lib: State<'_, Library>) -> Vec<BackupInfo> {
    list(&lib.dir)
}

#[tauri::command]
pub fn backup_now(lib: State<'_, Library>) -> CmdResult<BackupInfo> {
    let store = lib.store.lock().map_err(CommandError::internal)?;
    Ok(make(&store, &lib.dir)?)
}

/// The projects inside one backup, trashed ones included (they can be brought back too).
#[tauri::command]
pub fn backup_projects(lib: State<'_, Library>, file: String) -> CmdResult<Vec<ProjectSummary>> {
    let (store, copy) = open_copy(&resolve(&lib.dir, &file)?)?;
    let result = store
        .list_projects(false)
        .and_then(|mut live| {
            live.extend(store.list_projects(true)?);
            Ok(live)
        })
        .map_err(CommandError::from);
    drop(store);
    cleanup(&copy);
    result
}

/// Copies one project out of a backup into the library, as a new project, with its history
/// and notes.
#[tauri::command]
pub fn restore_from_backup(lib: State<'_, Library>, file: String, project_id: i64) -> CmdResult<Project> {
    let (backup, copy) = open_copy(&resolve(&lib.dir, &file)?)?;
    let archive = backup.export_archive(project_id);
    drop(backup);
    cleanup(&copy);
    let mut archive = archive?;
    archive.name = format!("{} (restored)", archive.name).chars().take(120).collect();
    lib.with(|s| s.import_archive(archive))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_newest_week() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        for _ in 0..(KEEP + 3) {
            make(&store, dir.path()).unwrap();
            std::thread::sleep(Duration::from_millis(3)); // distinct timestamps
        }
        let backups = list(dir.path());
        assert_eq!(backups.len(), KEEP);
        assert!(backups.windows(2).all(|w| w[0].created_at > w[1].created_at));
        // Someone else's file in the folder is left alone and not listed.
        std::fs::write(dir_of(dir.path()).join("notes.txt"), "hi").unwrap();
        assert_eq!(list(dir.path()).len(), KEEP);
    }

    #[test]
    fn a_name_that_is_not_a_backup_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve(dir.path(), "../woodshop.db").is_err());
        assert!(resolve(dir.path(), "woodshop-1.db").is_err());
    }
}
