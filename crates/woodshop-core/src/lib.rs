//! Woodshop domain core. Pure functions over the parametric spec — no I/O, no clocks, no
//! randomness — so the same code runs natively (Tauri commands, MCP server, PDF export) and in
//! the webview via WASM (live linting, outlines, cut list).
//!
//! Every dimension is decimal inches. Metric and fractions are display-only conversions
//! (`units`).

pub mod cutlist;
pub mod fasteners;
pub mod geometry;
pub mod lint;
pub mod movables;
pub mod spec;
#[cfg(feature = "validate")]
pub mod templates;
pub mod units;
