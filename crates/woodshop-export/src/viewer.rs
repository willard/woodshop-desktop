//! The exported 3D plan: one self-contained HTML file — the viewer's JS, CSS and WebAssembly
//! inlined, plus the design as JSON — that opens from a download folder with no server.

use serde::Serialize;
use serde_json::Value;

use crate::pdf::PlanNote;

const VIEWER_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/viewer.js"));
const VIEWER_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/viewer.css"));

/// Bumped when the payload shape changes, so an old viewer can refuse a newer file.
pub const PAYLOAD_VERSION: u32 = 1;

pub struct ViewerInput<'a> {
    pub title: &'a str,
    /// The spec as JSON (already normalized).
    pub spec: Value,
    pub kerf: f64,
    pub theme: &'a str,
    pub exported_at: &'a str,
    pub notes: Vec<PlanNote>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Payload<'a> {
    version: u32,
    exported_at: &'a str,
    project: ProjectName<'a>,
    spec: &'a Value,
    kerf: f64,
    theme: &'a str,
    notes: &'a [PlanNote],
}

#[derive(Serialize)]
struct ProjectName<'a> {
    name: &'a str,
}

/// JSON safe to inline in a `<script>` element: `<`, `>` and `&` only ever occur inside JSON
/// strings, where their `\u` escapes mean the same thing — so a part named `</script>` is inert.
fn script_safe_json(value: &impl Serialize) -> String {
    serde_json::to_string(value)
        .expect("payload serializes")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn render_viewer_html(input: &ViewerInput<'_>) -> String {
    let theme = if input.theme == "light" { "light" } else { "dark" };
    let payload = Payload {
        version: PAYLOAD_VERSION,
        exported_at: input.exported_at,
        project: ProjectName { name: input.title },
        spec: &input.spec,
        kerf: input.kerf,
        theme,
        notes: &input.notes,
    };
    // A bundle can never contain a literal closing tag that would end the inline script early.
    let js = VIEWER_JS.replace("</script", "<\\/script");
    let css = VIEWER_CSS.replace("</style", "<\\/style");
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"{theme}\" class=\"h-full\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>{title} — Woodshop plan</title>\n<style>{css}</style>\n</head>\n<body class=\"h-full\">\n<div id=\"viewer\" class=\"h-full\"></div>\n<script type=\"application/json\" id=\"woodshop-export\">{json}</script>\n<script>{js}</script>\n</body>\n</html>\n",
        title = escape_html(input.title),
        json = script_safe_json(&payload),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hostile_part_name_cannot_close_the_script() {
        let html = render_viewer_html(&ViewerInput {
            title: "<b>Box</b>",
            spec: serde_json::json!({ "name": "</script><img src=x onerror=alert(1)>" }),
            kerf: 0.125,
            theme: "dark",
            exported_at: "2026-01-01T00:00:00Z",
            notes: vec![],
        });
        assert!(!html.contains("</script><img"));
        assert!(html.contains("<title>&lt;b&gt;Box&lt;/b&gt; — Woodshop plan</title>"));
        assert_eq!(html.matches("</script>").count(), 2);
    }
}
