//! Authoring: materials and parts. Adding accepts a transiently unbuildable design (a new part
//! floats until it is connected) and says what to fix; renaming and deleting keep it buildable.

use serde_json::{Value, json};

use super::*;
use crate::ctx::{compact, find, ids, map_one, plural, push, text, unique_id};

pub const ADD_MATERIAL: ToolDef = ToolDef {
    name: "add_material",
    description: "Add a material to an existing design so parts can reference it. Use `sheet` \
        (plywood/MDF, needs sheet_length + sheet_width) for wide panels, `lumber` (needs stock_width) \
        for legs and framing, or `round` for dowel rod — for round stock the diameter IS the thickness, \
        so pass the diameter as `thickness` (a 3/4\" dowel = 0.75). All dimensions in decimal inches. \
        Returns the new material id.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "type": one_of(&["sheet", "lumber", "round"], "sheet = plywood/MDF panel stock; lumber = solid dimensional stock; round = dowel rod."),
                "name": string("Display name, e.g. \"Birch Plywood 3/4\\\"\" or \"Oak 1x4\"."),
                "thickness": number("Actual thickness in inches (a 3/4\" panel = 0.75; a \"2x\" is 1.5). For round stock this is the DIAMETER."),
                "diameter": number("Round stock only, and optional: an alias for thickness. Pass one or the other, not two different values."),
                "sheet_length": number("Sheet length in inches (sheet only, e.g. 96)."),
                "sheet_width": number("Sheet width in inches (sheet only, e.g. 48)."),
                "stock_width": number("Board width in inches (lumber only; a 2x4 is 3.5)."),
                "stock_lengths": array(json!({ "type": "number" }), "Available stock lengths in inches (lumber or round); defaults to [96] for lumber, [36] for round."),
                "species": one_of(SPECIES, "Optional wood species."),
                "cost": number("Optional: cost per sheet (sheet) or per board foot (lumber)."),
            }),
            &["project_id", "type", "name", "thickness"],
        )
    },
    run: add_material,
};

fn add_material(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let kind = args.enumerated(
        "type",
        &["sheet", "lumber", "round"],
        "Material type must be \"sheet\", \"lumber\", or \"round\" (dowel rod).",
        "",
    )?;
    let name = args.str_max("name", 80, "")?;
    let mut thickness = args.num("thickness", 0.01, 240.0, "")?;
    let diameter = args.opt_num("diameter", 0.01, 240.0)?;
    let sheet_length = args.opt_num("sheet_length", 0.01, 240.0)?;
    let sheet_width = args.opt_num("sheet_width", 0.01, 240.0)?;
    let stock_width = args.opt_num("stock_width", 0.01, 240.0)?;
    let stock_lengths = args.opt_nums("stock_lengths", 8, 0.01, 240.0)?;
    let species = args.opt_enum("species", SPECIES, "")?;
    let cost = args.opt_num("cost", 0.0, f64::MAX)?;

    match kind {
        "sheet" if sheet_length.is_none() || sheet_width.is_none() => {
            return Err("A sheet material needs both sheet_length and sheet_width (e.g. 96 x 48).".into());
        }
        "lumber" if stock_width.is_none() => {
            return Err("A lumber material needs stock_width (e.g. 3.5 for a 2x4).".into());
        }
        "round" => {
            if let Some(d) = diameter {
                if (d - thickness).abs() > 1e-6 {
                    return Err(
                        "For round stock the diameter IS the thickness, so pass one of them (or the same \
                                value twice)."
                            .into(),
                    );
                }
                thickness = d;
            }
        }
        _ => {}
    }

    let design = w.load_editable(project_id)?;
    let id = unique_id(&ids(&design.draft, "materials"), "mat_", name);
    let mut material = compact(json!({
        "id": id,
        "type": kind,
        "name": name,
        "thickness": thickness,
        "grain": true,
        "species": species,
    }));
    match kind {
        "sheet" => {
            material["sheetSize"] = json!({ "l": sheet_length, "w": sheet_width });
            if let Some(cost) = cost {
                material["costPerSheet"] = cost.into();
            }
        }
        _ => {
            if kind == "lumber" {
                material["stockWidth"] = stock_width.into();
            }
            let default = if kind == "round" { 36.0 } else { 96.0 };
            material["stockLengths"] = json!(stock_lengths.unwrap_or_else(|| vec![default]));
            if let Some(cost) = cost {
                material["costPerBoardFoot"] = cost.into();
            }
        }
    }
    let result = w.apply(&design, &format!("Add material {name}"), false, |spec| {
        push(spec, "materials", material)
    });
    w.render(result, &design, &format!("Added material \"{name}\" (id: {id})."))
}

