//! The MCP transport: an rmcp `ServerHandler` that lists the registry and hands each call to it.

use std::sync::Arc;

use rmcp::handler::server::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation, InitializeResult,
    ListResourceTemplatesResult, ListResourcesResult, ListToolsResult, PaginatedRequestParams,
    ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, ResourceTemplate,
    ServerCapabilities, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer};
use serde_json::Map;

use crate::ctx::Woodshop;
use crate::resources::{self, CONVENTIONS_RESOURCE, ResourceDef, SCHEMA_RESOURCE, TEMPLATE_RESOURCE};
use crate::tools::{self, TOOLS};

const INSTRUCTIONS: &str = "Woodshop designs woodworking furniture in 3D. Each design is a parametric \
spec — a JSON document of parts and joinery in decimal inches — that Woodshop renders and turns into \
cut lists. This server works on the designs in the Woodshop library on this computer; changes show up \
in the Woodshop app as you make them.

CALL get_conventions FIRST. It returns the contract your designs are judged against — the coordinate \
and op contract (§3.1): the local part frame, the rot recipes saying which world axis a part's length \
and width land on, the datum every op measures from, and the connectivity/fastening/material rules \
the buildability linter enforces — plus the exact signature of every op type. Pass `op` (e.g. \
{\"op\":\"curve\"}) for one op in full: every variant, its required and optional fields, and their \
allowed values. Reading it once at the start of a session is the single biggest thing you can do to \
stop edits being rejected; guessing at op shapes against the validator is the single biggest way to \
waste calls.

The same material is published as resources, if your client surfaces those:
  · woodshop://spec/conventions — the §3.1 contract, identical to get_conventions.
  · woodshop://spec/schema — the canonical JSON Schema: exact field names, enums, op variants.
  · woodshop://templates/{id} — any built-in template's full spec (e.g. woodshop://templates/picnic-table), \
as a worked example of how a real design places, rotates and fastens its parts. Reading one does not \
create a project.

Every tool is deterministic, instant and works offline. You describe the design as parts, materials, \
and joinery; Woodshop validates it (schema + a buildability linter) and stores it. You never emit raw \
geometry — only the parametric spec. Every change is kept as a restore point in the design's version \
history, so the person at the app can always step back.

Reading: list_projects shows the designs and their ids; get_design returns one design's full spec \
(parts, materials, joints); get_cut_list returns the full cut list — parts, board feet, sheet layout, \
lumber, and cost; check_design reports whether a design is buildable, what the linter objects to, and \
the assembled overall width x depth x height to check against your plan — without changing anything.

Starting a design: start_design creates a blank piece (one base board) for you to author; \
start_from_template creates one from a built-in template (call it with no arguments to list the \
templates).

Authoring: add_parts lands SEVERAL parts — each with its ops — plus the joints between them in ONE \
call, and is what you should reach for whenever you know more than one part up front; add_material, \
add_part, add_op (dado/hole/…) and add_joint do the same thing one piece at a time; update_op replaces \
one op IN PLACE — use it rather than delete_op + add_op, which drops any joint that pointed at the op. \
You place geometry yourself in the §3.1 local frame (length = +X, width = +Y, thickness = +Z; y is up \
in the world). These accept transiently unbuildable states — a part not yet touching another comes \
back with an advisory naming what to connect — so read get_design first and place parts against real \
neighbours.

Seeing what you built: explain_part reports a part's world bounding box, WHICH WORLD AXIS its local \
length/width/thickness land on after rotation, and the world box each op occupies — the check you \
would otherwise need a rendered screenshot for. render_preview draws a part full-size as an SVG shop \
template — the outline you would cut, with holes and channels marked — so you can see whether a cradle \
is deep enough to hold anything before a human does. get_cut_list adds the ops that shape each part and \
the stock to buy.

Hardware: list_hardware browses a catalog of real hardware with true dimensions. A door's hinge and \
pull and a drawer's slides and pull are set on the movable (add_movable / update_movable) and placed \
for you; anything else — a pull on a fixed panel, casters, corner braces, a hasp, a lid stay — is \
mounted on a side of a part with add_hardware, and moved or removed with update_hardware and \
delete_hardware. Hardware is counted in the hardware list; it never cuts the part.

Precise edits: edit_parts changes SEVERAL parts at once (moves, rotations, resizes) and is validated \
only at the end, which is the only way to re-orient an existing design — the single-part tools reject \
each intermediate state. move_part (new position and/or rotation), resize_part, rename_part, \
set_part_material, set_part_species, and delete_part change one part by id; rename_material and \
delete_material keep the material list clean (a material in use cannot be deleted); they keep the \
design buildable and are rejected only if the edit itself would break it. When a run of authoring \
calls is done, call check_design to confirm the piece actually holds together.";

#[derive(Clone)]
pub struct WoodshopServer {
    woodshop: Arc<Woodshop>,
}

impl WoodshopServer {
    pub fn new(woodshop: Woodshop) -> Self {
        Self {
            woodshop: Arc::new(woodshop),
        }
    }
}

fn tool(def: &tools::ToolDef) -> Tool {
    let schema = match (def.schema)() {
        serde_json::Value::Object(map) => map,
        _ => Map::new(),
    };
    let annotations = ToolAnnotations::new().read_only(def.read_only).destructive(false);
    Tool::new(def.name, def.description, Arc::new(schema)).with_annotations(annotations)
}

fn resource(def: &ResourceDef) -> Resource {
    Resource::new(def.uri, def.name)
        .with_title(def.title)
        .with_description(def.description)
        .with_mime_type(def.mime_type)
}

impl ServerHandler for WoodshopServer {
    fn get_info(&self) -> InitializeResult {
        InitializeResult::new(ServerCapabilities::builder().enable_tools().enable_resources().build())
            .with_server_info(Implementation::new("Woodshop", env!("CARGO_PKG_VERSION")).with_title("Woodshop"))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        // One page: a client that doesn't follow the cursor would never see the tail otherwise.
        Ok(ListToolsResult::with_all_items(TOOLS.iter().map(tool).collect()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let woodshop = Arc::clone(&self.woodshop);
        let name = request.name.to_string();
        let arguments = request.arguments.unwrap_or_default();
        // SQLite and the linter are synchronous; keep them off the async executor.
        let outcome = tokio::task::spawn_blocking(move || tools::call(&woodshop, &name, &arguments))
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let result = match outcome {
            Ok(payload) => {
                let text = serde_json::to_string_pretty(&payload).unwrap_or_default();
                CallToolResult::success(vec![ContentBlock::text(text)])
            }
            Err(message) => CallToolResult::error(vec![ContentBlock::text(message)]),
        };
        Ok(result.into())
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(ListResourcesResult::with_all_items(vec![
            resource(&CONVENTIONS_RESOURCE),
            resource(&SCHEMA_RESOURCE),
        ]))
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        let def = &TEMPLATE_RESOURCE;
        let template = ResourceTemplate::new(def.uri, def.name)
            .with_title(def.title)
            .with_description(def.description)
            .with_mime_type(def.mime_type);
        Ok(ListResourceTemplatesResult::with_all_items(vec![template]))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        let (mime_type, text) =
            resources::read(&request.uri).map_err(|message| ErrorData::resource_not_found(message, None))?;
        let contents = ResourceContents::TextResourceContents {
            uri: request.uri,
            mime_type: Some(mime_type.to_owned()),
            text,
            meta: None,
        };
        Ok(ReadResourceResult::new(vec![contents]).into())
    }
}
