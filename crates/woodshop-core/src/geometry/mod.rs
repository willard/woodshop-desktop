//! Spec-space geometry: where parts and ops are in world and local inches. Dependency-free (no
//! renderer); the linter, cut list, MCP `explain_part` and the SVG shop drawing all resolve
//! positions through here so they quote the same numbers.

pub mod frame;
pub mod op_extent;
pub mod outline;
pub mod outline_svg;

pub use frame::*;