fn no_material(id: &str) -> String {
    format!("No material \"{id}\" in this design. Call get_design to see its material ids.")
}

pub const RENAME_MATERIAL: ToolDef = ToolDef {
    name: "rename_material",
    description: "Rename a material in a design. The name is what the cut list prints — \"Black melamine \
        MDF, 3/4 in\" — so this is how you fix a typo made when the material was added. The material id \
        stays the same, so every part keeps its material.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "material_id": string("The id of the material to rename (from get_design)."),
                "name": string("The new display name, e.g. \"Cedar 1x6 (0.75 x 5.5 actual)\"."),
            }),
            &["project_id", "material_id", "name"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let material_id = args.str(
            "material_id",
            "Provide the id of the material to rename (see get_design).",
        )?;
        let name = args.str_max("name", 80, "Provide the new material name.")?;
        let design = w.load_editable(project_id)?;
        let material = find(&design.draft, "materials", material_id).ok_or_else(|| no_material(material_id))?;
        let was = material["name"].as_str().unwrap_or(material_id).to_owned();
        let result = w.apply(&design, &format!("Rename material {was}"), true, |spec| {
            map_one(spec, "materials", material_id, |m| {
                m.insert("name".into(), name.into());
            });
        });
        w.render(result, &design, &format!("Renamed material \"{was}\" to \"{name}\"."))
    },
};

pub const DELETE_MATERIAL: ToolDef = ToolDef {
    name: "delete_material",
    description: "Remove a material from a design. Use it to clear one added by mistake. Refused while \
        any part still uses it: the response names those parts so you can move them to another material \
        with set_part_material first. A design must keep at least one material.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "material_id": string("The id of the material to delete (from get_design)."),
            }),
            &["project_id", "material_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let material_id = args.str(
            "material_id",
            "Provide the id of the material to delete (see get_design).",
        )?;
        let design = w.load_editable(project_id)?;
        let material = find(&design.draft, "materials", material_id).ok_or_else(|| no_material(material_id))?;
        let name = text(material, "name").to_owned();
        let users: Vec<&str> = design.draft["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| p["materialId"] == material_id)
            .map(|p| p["name"].as_str().unwrap_or_else(|| text(p, "id")))
            .collect();
        if !users.is_empty() {
            let shown = users.iter().take(5).copied().collect::<Vec<_>>().join(", ");
            let rest = if users.len() > 5 {
                format!(" and {} more", users.len() - 5)
            } else {
                String::new()
            };
            return Err(format!(
                "Material \"{name}\" is still used by {} part{}: {shown}{rest}. Move them to another material \
                 with set_part_material, then delete this one.",
                users.len(),
                plural(users.len())
            ));
        }
        if ids(&design.draft, "materials").len() <= 1 {
            return Err(
                "A design needs at least one material. Add the replacement with add_material before \
                        deleting this one."
                    .into(),
            );
        }
        let result = w.apply(&design, &format!("Delete material {name}"), true, |spec| {
            if let Some(ms) = spec["materials"].as_array_mut() {
                ms.retain(|m| m["id"] != material_id);
            }
        });
        w.render(result, &design, &format!("Deleted the unused material \"{name}\"."))
    },
};

