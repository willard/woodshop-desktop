//! Reference material an agent can read without calling a tool: the §3.1 conventions, the JSON
//! Schema, and any built-in template as a worked example.

use woodshop_core::spec::{self, validate};
use woodshop_core::templates;

use crate::CONVENTIONS;

pub struct ResourceDef {
    pub uri: &'static str,
    pub name: &'static str,
    pub title: &'static str,
    pub mime_type: &'static str,
    pub description: &'static str,
}

pub const CONVENTIONS_RESOURCE: ResourceDef = ResourceDef {
    uri: "woodshop://spec/conventions",
    name: "conventions",
    title: "Woodshop design conventions (§3.1)",
    mime_type: "text/markdown",
    description: "READ THIS BEFORE AUTHORING. The coordinate and op contract every Woodshop spec must \
        follow: the local part frame and rot recipes (which world axis a part's length and width land \
        on), face/edge naming, the datum every op measures from, dado/notch/curve/ease/fastener op \
        shapes, and the connectivity, fastening, material and proportion rules the buildability linter \
        enforces. Following it is the difference between a design that validates first try and a string \
        of rejected edits.",
};

pub const SCHEMA_RESOURCE: ResourceDef = ResourceDef {
    uri: "woodshop://spec/schema",
    name: "schema",
    title: "Woodshop spec JSON Schema",
    mime_type: "application/json",
    description: "The canonical JSON Schema every Woodshop design is validated against — parts, \
        materials, transforms, joints, groups, movables, and each op variant (dado, groove, rabbet, \
        hole, miter, curve, notch, ease, pocketHoles, screws) with its required fields and enums. Pair \
        it with woodshop://spec/conventions, which gives the semantics the schema cannot express.",
};

pub const TEMPLATE_URI: &str = "woodshop://templates/{id}";
pub const TEMPLATE_RESOURCE: ResourceDef = ResourceDef {
    uri: TEMPLATE_URI,
    name: "template",
    title: "Woodshop template spec",
    mime_type: "application/json",
    description: "The full parametric spec of one built-in template, as a worked example to copy the \
        arithmetic from — how a real design places, rotates, seats and fastens its parts. Ids are the \
        ones start_from_template lists (side-table, bookshelf, picnic-table, nightstand, …), e.g. \
        woodshop://templates/picnic-table. Reading a template does not create a project.",
};

/// The text behind a resource URI, and its MIME type.
pub fn read(uri: &str) -> Result<(&'static str, String), String> {
    match uri {
        u if u == CONVENTIONS_RESOURCE.uri => Ok((CONVENTIONS_RESOURCE.mime_type, CONVENTIONS.to_owned())),
        u if u == SCHEMA_RESOURCE.uri => Ok((SCHEMA_RESOURCE.mime_type, validate::SCHEMA_JSON.to_owned())),
        u => {
            let id = u
                .strip_prefix("woodshop://templates/")
                .ok_or_else(|| format!("No resource \"{u}\"."))?;
            let spec = templates::find(id).ok_or_else(|| {
                let ids: Vec<&str> = templates::all().iter().map(|t| t.id).collect();
                format!("No template \"{id}\". Available: {}.", ids.join(", "))
            })?;
            let text = serde_json::to_string_pretty(&spec::to_value(&spec)).map_err(|e| e.to_string())?;
            Ok((TEMPLATE_RESOURCE.mime_type, text))
        }
    }
}
