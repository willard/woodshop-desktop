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
// The design assistant's saved chat (one per project; the panel owns its shape)

#[tauri::command]
pub fn get_assistant_chat(lib: State<'_, Library>, id: i64) -> CmdResult<Option<Value>> {
    lib.with(|s| s.assistant_chat(id))
}

#[tauri::command]
pub fn set_assistant_chat(lib: State<'_, Library>, id: i64, chat: Value) -> CmdResult<()> {
    lib.with(|s| s.set_assistant_chat(id, &chat))
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

/// Write a binary file the webview produced (the assembly video) to a user-chosen path. The bytes
/// are the raw request body; the path rides in the `x-path` header, percent-encoded because a
/// header is ASCII and a path need not be.
#[tauri::command]
pub fn write_binary_file(request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or_else(|| CommandError::invalid(vec!["Missing or malformed x-path header.".into()]))?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::invalid(vec![
            "The file must be sent as raw bytes.".into(),
        ]));
    };
    std::fs::write(PathBuf::from(path), bytes)?;
    Ok(())
}

/// Standard base64 (with or without padding) to bytes; None if it is not base64.
fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let digits: Vec<u8> = text.trim_end_matches('=').bytes().map(value).collect::<Option<_>>()?;
    if digits.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(digits.len() * 3 / 4);
    for chunk in digits.chunks(4) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, d)| n | (u32::from(*d) << (18 - 6 * i)));
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// `encodeURIComponent` undone: `%XX` escapes back to bytes, read as UTF-8.
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok().filter(|p| !p.is_empty())
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

/// The user's hardware prices (the `hardwarePrices` setting), for costing a plan.
fn hardware_prices(store: &Store) -> woodshop_store::Result<std::collections::BTreeMap<String, f64>> {
    Ok(store
        .settings()?
        .get("hardwarePrices")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default())
}

/// The stock the user already has (the `offcuts` setting), used before anything is bought.
fn offcuts(store: &Store) -> woodshop_store::Result<Vec<woodshop_core::cutlist::Offcut>> {
    Ok(store
        .settings()?
        .get("offcuts")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default())
}

/// What is trimmed off each edge of a bought sheet (the `sheetTrim` setting) or each end of a
/// bought board (`boardTrim`) before it is cut.
fn trim(store: &Store, key: &str) -> woodshop_store::Result<f64> {
    Ok(store
        .settings()?
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .filter(|t| t.is_finite() && *t >= 0.0)
        .unwrap_or(0.0))
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
    step_pictures: Option<Vec<String>>,
) -> CmdResult<()> {
    // The app renders a picture per assembly step and sends them base64-encoded.
    let step_pictures = step_pictures
        .unwrap_or_default()
        .iter()
        .map(|p| base64_decode(p))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| CommandError::invalid(vec!["A step picture is not valid base64.".into()]))?;
    let (project, notes, thumbnail, hardware_prices, offcuts, trims) = lib.with(|s| {
        let project = s.get_project(id)?;
        let notes = plan_notes(s, id)?;
        let hardware_prices = hardware_prices(s)?;
        let offcuts = offcuts(s)?;
        let trims = (trim(s, "sheetTrim")?, trim(s, "boardTrim")?);
        let thumbnail = s
            .thumbnail_path(id)
            .filter(|p| p.exists())
            .map(std::fs::read)
            .transpose()?;
        Ok((project, notes, thumbnail, hardware_prices, offcuts, trims))
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
            hardware_prices,
            offcuts,
            sheet_trim: trims.0,
            board_trim: trims.1,
            step_pictures,
        })
    })
    .await
    .map_err(CommandError::internal)?
    .map_err(CommandError::internal)?;
    std::fs::write(&path, pdf)?;
    Ok(())
}