// ---------------------------------------------------------------------------------------------
// Parts

fn part_properties() -> Value {
    json!({
        "name": string("Part name, e.g. \"Front Left Leg\"."),
        "material_id": string("An existing material id (from get_design or add_material)."),
        "length": number("Face length in inches (along the grain / local +X)."),
        "width": number("Face width in inches (local +Y). Thickness comes from the material."),
        "pos": triple("Centre position [x, y, z] in inches; y is up."),
        "rot": triple("Optional rotation [x, y, z] in Euler degrees. Default [0,0,0]: length along +X, standing on edge."),
        "grain_axis": one_of(&["l", "w", "none"], "Optional grain direction; defaults to \"l\"."),
        "qty": integer("Optional quantity of identical parts; defaults to 1."),
    })
}

/// A part as the agent described it, validated.
#[derive(Clone)]
struct PartInput {
    id: Option<String>,
    name: String,
    material_id: String,
    length: f64,
    width: f64,
    pos: [f64; 3],
    rot: Option<[f64; 3]>,
    grain_axis: Option<String>,
    qty: Option<i64>,
    ops: Vec<Value>,
    repeat: Option<(i64, [f64; 3])>,
}

fn read_part(a: &Args) -> Result<PartInput, String> {
    Ok(PartInput {
        id: None,
        name: a.str_max("name", 80, "")?.to_owned(),
        material_id: a.str("material_id", "")?.to_owned(),
        length: a.num("length", 0.01, 240.0, "")?,
        width: a.num("width", 0.01, 240.0, "")?,
        pos: a.vec3("pos", -240.0, 240.0, "pos must be three numbers: [x, y, z] in inches.")?,
        rot: a.opt_vec3(
            "rot",
            -180.0,
            180.0,
            "rot must be three numbers: [x, y, z] in Euler degrees.",
        )?,
        grain_axis: a.opt_enum("grain_axis", &["l", "w", "none"], "")?.map(str::to_owned),
        qty: a.opt_int_in("qty", 1, 50)?,
        ops: Vec::new(),
        repeat: None,
    })
}

fn build_part(id: &str, input: &PartInput) -> Value {
    let mut part = json!({
        "id": id,
        "name": input.name,
        "materialId": input.material_id,
        "size": { "l": input.length, "w": input.width },
        "transform": { "pos": input.pos },
    });
    if let Some(rot) = input.rot {
        part["transform"]["rot"] = json!(rot);
    }
    if let Some(axis) = &input.grain_axis {
        part["grainAxis"] = axis.clone().into();
    }
    if let Some(qty) = input.qty {
        part["qty"] = qty.into();
    }
    if !input.ops.is_empty() {
        part["ops"] = json!(input.ops);
    }
    part
}

