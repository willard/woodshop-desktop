//! Woodshop's local MCP server: the design tools an AI agent (Claude Desktop, Claude Code, …) uses
//! to read and author designs in this computer's library, over stdio.
//!
//! The desktop app launches it as `woodshop --mcp`. It opens the same SQLite library the app uses
//! (WAL mode, so both can run at once); every change is snapshotted as a version by `mcp` first,
//! and the open editor picks it up through its library watcher.

use std::path::Path;

use rmcp::ServiceExt;
use woodshop_store::Store;

mod args;
mod ctx;
mod resources;
mod server;
pub mod tools;

pub use ctx::{Outcome, Woodshop};
pub use server::WoodshopServer;

/// The §3.1 authoring contract, served by `get_conventions` and `woodshop://spec/conventions`.
pub const CONVENTIONS: &str = include_str!("../../../resources/conventions.md");

/// Serve the library in `data_dir` over stdin/stdout until the client disconnects.
pub async fn serve_stdio(data_dir: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let store = Store::open(data_dir)?;
    let service = WoodshopServer::new(Woodshop::new(store))
        .serve(rmcp::transport::io::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}
