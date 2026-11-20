//! Starting a design: blank, or from a built-in template.

use serde_json::{Map, Value, json};
use woodshop_core::spec::{self, Spec, starter};
use woodshop_core::{quickbuild, templates};
use woodshop_store::{Author, Project};

use super::*;

/// Create a project seeded with `spec` and record it as the first version, so the design is
/// immediately readable and authorable by the other tools.
fn seed(w: &Woodshop, name: &str, spec: &Spec, label: &str) -> Result<Project, String> {
    let store = w.store();
    let project = store.create_project(name, spec).map_err(|e| e.to_string())?;
    store
        .create_version(project.id, spec, Some(label), Author::Mcp)
        .map_err(|e| e.to_string())?;
    Ok(project)
}

pub const START_DESIGN: ToolDef = ToolDef {
    name: "start_design",
    description: "Create a NEW empty Woodshop design to author yourself. Seeds a project with a single \
        base board on a sheet material; build it out with add_material / add_part / add_op / add_joint \
        and reshape or remove the base with the edit tools. Returns the new design id and its starter \
        spec. Instant. Call get_conventions first if you have not already — it is the contract this \
        design gets validated against.",
    read_only: false,
    schema: || {
        object(
            json!({
                "name": string("Optional name for the new design."),
                "material_type": one_of(&["sheet", "lumber", "round"], "Optional starter material type: sheet, lumber, or round."),
                "material_name": string("Optional starter material display name (e.g. \"Cedar 2x4\")."),
                "thickness": number("Optional starter thickness (e.g. 1.5 for a 2x)."),
                "stock_width": number("Optional board width for lumber (e.g. 3.5 for a 2x4)."),
                "diameter": number("Optional diameter for round stock."),
                "species": one_of(SPECIES, "Optional wood species."),
            }),
            &[],
        )
    },
    run: start_design,
};

fn start_design(w: &Woodshop, args: &Args) -> Outcome {
    let name = args
        .opt_str_max("name", 120)?
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Untitled design");
    let mut options = Map::new();
    let mut put = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            options.insert(key.to_owned(), value);
        }
    };
    put(
        "material_type",
        args.opt_enum("material_type", &["sheet", "lumber", "round"], "")?
            .map(Value::from),
    );
    put("material_name", args.opt_str_max("material_name", 80)?.map(Value::from));
    put("thickness", args.opt_num("thickness", 0.01, 240.0)?.map(Value::from));
    put(
        "stock_width",
        args.opt_num("stock_width", 0.01, 240.0)?.map(Value::from),
    );
    put("diameter", args.opt_num("diameter", 0.01, 240.0)?.map(Value::from));
    put("species", args.opt_enum("species", SPECIES, "")?.map(Value::from));
    let options: starter::StarterOptions = serde_json::from_value(Value::Object(options)).map_err(|e| e.to_string())?;

    let spec = starter::minimal(name, &options);
    let project = seed(w, name, &spec, "Started blank")?;
    let on = spec
        .materials
        .first()
        .map(|m| format!(" on {}", m.name))
        .unwrap_or_default();
    Ok(json!({
        "projectId": project.id,
        "name": project.name,
        "summary": format!(
            "Started a blank design with one base board{on}. Author it with add_part / add_material, or \
             replace parts with add_parts."
        ),
        "spec": spec::to_value(&spec),
    }))
}

pub const START_FROM_TEMPLATE: ToolDef = ToolDef {
    name: "start_from_template",
    description: "Start a NEW Woodshop design from a built-in template (side table, bookshelf, workbench, \
        …). Call with no arguments to list the available templates; pass a template id to create a \
        project from it, then reshape it with the edit and authoring tools. Returns the new design id. \
        Instant.",
    read_only: false,
    schema: || {
        object(
            json!({ "template": string(
                "Template id to start from (e.g. \"side-table\"). Omit to list the available templates."
            ) }),
            &[],
        )
    },
    run: start_from_template,
};