pub const ADD_PART: ToolDef = ToolDef {
    name: "add_part",
    description: "Add a new part to an existing design. You place it directly: give its face size \
        (length x width; thickness comes from the material), its centre position [x, y, z] in inches (y \
        is up), and optional rotation (Euler degrees). Local frame: length = +X, width = +Y, thickness = \
        +Z. The part must touch another part to be buildable — if it does not yet, the response says so.",
    read_only: false,
    schema: || {
        let mut properties = part_properties();
        properties["project_id"] = integer(PROJECT_ID);
        object(
            properties,
            &["project_id", "name", "material_id", "length", "width", "pos"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let input = read_part(args)?;
        let design = w.load_editable(project_id)?;
        if !ids(&design.draft, "materials").contains(&input.material_id) {
            return Err(format!(
                "No material \"{}\" in this design. Add one with add_material, or see existing materials via \
                 get_design.",
                input.material_id
            ));
        }
        let id = unique_id(&ids(&design.draft, "parts"), "p_", &input.name);
        let part = build_part(&id, &input);
        let result = w.apply(&design, &format!("Add part {}", input.name), false, |spec| {
            push(spec, "parts", part)
        });
        w.render(result, &design, &format!("Added part \"{}\" (id: {id}).", input.name))
    },
};

pub const ADD_PARTS: ToolDef = ToolDef {
    name: "add_parts",
    description: "Add SEVERAL parts — each with its ops — and the joints between them, in ONE call. Use \
        this whenever you know more than one part up front (a carcase, a leg assembly, a whole design): \
        it is the same authoring as add_part/add_op/add_joint but at a fraction of the round trips, and \
        the design is validated once at the end. Give each part an `id` if joints in this same call need \
        to name it; otherwise ids are derived from the names and returned to you. Joints may reference \
        parts created here or parts already in the design. Like add_part, this accepts a transiently \
        unbuildable result — anything still floating or unfastened comes back as an advisory naming \
        what to fix.",
    read_only: false,
    schema: || {
        let mut part = part_properties();
        part["id"] = string(
            "Optional stable id, e.g. \"p_left_leg\". Give one when a joint in this same call names this part; \
             omit to derive it from the name.",
        );
        part["repeat"] = json!({
            "type": "object",
            "properties": {
                "count": integer("Number of parts to generate in the series (e.g. 4 for 4 slats)."),
                "step": triple("Offset vector [dx, dy, dz] between each successive part in inches."),
            },
            "required": ["count", "step"],
            "description": "Optional linear array generator for repeating parts (e.g. seat slats, balusters).",
        });
        part["ops"] = array(
            json!({ "type": "object" }),
            "Optional ops cut into this part — each a `type` plus that type's fields per §3.1, e.g. \
             {\"type\":\"pocketHoles\",\"edge\":\"w1\",\"count\":2}.",
        );
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "replace_parts": boolean("Optional: when true, replaces all existing parts and joints with this batch (e.g. wiping the starter base)."),
                "parts": array(object(part, &["name", "material_id", "length", "width", "pos"]), "The parts to add, in one call."),
                "joints": array(
                    object(
                        json!({
                            "type": one_of(JOINT_TYPES, "The joint type."),
                            "host_part_id": string("The part that carries the op / receives the joint."),
                            "insert_part_id": string("The part it seats into or bites into."),
                            "op_ref": integer("Index of the relevant op in the host part's ops."),
                        }),
                        &["type", "host_part_id", "insert_part_id"],
                    ),
                    "Optional joints to record, naming parts from this call or already in the design.",
                ),
            }),
            &["project_id", "parts"],
        )
    },
    run: add_parts,
};

const JOINT_TYPE_INVALID: &str = "Joint type must be one of: dado, rabbet, butt, pocketScrew, screw, dowel.";

