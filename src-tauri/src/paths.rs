//! Where the project library lives. The app and the headless MCP server must agree, so both derive
//! it the same way: `WOODSHOP_DATA_DIR` when set (tests, portable installs), else the platform
//! app-data directory for the bundle identifier.

use std::path::PathBuf;

use tauri::Manager;

/// `identifier` in `tauri.conf.json`; the MCP server resolves the library without a Tauri app.
pub const IDENTIFIER: &str = "studio.woodshop.desktop";

pub fn library_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    if let Some(dir) = std::env::var_os("WOODSHOP_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path().app_data_dir()
}

/// The same directory as [`library_dir`], for `--mcp`: Tauri's desktop `app_data_dir` is the
/// platform data directory joined with the bundle identifier.
pub fn headless_library_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("WOODSHOP_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    dirs::data_dir().map(|d| d.join(IDENTIFIER))
}

#[cfg(test)]
mod tests {
    #[test]
    fn identifier_matches_the_tauri_config() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], super::IDENTIFIER);
    }
}
