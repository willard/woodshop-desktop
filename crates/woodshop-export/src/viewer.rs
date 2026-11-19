//! The exported 3D plan: one self-contained HTML file — the viewer's JS, CSS and WebAssembly
//! inlined, plus the design as JSON — that opens from a download folder with no server.

use serde::Serialize;
use serde_json::Value;

use crate::pdf::PlanNote;

const VIEWER_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/viewer.js"));
const VIEWER_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/viewer.css"));
/// The page around the bundle. The browser test of the exported plan (`e2e/viewer.spec.ts`)
/// fills the same file, so what it opens is what this writes.
const VIEWER_HTML: &str = include_str!("../templates/viewer.html");

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
    /// How the page shows sizes (the exporter's setting).
    pub units: woodshop_core::units::Units,
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
    units: woodshop_core::units::Units,
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
        units: input.units,
    };
    // A bundle can never contain a literal closing tag that would end the inline script early.
    let js = VIEWER_JS.replace("</script", "<\\/script");
    let css = VIEWER_CSS.replace("</style", "<\\/style");
    fill(
        VIEWER_HTML,
        &[
            ("theme", theme),
            ("title", &escape_html(input.title)),
            ("css", &css),
            ("payload", &script_safe_json(&payload)),
            ("js", &js),
        ],
    )
}

/// The template with each `{{key}}` replaced, in one pass over the template only, so a value
/// that happens to contain `{{js}}` (a bundle, a part name) is never itself filled in.
fn fill(template: &str, values: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len() + values.iter().map(|(_, v)| v.len()).sum::<usize>());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}").and_then(|end| {
            let key = &after[..end];
            values.iter().find(|(k, _)| *k == key).map(|(_, v)| (end, *v))
        }) {
            Some((end, value)) => {
                out.push_str(value);
                rest = &after[end + 2..];
            }
            None => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_is_filled_once() {
        assert_eq!(
            fill("<{{a}}|{{b}}|{{c}}>", &[("a", "{{b}}"), ("b", "2")]),
            "<{{b}}|2|{{c}}>",
            "a value is not filled again, and an unknown key is left as it is"
        );
        let html = render_viewer_html(&ViewerInput {
            title: "Box",
            spec: serde_json::json!({}),
            kerf: 0.125,
            theme: "light",
            exported_at: "2026-01-01T00:00:00Z",
            notes: vec![],
            units: Default::default(),
        });
        assert!(html.starts_with("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"light\""));
        assert!(html.contains("<title>Box — Woodshop plan</title>"));
        for key in ["theme", "title", "css", "payload", "js"] {
            assert!(!html.contains(&format!("{{{{{key}}}}}")), "{key} filled");
        }
    }

    #[test]
    fn a_hostile_part_name_cannot_close_the_script() {
        let html = render_viewer_html(&ViewerInput {
            title: "<b>Box</b>",
            spec: serde_json::json!({ "name": "</script><img src=x onerror=alert(1)>" }),
            kerf: 0.125,
            theme: "dark",
            exported_at: "2026-01-01T00:00:00Z",
            notes: vec![],
            units: Default::default(),
        });
        assert!(!html.contains("</script><img"));
        assert!(html.contains("<title>&lt;b&gt;Box&lt;/b&gt; — Woodshop plan</title>"));
        assert_eq!(html.matches("</script>").count(), 2);
    }
}
