//! Every IPC command the webview can call. Thin: parse and validate input, call the store or the
//! core, map errors. Specs cross as JSON and are validated here — the webview is trusted, but the
//! file on disk must never hold a spec the schema rejects.

use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State};
use woodshop_core::spec::{self, Spec};
use woodshop_core::templates::{self, TemplateSummary};
use woodshop_store::{Author, Note, Project, ProjectArchive, ProjectSummary, Store, VersionSummary};

use crate::error::{CmdResult, CommandError};

pub struct Library {
    pub store: Mutex<Store>,
    pub dir: PathBuf,
}

impl Library {
    pub(crate) fn with<T>(&self, f: impl FnOnce(&Store) -> woodshop_store::Result<T>) -> CmdResult<T> {
        let store = self.store.lock().map_err(CommandError::internal)?;
        Ok(f(&store)?)
    }
}

fn parse_spec(raw: Value) -> CmdResult<Spec> {
    Ok(spec::parse(raw)?)
}

// ---------------------------------------------------------------------------------------------
// Library

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    data_dir: PathBuf,
    thumbnails_dir: PathBuf,
    version: String,
    /// Where the app's log files are written; `None` if the platform has no such directory.
    log_dir: Option<PathBuf>,
}

#[tauri::command]
pub fn library_info(lib: State<'_, Library>, app: tauri::AppHandle) -> LibraryInfo {
    LibraryInfo {
        data_dir: lib.dir.clone(),
        thumbnails_dir: lib.dir.join("thumbnails"),
        version: app.package_info().version.to_string(),
        log_dir: app.path().app_log_dir().ok(),
    }
}

/// Record an error the webview caught (a crashed screen, an unhandled rejection) in the app's
/// log file, so a problem report can include what actually happened. Nothing leaves the machine.
#[tauri::command]
pub fn log_client_error(message: String, detail: Option<String>) {
    let clip = |s: &str, max: usize| s.chars().take(max).collect::<String>();
    match detail {
        Some(detail) => log::error!(target: "webview", "{}\n{}", clip(&message, 2_000), clip(&detail, 8_000)),
        None => log::error!(target: "webview", "{}", clip(&message, 2_000)),
    }
}

#[tauri::command]
pub fn list_projects(lib: State<'_, Library>, trashed: bool) -> CmdResult<Vec<ProjectSummary>> {
    lib.with(|s| s.list_projects(trashed))
}

#[tauri::command]
pub fn list_templates() -> Vec<TemplateSummary> {
    templates::all()
}

/// A new project: blank (a single base board), or started from a gallery template.
#[tauri::command]
/// `metric`: a blank project starts on metric stock (18 mm plywood, 2440 × 1220 sheets).
pub fn create_project(
    lib: State<'_, Library>,
    name: String,
    template: Option<String>,
    metric: Option<bool>,
) -> CmdResult<Project> {
    let spec = match template.as_deref() {
        Some(id) => {
            let mut s = templates::find(id).ok_or_else(|| CommandError::NotFound {
                message: format!("Template \"{id}\" not found."),
            })?;
            if !name.trim().is_empty() {
                s.name = name.trim().chars().take(120).collect();
            }
            s
        }
        None => {
            let options = if metric == Some(true) {
                spec::starter::StarterOptions::metric()
            } else {
                Default::default()
            };
            let mut s = spec::starter::minimal(&name, &options);
            spec::fill_defaults(&mut s);
            s
        }
    };
    let display = if name.trim().is_empty() {
        spec.name.clone()
    } else {
        name
    };
    lib.with(|s| s.create_project(&display, &spec))
}

#[tauri::command]
pub fn get_project(lib: State<'_, Library>, id: i64) -> CmdResult<Project> {
    lib.with(|s| s.get_project(id))
}

#[tauri::command]
pub fn rename_project(lib: State<'_, Library>, id: i64, name: String) -> CmdResult<()> {
    lib.with(|s| s.rename_project(id, &name))
}

#[tauri::command]
pub fn trash_project(lib: State<'_, Library>, id: i64) -> CmdResult<()> {
    lib.with(|s| s.trash_project(id))
}

#[tauri::command]
pub fn restore_project(lib: State<'_, Library>, id: i64) -> CmdResult<()> {
    lib.with(|s| s.restore_project(id))
}

#[tauri::command]
pub fn delete_project_forever(lib: State<'_, Library>, id: i64) -> CmdResult<()> {
    lib.with(|s| s.delete_project_forever(id))
}

#[tauri::command]
pub fn duplicate_project(lib: State<'_, Library>, id: i64) -> CmdResult<Project> {
    lib.with(|s| s.duplicate_project(id))
}