fn is_slug(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && (2..=40).contains(&id.len())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn add_parts(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let replace = args.opt_bool("replace_parts")?.unwrap_or(false);
    let items = args.objects("parts", 40)?;
    if items.is_empty() {
        return Err(
            "Provide a \"parts\" array — one object per part, each with name, material_id, length, \
                    width and pos."
                .into(),
        );
    }
    let mut inputs = Vec::new();
    for item in &items {
        let mut input = read_part(item)?;
        if let Some(id) = item.opt_str("id")? {
            if !is_slug(id) {
                return Err(
                    "A part id must look like \"p_left_leg\": lowercase letters, digits and underscores, \
                            starting with a letter."
                        .into(),
                );
            }
            input.id = Some(id.to_owned());
        }
        if let Some(ops) = item.opt_array("ops", 20)? {
            input.ops = ops.clone();
        }
        if let Some(repeat) = item.opt_object("repeat")? {
            let repeat = Args::nested(repeat, String::new());
            let count = repeat
                .opt_int_in("count", 2, 20)?
                .ok_or("The repeat count field is required.")?;
            let step = repeat
                .opt_vec3(
                    "step",
                    -240.0,
                    240.0,
                    "step must be three numbers: [dx, dy, dz] in inches.",
                )?
                .ok_or("The repeat step field is required.")?;
            input.repeat = Some((count, step));
        }
        inputs.push(input);
    }
    let mut joint_inputs = Vec::new();
    for j in args.objects("joints", 120)? {
        joint_inputs.push((
            j.enumerated("type", JOINT_TYPES, JOINT_TYPE_INVALID, "")?.to_owned(),
            j.str("host_part_id", "")?.to_owned(),
            j.str("insert_part_id", "")?.to_owned(),
            j.opt_int_in("op_ref", 0, i64::MAX)?,
        ));
    }

    let design = w.load_editable(project_id)?;
    let materials = ids(&design.draft, "materials");
    let mut taken = if replace {
        Vec::new()
    } else {
        ids(&design.draft, "parts")
    };
    let mut parts = Vec::new();
    for (index, input) in inputs.iter().enumerate() {
        if !materials.contains(&input.material_id) {
            return Err(format!(
                "Part #{index} (\"{}\") references material \"{}\", which is not in this design. Add it with \
                 add_material first, or see get_design for the existing ids.",
                input.name, input.material_id
            ));
        }
        let (count, step) = input.repeat.unwrap_or((1, [0.0; 3]));
        for k in 1..=count {
            let mut one = input.clone();
            if count > 1 {
                one.name = format!("{} {k}", input.name);
                let n = (k - 1) as f64;
                one.pos = std::array::from_fn(|i| input.pos[i] + n * step[i]);
            }
            let explicit = input
                .id
                .as_ref()
                .map(|id| if count > 1 { format!("{id}_{k}") } else { id.clone() });
            if let Some(id) = &explicit
                && taken.contains(id)
            {
                return Err(format!(
                    "Part id \"{id}\" is already used in this design. Ids must be unique — pick another, or omit \
                     `id` and one will be derived from the name."
                ));
            }
            let id = explicit.unwrap_or_else(|| unique_id(&taken, "p_", &one.name));
            taken.push(id.clone());
            parts.push(build_part(&id, &one));
        }
    }

    let mut joint_ids: Vec<String> = if replace {
        Vec::new()
    } else {
        ids(&design.draft, "joints")
    };
    let mut joints = Vec::new();
    for (index, (kind, host, insert, op_ref)) in joint_inputs.iter().enumerate() {
        for (side, part_id) in [("host_part_id", host), ("insert_part_id", insert)] {
            if !taken.contains(part_id) {
                return Err(format!(
                    "Joint #{index} names part \"{part_id}\" as its {side}, but no such part exists here or in \
                     the design. Give that part an explicit `id` in this call, or check get_design."
                ));
            }
        }
        let id = unique_id(&joint_ids, "j_", &format!("{host}_{insert}"));
        joint_ids.push(id.clone());
        joints.push(compact(json!({
            "id": id,
            "type": kind,
            "hostPartId": host,
            "insertPartId": insert,
            "opRef": op_ref,
        })));
    }

    let count = parts.len();
    let part_ids: Vec<String> = parts.iter().map(|p| text(p, "id").to_owned()).collect();
    let label = format!("{}{count} part{}", if replace { "Set " } else { "Add " }, plural(count));
    let joint_count = joints.len();
    let result = w.apply(&design, &label, false, |spec| {
        if replace {
            spec["parts"] = json!(parts);
            spec["joints"] = json!(joints);
        } else {
            for part in parts {
                push(spec, "parts", part);
            }
            for joint in joints {
                push(spec, "joints", joint);
            }
        }
    });
    let summary = format!(
        "{}{count} part{}{}: {}.",
        if replace { "Replaced design with " } else { "Added " },
        plural(count),
        if joint_count == 0 {
            String::new()
        } else {
            format!(" and {joint_count} joint{}", plural(joint_count))
        },
        part_ids.join(", ")
    );
    w.render(result, &design, &summary)
}
