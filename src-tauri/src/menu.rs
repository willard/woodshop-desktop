//! The native menu bar. Our own items only name an action: they are sent to the webview as a
//! `menu` event carrying the item id, and the UI (`AppEvents`) performs it. The standard items
//! (edit, window, app) are the platform's own.
//!
//! macOS gets the full conventional menu: without an Edit menu, ⌘C/⌘V don't reach text fields.
//! Windows and Linux get only our items: there, menu accelerators are handled before the webview
//! sees the key, so a native Edit ▸ Undo would swallow the editor's own Ctrl+Z.

use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// Ids the UI knows how to act on.
const NEW: &str = "new-from-template";
const OPEN: &str = "open-project-file";
const SETTINGS: &str = "settings";
const PROJECTS: &str = "go-projects";
const TEMPLATES: &str = "go-templates";
const TOOLS: &str = "go-tools";
const HELP: &str = "go-help";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| {
        let builder = MenuItemBuilder::with_id(id, text);
        match accelerator {
            Some(a) => builder.accelerator(a),
            None => builder,
        }
        .build(app)
    };

    let new = item(NEW, "New from Template…", Some("CmdOrCtrl+N"))?;
    let open = item(OPEN, "Open Project File…", Some("CmdOrCtrl+O"))?;
    let settings = item(SETTINGS, "Settings…", Some("CmdOrCtrl+,"))?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(PROJECTS, "Projects", Some("CmdOrCtrl+Shift+P"))?)
        .item(&item(TEMPLATES, "Templates", Some("CmdOrCtrl+Shift+T"))?)
        .item(&item(TOOLS, "Shop Calculators", Some("CmdOrCtrl+Shift+K"))?);
    let help = SubmenuBuilder::new(app, "Help").item(&item(HELP, "Woodshop Help", None)?);

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "Woodshop")
            .about(None)
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        let file = SubmenuBuilder::new(app, "File")
            .item(&new)
            .item(&open)
            .separator()
            .close_window()
            .build()?;
        let edit = SubmenuBuilder::new(app, "Edit")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;
        let view = view.separator().fullscreen().build()?;
        let window = SubmenuBuilder::new(app, "Window")
            .minimize()
            .maximize()
            .separator()
            .bring_all_to_front()
            .build()?;
        MenuBuilder::new(app)
            .items(&[&app_menu, &file, &edit, &view, &window, &help.build()?])
            .build()
    } else {
        let file = SubmenuBuilder::new(app, "File")
            .item(&new)
            .item(&open)
            .separator()
            .item(&settings)
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .items(&[&file, &view.build()?, &help.build()?])
            .build()
    }
}

/// Forward our own items to the webview; the predefined ones act natively and never get here.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if [NEW, OPEN, SETTINGS, PROJECTS, TEMPLATES, TOOLS, HELP].contains(&id) {
        let _ = app.emit("menu", id);
    }
}