/// One label per piece to cut, on a standard sheet of sticky labels (Letter, or A4 in metric).
#[tauri::command]
pub async fn export_labels(
    lib: State<'_, Library>,
    id: i64,
    path: PathBuf,
    kerf: f64,
    units: Option<woodshop_core::units::Units>,
    skip: Option<usize>,
) -> CmdResult<()> {
    let (project, offcuts, trims) = lib.with(|s| {
        Ok((
            s.get_project(id)?,
            offcuts(s)?,
            (trim(s, "sheetTrim")?, trim(s, "boardTrim")?),
        ))
    })?;
    let pdf = tauri::async_runtime::spawn_blocking(move || {
        woodshop_export::render_labels_pdf(&woodshop_export::LabelsInput {
            title: &project.name,
            spec: &project.draft,
            kerf,
            units: units.unwrap_or_default(),
            skip: skip.unwrap_or(0),
            offcuts,
            sheet_trim: trims.0,
            board_trim: trims.1,
        })
    })
    .await
    .map_err(CommandError::internal)?
    .map_err(CommandError::internal)?;
    std::fs::write(&path, pdf)?;
    Ok(())
}

/// The interactive 3D plan as one self-contained HTML file that opens in any browser, offline.
// A Tauri command's arguments are the invoke payload's fields.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn export_viewer(
    lib: State<'_, Library>,
    id: i64,
    path: PathBuf,
    kerf: f64,
    theme: String,
    exported_at: String,
    units: Option<woodshop_core::units::Units>,
    ar_model: Option<String>,
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
        // Only a bare file name beside the page; anything with a path in it is dropped.
        ar_model: ar_model.as_deref().filter(|f| !f.contains(['/', '\\'])),
    });
    std::fs::write(&path, html)?;
    Ok(())
}

/// Everything a gallery post carries, as one zip: the design as a `.woodshop` file (without its
/// version history or notes) and its 3D plan (without the shop notes). `stem` names both inside.
// A Tauri command's arguments are the invoke payload's fields.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn export_gallery_bundle(
    lib: State<'_, Library>,
    id: i64,
    path: PathBuf,
    stem: String,
    kerf: f64,
    theme: String,
    exported_at: String,
    units: Option<woodshop_core::units::Units>,
) -> CmdResult<()> {
    if stem.is_empty() || stem.contains(['/', '\\']) {
        return Err(CommandError::invalid(vec!["Not a file name.".into()]));
    }
    let (project, archive) = lib.with(|s| Ok((s.get_project(id)?, s.export_archive(id)?.for_sharing())))?;
    let mut design = std::io::Cursor::new(Vec::new());
    archive.write(&mut design)?;
    let html = woodshop_export::render_viewer_html(&woodshop_export::ViewerInput {
        title: &project.name,
        spec: spec::to_value(&project.draft),
        kerf,
        theme: &theme,
        exported_at: &exported_at,
        notes: Vec::new(),
        units: units.unwrap_or_default(),
        ar_model: None,
    });
    let tmp = path.with_extension("zip.partial");
    woodshop_store::write_bundle(
        BufWriter::new(File::create(&tmp)?),
        &[
            (&format!("{stem}.woodshop"), design.get_ref()),
            (&format!("{stem} 3D plan.html"), html.as_bytes()),
        ],
    )?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{base64_decode, percent_decode};

    #[test]
    fn base64_comes_back_as_its_bytes() {
        assert_eq!(base64_decode("TWFu").as_deref(), Some(&b"Man"[..]));
        assert_eq!(base64_decode("TWE=").as_deref(), Some(&b"Ma"[..]));
        assert_eq!(base64_decode("TQ==").as_deref(), Some(&b"M"[..]));
        assert_eq!(base64_decode("/9j/").as_deref(), Some(&[0xFF, 0xD8, 0xFF][..]));
        assert_eq!(base64_decode(""), Some(Vec::new()));
        assert_eq!(base64_decode("T"), None);
        assert_eq!(base64_decode("a b"), None);
    }

    #[test]
    fn a_path_comes_back_from_its_header() {
        assert_eq!(
            percent_decode("%2FUsers%2Fm%C3%A9lanie%2FBancs%20%26%20tables%2Fbanc.mp4").as_deref(),
            Some("/Users/mélanie/Bancs & tables/banc.mp4")
        );
        assert_eq!(percent_decode("C%3A%5Cvideo.mp4").as_deref(), Some("C:\\video.mp4"));
        assert_eq!(percent_decode("%ZZ"), None);
        assert_eq!(percent_decode("%2"), None);
        assert_eq!(percent_decode(""), None);
    }
}
