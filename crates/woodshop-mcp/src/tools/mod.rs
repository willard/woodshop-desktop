//! The tool registry. Each tool is a name, the description an agent reads to choose it, its input
//! schema, and a handler over the library. Handlers are plain synchronous functions (the library
//! is a local SQLite file), so the MCP transport stays a thin shell around [`call`].

use serde_json::{Map, Value, json};

use crate::args::Args;
use crate::ctx::{Outcome, Woodshop};

mod authoring;
mod edit;
mod joinery;
mod read;
mod start;

pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    /// Writes nothing (hint for clients that auto-approve reads).
    pub read_only: bool,
    pub schema: fn() -> Value,
    pub run: fn(&Woodshop, &Args) -> Outcome,
}

/// Every tool, in the order clients list them.
pub static TOOLS: &[ToolDef] = &[
    read::GET_CONVENTIONS,
    read::LIST_PROJECTS,
    read::GET_DESIGN,
    read::GET_CUT_LIST,
    read::CHECK_DESIGN,
    read::EXPLAIN_PART,
    read::RENDER_PREVIEW,
    start::START_DESIGN,
    start::START_FROM_TEMPLATE,
    edit::RESIZE_PART,
    edit::MOVE_PART,
    edit::EDIT_PARTS,
    edit::RENAME_PART,
    edit::SET_PART_MATERIAL,
    edit::SET_PART_SPECIES,
    edit::DELETE_PART,
    authoring::ADD_MATERIAL,
    authoring::RENAME_MATERIAL,
    authoring::DELETE_MATERIAL,
    authoring::ADD_PART,
    authoring::ADD_PARTS,
    joinery::ADD_OP,
    joinery::UPDATE_OP,
    joinery::DELETE_OP,
    joinery::ADD_JOINT,
    joinery::DELETE_JOINT,
    joinery::ADD_MOVABLE,
    joinery::UPDATE_MOVABLE,
    joinery::DELETE_MOVABLE,
];

pub fn find(name: &str) -> Option<&'static ToolDef> {
    TOOLS.iter().find(|t| t.name == name)
}

/// Run one tool. An unknown name is an error the agent sees like any other.
pub fn call(woodshop: &Woodshop, name: &str, arguments: &Map<String, Value>) -> Outcome {
    let tool = find(name).ok_or_else(|| format!("There is no \"{name}\" tool."))?;
    (tool.run)(woodshop, &Args::new(arguments))
}

// ---------------------------------------------------------------------------------------------
// Input schema building blocks

pub(crate) fn object(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required })
}

pub(crate) fn integer(description: &str) -> Value {
    json!({ "type": "integer", "description": description })
}

pub(crate) fn number(description: &str) -> Value {
    json!({ "type": "number", "description": description })
}

pub(crate) fn string(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub(crate) fn boolean(description: &str) -> Value {
    json!({ "type": "boolean", "description": description })
}

pub(crate) fn one_of(values: &[&str], description: &str) -> Value {
    json!({ "type": "string", "enum": values, "description": description })
}

pub(crate) fn triple(description: &str) -> Value {
    json!({ "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3, "description": description })
}

pub(crate) fn array(items: Value, description: &str) -> Value {
    json!({ "type": "array", "items": items, "description": description })
}

pub(crate) const PROJECT_ID: &str = "The id of the design (from list_projects).";
pub(crate) const PROVIDE_PROJECT: &str = "Provide the id of the design (see list_projects).";

pub(crate) const SPECIES: &[&str] = &["pine", "oak", "maple", "walnut", "cherry"];
pub(crate) const EDGES: &[&str] = &["l0", "l1", "w0", "w1"];
pub(crate) const JOINT_TYPES: &[&str] = &["dado", "rabbet", "butt", "pocketScrew", "screw", "dowel"];

/// "No part "x" in this design. …" — the not-found message the part tools share.
pub(crate) fn no_part(id: &str) -> String {
    format!("No part \"{id}\" in this design. Call get_design to see its part ids.")
}