/// Autosave target. `base_updated_at` is the stamp the editor last read; a stale base is refused
/// with the newer draft so the editor can offer keep-mine / take-theirs.
#[tauri::command]
pub fn save_draft(lib: State<'_, Library>, id: i64, spec: Value, base_updated_at: Option<i64>) -> CmdResult<i64> {
    let spec = parse_spec(spec)?;
    lib.with(|s| s.save_draft(id, &spec, base_updated_at))
}

// ---------------------------------------------------------------------------------------------
// Versions

#[tauri::command]
pub fn list_versions(lib: State<'_, Library>, id: i64) -> CmdResult<Vec<VersionSummary>> {
    lib.with(|s| s.list_versions(id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVersion {
    version: VersionSummary,
    draft_updated_at: i64,
}

#[tauri::command]
pub fn create_version(lib: State<'_, Library>, id: i64, spec: Value, label: Option<String>) -> CmdResult<SavedVersion> {
    let spec = parse_spec(spec)?;
    let label = label.map(|l| l.trim().to_owned()).filter(|l| !l.is_empty());
    let (version, draft_updated_at) = lib.with(|s| s.create_version(id, &spec, label.as_deref(), Author::User))?;
    Ok(SavedVersion {
        version,
        draft_updated_at,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredVersion {
    spec: Value,
    draft_updated_at: i64,
}

#[tauri::command]
pub fn restore_version(lib: State<'_, Library>, id: i64, version_id: i64) -> CmdResult<RestoredVersion> {
    let (spec, draft_updated_at) = lib.with(|s| s.restore_version(id, version_id))?;
    Ok(RestoredVersion {
        spec: spec::to_value(&spec),
        draft_updated_at,
    })
}

// ---------------------------------------------------------------------------------------------
// Notes

#[tauri::command]
pub fn list_notes(lib: State<'_, Library>, id: i64) -> CmdResult<Vec<Note>> {
    lib.with(|s| s.list_notes(id))
}

#[tauri::command]
pub fn create_note(lib: State<'_, Library>, id: i64, body: String) -> CmdResult<Note> {
    if body.trim().is_empty() {
        return Err(CommandError::invalid(vec!["A note needs some text.".into()]));
    }
    lib.with(|s| s.create_note(id, &body))
}

#[tauri::command]
pub fn update_note(
    lib: State<'_, Library>,
    note_id: i64,
    body: Option<String>,
    pinned: Option<bool>,
) -> CmdResult<Note> {
    lib.with(|s| s.update_note(note_id, body.as_deref(), pinned))
}

#[tauri::command]
pub fn delete_note(lib: State<'_, Library>, note_id: i64) -> CmdResult<()> {
    lib.with(|s| s.delete_note(note_id))
}

// ---------------------------------------------------------------------------------------------
// Settings

#[tauri::command]
pub fn get_settings(lib: State<'_, Library>) -> CmdResult<serde_json::Map<String, Value>> {
    lib.with(|s| s.settings())
}

#[tauri::command]
pub fn set_setting(lib: State<'_, Library>, key: String, value: Value) -> CmdResult<()> {
    lib.with(|s| s.set_setting(&key, &value))
}

// ---------------------------------------------------------------------------------------------
// Thumbnails — the PNG arrives as the raw request body, not a JSON number array.

#[tauri::command]
pub fn save_thumbnail(lib: State<'_, Library>, request: tauri::ipc::Request<'_>) -> CmdResult<i64> {
    let id: i64 = request
        .headers()
        .get("x-project-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| CommandError::invalid(vec!["Missing x-project-id header.".into()]))?;
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err(CommandError::invalid(vec![
            "Thumbnail must be sent as raw PNG bytes.".into(),
        ]));
    };
    lib.with(|s| s.save_thumbnail(id, png))?;
    Ok(woodshop_store::now_ms())
}

// ---------------------------------------------------------------------------------------------
// .woodshop files

#[tauri::command]
pub fn export_project_file(lib: State<'_, Library>, id: i64, path: PathBuf) -> CmdResult<()> {
    let archive = lib.with(|s| s.export_archive(id))?;
    let tmp = path.with_extension("woodshop.partial");
    archive.write(BufWriter::new(File::create(&tmp)?))?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[tauri::command]
pub fn import_project_file(lib: State<'_, Library>, path: PathBuf) -> CmdResult<Project> {
    let archive = ProjectArchive::read(std::io::BufReader::new(File::open(&path)?))?;
    lib.with(|s| s.import_archive(archive))
}

/// A bare spec JSON (e.g. from the old web app's "download spec") becomes a new project.
#[tauri::command]
pub fn import_spec_json(lib: State<'_, Library>, path: PathBuf) -> CmdResult<Project> {
    let raw: Value = serde_json::from_reader(std::io::BufReader::new(File::open(&path)?))
        .map_err(|e| CommandError::invalid(vec![format!("Not a JSON file: {e}")]))?;
    let spec = parse_spec(raw)?;
    let name = spec.name.clone();
    lib.with(|s| s.create_project(&name, &spec))
}

/// A new project from a spec the editor assembled, e.g. a group lifted out of another design.
/// Validated like any import; the name falls back to the spec's own.
#[tauri::command]
pub fn create_project_from_spec(lib: State<'_, Library>, name: String, spec: Value) -> CmdResult<Project> {
    let spec = parse_spec(spec)?;
    let name = if name.trim().is_empty() {
        spec.name.clone()
    } else {
        name
    };
    lib.with(|s| s.create_project(&name, &spec))
}

/// Write a text file the webview produced (SVG template, spec JSON) to a user-chosen path.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    path: PathBuf,
    contents: String,
}

#[tauri::command]
pub fn write_text_file(file: TextFile) -> CmdResult<()> {
    std::fs::write(&file.path, file.contents)?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// MCP

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetup {
    /// The executable an MCP client should launch.
    command: PathBuf,
    args: Vec<String>,
    /// Ready to paste into Claude Desktop's `claude_desktop_config.json`.
    claude_desktop_config: String,
    /// One line for Claude Code.
    claude_code_command: String,
}

/// How to point an MCP client at this install: the app binary itself, run with `--mcp`.
#[tauri::command]
pub fn mcp_setup() -> CmdResult<McpSetup> {
    let command = std::env::current_exe()?;
    let args = vec!["--mcp".to_string()];
    let config = serde_json::json!({
        "mcpServers": { "woodshop": { "command": command, "args": args } }
    });
    let quoted = shell_quote(&command.to_string_lossy());
    Ok(McpSetup {
        claude_desktop_config: serde_json::to_string_pretty(&config).map_err(CommandError::internal)?,
        claude_code_command: format!("claude mcp add woodshop -- {quoted} --mcp"),
        command,
        args,
    })
}

fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)) {
        s.to_owned()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

// ---------------------------------------------------------------------------------------------
// Plan exports — rendered from the stored draft (the editor flushes its autosave first).

fn plan_notes(store: &Store, id: i64) -> woodshop_store::Result<Vec<woodshop_export::PlanNote>> {
    Ok(store
        .list_notes(id)?
        .into_iter()
        .map(|n| woodshop_export::PlanNote {
            body: n.body,
            pinned: n.pinned,
        })
        .collect())
}

/// The printable PDF plan: cut list, sheet layouts, hardware and shop notes.
#[tauri::command]
pub async fn export_pdf(
    lib: State<'_, Library>,
    id: i64,
    path: PathBuf,
    kerf: f64,
    date: String,
    units: Option<woodshop_core::units::Units>,
) -> CmdResult<()> {
    let (project, notes, thumbnail) = lib.with(|s| {
        let project = s.get_project(id)?;
        let notes = plan_notes(s, id)?;
        let thumbnail = s
            .thumbnail_path(id)
            .filter(|p| p.exists())
            .map(std::fs::read)
            .transpose()?;
        Ok((project, notes, thumbnail))
    })?;
    // Typesetting takes a moment; keep it off the thread that serves other commands.
    let pdf = tauri::async_runtime::spawn_blocking(move || {
        woodshop_export::render_plan_pdf(&woodshop_export::PlanInput {
            title: &project.name,
            spec: &project.draft,
            kerf,
            date: &date,
            notes,
            thumbnail,
            units: units.unwrap_or_default(),
        })
    })
    .await
    .map_err(CommandError::internal)?
    .map_err(CommandError::internal)?;
    std::fs::write(&path, pdf)?;
    Ok(())
}

/// The interactive 3D plan as one self-contained HTML file that opens in any browser, offline.
#[tauri::command]
pub fn export_viewer(
    lib: State<'_, Library>,
    id: i64,
    path: PathBuf,
    kerf: f64,
    theme: String,
    exported_at: String,
    units: Option<woodshop_core::units::Units>,
) -> CmdResult<()> {
    let (project, notes) = lib.with(|s| Ok((s.get_project(id)?, plan_notes(s, id)?)))?;
    let html = woodshop_export::render_viewer_html(&woodshop_export::ViewerInput {
        title: &project.name,
        spec: spec::to_value(&project.draft),
        kerf,
        theme: &theme,
        exported_at: &exported_at,
        notes,
        units: units.unwrap_or_default(),
    });
    std::fs::write(&path, html)?;
    Ok(())
}