fn start_from_template(w: &Woodshop, args: &Args) -> Outcome {
    // No id → discovery: hand back the catalogue so the agent can choose.
    let Some(id) = args.opt_str_max("template", 80)?.filter(|id| !id.is_empty()) else {
        return Ok(json!({
            "templates": templates::all(),
            "hint": "Call start_from_template again with one of these ids as \"template\". To study a \
                     template's geometry without creating a project, read the resource \
                     woodshop://templates/{id} (e.g. woodshop://templates/picnic-table).",
        }));
    };
    let spec = templates::find(id).ok_or_else(|| {
        let ids: Vec<&str> = templates::all().iter().map(|t| t.id).collect();
        format!("No template \"{id}\". Available: {}.", ids.join(", "))
    })?;
    let project = seed(w, &spec.name, &spec, "From template")?;
    Ok(json!({
        "projectId": project.id,
        "name": spec.name,
        "template": id,
        "partCount": spec.parts.len(),
        "summary": format!(
            "Created \"{}\" from the {id} template. Reshape it with the edit and authoring tools.",
            spec.name
        ),
    }))
}

pub const QUICK_BUILD: ToolDef = ToolDef {
    name: "quick_build",
    description: "Create a NEW design from a few sizes: a shelf unit (plywood, evenly spaced shelves, \
        with or without a back), a box (plywood, open top), a table (plywood top on 2x2 legs, with or \
        without a 1x3 apron) or a frame (an open 2x4 stand). Every part is placed, joined and fastened \
        so it passes check_design; change it from there with the edit tools. Sizes are the finished \
        outside dimensions in inches, 8 to 96. A size that would need a panel bigger than a 96 x 48 \
        sheet is refused with which panel and what to change. Returns the new design id.",
    read_only: false,
    schema: || {
        object(
            json!({
                "kind": one_of(&["shelfUnit", "box", "table", "frame"], "What to build."),
                "name": string("Optional name for the new design."),
                "width": number("Outside width, inches."),
                "height": number("Outside height, inches."),
                "depth": number("Outside depth, inches."),
                "shelves": integer("Shelf unit only: shelves between the top and bottom (0 to 12)."),
                "back": boolean("Shelf unit only: a plywood back inside the case."),
                "apron": boolean("Table only: a 1x3 apron frame under the top."),
            }),
            &["kind", "width", "height", "depth"],
        )
    },
    run: |w, args| {
        let kind = args.enumerated(
            "kind",
            &["shelfUnit", "box", "table", "frame"],
            "kind must be shelfUnit, box, table or frame.",
            "",
        )?;
        let (width, height, depth) = (
            args.num("width", 0.01, 240.0, "")?,
            args.num("height", 0.01, 240.0, "")?,
            args.num("depth", 0.01, 240.0, "")?,
        );
        let mut input = json!({ "kind": kind, "width": width, "height": height, "depth": depth });
        match kind {
            "shelfUnit" => {
                input["shelves"] = args.opt_int_in("shelves", 0, 12)?.unwrap_or(2).into();
                input["back"] = args.opt_bool("back")?.unwrap_or(true).into();
            }
            "table" => input["apron"] = args.opt_bool("apron")?.unwrap_or(true).into(),
            _ => {}
        }
        let build: quickbuild::QuickBuild = serde_json::from_value(input).map_err(|e| e.to_string())?;
        let default_name = match kind {
            "shelfUnit" => "Shelf unit",
            "box" => "Box",
            "table" => "Table",
            _ => "Frame",
        };
        let name = args
            .opt_str_max("name", 120)?
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .unwrap_or(default_name);
        let spec = build.build(name)?;
        let project = seed(w, name, &spec, "Quick build")?;
        Ok(json!({
            "projectId": project.id,
            "name": name,
            "partCount": spec.parts.len(),
            "summary": format!("Built \"{name}\": {} parts, ready to change.", spec.parts.len()),
        }))
    },
};
