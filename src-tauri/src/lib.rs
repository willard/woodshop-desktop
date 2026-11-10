//! Woodshop desktop shell: a Tauri window over the React editor, a local SQLite project library,
//! and the Rust domain core. Everything stays on this computer — no account, no server.

mod commands;
mod error;
mod menu;
mod paths;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent};
use woodshop_store::Store;

use commands::Library;

/// Files the OS asked us to open (double-clicked `.woodshop`) before the webview was listening.
#[derive(Default)]
struct PendingOpens(Mutex<Vec<PathBuf>>);

#[tauri::command]
fn take_pending_opens(pending: tauri::State<'_, PendingOpens>) -> Vec<PathBuf> {
    pending
        .0
        .lock()
        .map(|mut v| std::mem::take(&mut *v))
        .unwrap_or_default()
}

fn woodshop_files(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("woodshop")) && p.is_file())
        .collect()
}

/// Watches the database for commits from OTHER processes (the MCP server) and tells the webview,
/// which re-reads what it shows. A second connection's `data_version` is the cheap, exact signal.
fn spawn_library_watcher(app: tauri::AppHandle, dir: PathBuf) {
    std::thread::spawn(move || {
        let Ok(watcher) = Store::open(&dir) else {
            log::warn!("library watcher could not open {}", dir.display());
            return;
        };
        let mut last = watcher.data_version().unwrap_or(0);
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            match watcher.data_version() {
                Ok(v) if v != last => {
                    last = v;
                    let _ = app.emit("library-changed", ());
                }
                Ok(_) => {}
                Err(e) => log::warn!("library watcher: {e}"),
            }
        }
    });
}

/// `woodshop --mcp`: serve the library to an MCP client over stdio instead of opening a window.
/// Returns the process exit code. Nothing but protocol may reach stdout, so errors go to stderr.
pub fn run_mcp() -> i32 {
    let Some(dir) = paths::headless_library_dir() else {
        eprintln!("woodshop --mcp: no application data directory on this system; set WOODSHOP_DATA_DIR.");
        return 1;
    };
    match tauri::async_runtime::block_on(woodshop_mcp::serve_stdio(&dir)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("woodshop --mcp: {e}");
            1
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // A second launch (e.g. double-clicking a .woodshop file) focuses this window instead.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let files = woodshop_files(argv);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        builder = builder.menu(menu::build).on_menu_event(menu::on_event);
    }

    let app = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(PendingOpens(Mutex::new(woodshop_files(std::env::args().skip(1)))))
        .setup(|app| {
            let dir = paths::library_dir(app.handle())?;
            let store = Store::open(&dir)?;
            log::info!("project library at {}", dir.display());
            app.manage(Library {
                store: Mutex::new(store),
                dir: dir.clone(),
            });
            spawn_library_watcher(app.handle().clone(), dir);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_opens,
            commands::library_info,
            commands::list_projects,
            commands::list_templates,
            commands::create_project,
            commands::get_project,
            commands::rename_project,
            commands::trash_project,
            commands::restore_project,
            commands::delete_project_forever,
            commands::duplicate_project,
            commands::save_draft,
            commands::list_versions,
            commands::create_version,
            commands::restore_version,
            commands::list_notes,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::get_settings,
            commands::set_setting,
            commands::save_thumbnail,
            commands::export_project_file,
            commands::import_project_file,
            commands::import_spec_json,
            commands::create_project_from_spec,
            commands::write_text_file,
            commands::mcp_setup,
            commands::export_pdf,
            commands::export_viewer,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Woodshop");

    app.run(|handle, event| {
        // macOS delivers "open this file" as an event, not an argument.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = &event {
            let files: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            if let Some(pending) = handle.try_state::<PendingOpens>()
                && let Ok(mut v) = pending.0.lock()
            {
                v.extend(files.iter().cloned());
            }
            let _ = handle.emit("open-files", files);
        }
        let _ = (handle, &event);
    });
}
