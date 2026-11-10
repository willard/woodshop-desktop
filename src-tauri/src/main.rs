// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Checked before Tauri starts: an MCP client launches this binary headless over stdio.
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(woodshop_app::run_mcp());
    }
    woodshop_app::run()
}
