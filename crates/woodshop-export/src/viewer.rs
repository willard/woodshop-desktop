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
    /// The file name of the AR model (USDZ) saved beside the page, if there is one. The page
    /// links to it for AR Quick Look on iPhone and iPad.
    pub ar_model: Option<&'a str>,
    /// The GLB files of the imported models the design shows (spec 1.22), as (hash, bytes). They
    /// ride in the payload, base64, so the page stays one file that works offline.
    pub models: Vec<(String, Vec<u8>)>,
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
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    models: std::collections::BTreeMap<&'a str, String>,
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

/// A file name as one relative URL path segment: everything but unreserved bytes escaped.
fn encode_segment(name: &str) -> String {
    name.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The badge inside the AR link. AR Quick Look wants the link's only child to be an image, so
/// the words are drawn in it.
const AR_BADGE: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='172' height='36'%3E%3Crect width='172' height='36' rx='18' fill='%23ffffff' fill-opacity='0.92' stroke='%23000000' stroke-opacity='0.15'/%3E%3Ctext x='86' y='23' text-anchor='middle' font-family='-apple-system,system-ui,sans-serif' font-size='14' font-weight='600' fill='%231c1917'%3EView in your room%3C/text%3E%3C/svg%3E";

/// A plain link, centred on the page, so it works where the page's scripts do not run (a plan
/// opened from the Files app shows nothing else). Where scripts run, the viewer moves it into
/// its 3D controls, or removes it where the browser has no AR Quick Look.
fn ar_link(file: Option<&str>) -> String {
    match file {
        None => String::new(),
        Some(file) => format!(
            "<a rel=\"ar\" id=\"woodshop-ar\" href=\"{}\" style=\"position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;line-height:0\"><img src=\"{AR_BADGE}\" width=\"172\" height=\"36\" alt=\"View in your room\"></a>",
            escape_html(&encode_segment(file))
        ),
    }
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
        models: input
            .models
            .iter()
            .map(|(hash, glb)| {
                use base64::Engine;
                (hash.as_str(), base64::engine::general_purpose::STANDARD.encode(glb))
            })
            .collect(),
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
            ("ar", &ar_link(input.ar_model)),
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
            ar_model: None,
            models: vec![],
        });
        assert!(html.starts_with("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"light\""));
        assert!(html.contains("<title>Box — Woodshop plan</title>"));
        for key in ["theme", "title", "css", "payload", "js", "ar"] {
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
            ar_model: None,
            models: vec![],
        });
        assert!(!html.contains("</script><img"));
        assert!(html.contains("<title>&lt;b&gt;Box&lt;/b&gt; — Woodshop plan</title>"));
        assert_eq!(html.matches("</script>").count(), 2);
    }

    #[test]
    fn a_plan_with_an_ar_model_links_to_it_beside_the_page() {
        let input = |ar_model| ViewerInput {
            title: "Box",
            spec: serde_json::json!({}),
            kerf: 0.125,
            theme: "light",
            exported_at: "2026-01-01T00:00:00Z",
            notes: vec![],
            units: Default::default(),
            ar_model,
            models: vec![],
        };
        let html = render_viewer_html(&input(Some("Bancs & \"tables\".usdz")));
        assert!(html.contains("<a rel=\"ar\" id=\"woodshop-ar\" href=\"Bancs%20%26%20%22tables%22.usdz\""));
        let link = &html[html.find("<a rel").unwrap()..];
        let link = &link[..link.find("</a>").unwrap()];
        assert_eq!(
            link.matches('<').count(),
            2,
            "the image is the link's only child: {link}"
        );
        assert!(!render_viewer_html(&input(None)).contains("rel=\"ar\""));
    }

    #[test]
    fn a_plan_carries_its_imported_models_as_base64() {
        let html = render_viewer_html(&ViewerInput {
            title: "Rack",
            spec: serde_json::json!({}),
            kerf: 0.125,
            theme: "dark",
            exported_at: "2026-01-01T00:00:00Z",
            notes: vec![],
            units: Default::default(),
            ar_model: None,
            models: vec![("ab".repeat(32), b"glTF".to_vec())],
        });
        assert!(html.contains(&format!("\"models\":{{\"{}\":\"Z2xURg==\"}}", "ab".repeat(32))));
    }
}
