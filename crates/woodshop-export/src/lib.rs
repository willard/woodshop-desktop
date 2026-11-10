//! Exports that leave the app: the printable PDF plan and the self-contained 3D viewer page.

pub mod pdf;
pub mod viewer;

use thiserror::Error;

pub use pdf::{PlanInput, PlanNote, render_plan_pdf};
pub use viewer::{ViewerInput, render_viewer_html};

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("Couldn't render the export: {0}")]
    Render(String),
}
