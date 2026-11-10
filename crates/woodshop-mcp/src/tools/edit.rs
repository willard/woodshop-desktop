//! Precise edits to existing parts. These keep the design buildable: each is rejected only if the
//! edit itself would introduce a buildability problem.

use serde_json::{Map, Value, json};

use super::*;
use crate::ctx::{find, ids, map_one, num, plural, text, unique_id};

const POS_SIZE: &str = "pos must be three numbers: [x, y, z] in inches.";
const ROT_SIZE: &str = "rot must be three numbers: [x, y, z] in Euler degrees.";

fn triple_str(v: [f64; 3]) -> String {
    format!("[{}]", v.map(num).join(", "))
}

pub const RESIZE_PART: ToolDef = ToolDef {
    name: "resize_part",
    description: "Resize one part's face — its length and/or width, in decimal inches — in an existing \
        design. Thickness comes from the material and is not changed here. The change is rejected if it \
        would make the design unbuildable (e.g. a part no longer fits its stock).",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part to resize (from get_design)."),
                "length": number("New length in inches (along the grain). Omit to keep the current length."),
                "width": number("New width in inches. Omit to keep the current width."),
            }),
            &["project_id", "part_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "Provide the id of the part to resize (see get_design).")?;
        let length = args.opt_num("length", 0.1, 120.0)?;
        let width = args.opt_num("width", 0.1, 120.0)?;
        if length.is_none() && width.is_none() {
            return Err("Provide a new length, a new width, or both.".into());
        }
        let design = w.load_editable(project_id)?;
        let part = find(&design.draft, "parts", part_id).ok_or_else(|| no_part(part_id))?;
        let name = text(part, "name").to_owned();
        let l = length.unwrap_or_else(|| part["size"]["l"].as_f64().unwrap_or_default());
        let wd = width.unwrap_or_else(|| part["size"]["w"].as_f64().unwrap_or_default());
        let result = w.apply(&design, &format!("Resize {name}"), true, |spec| {
            map_one(spec, "parts", part_id, |p| {
                p.insert("size".into(), json!({ "l": l, "w": wd }));
            });
        });
        w.render(
            result,
            &design,
            &format!("Resized \"{name}\" to {} × {} in.", num(l), num(wd)),
        )
    },
};

pub const MOVE_PART: ToolDef = ToolDef {
    name: "move_part",
    description: "Move or rotate one part: give a new centre position, a new rotation, or both. Position \
        is [x, y, z] in inches with y up; rotation is [x, y, z] intrinsic Euler degrees, in the §3.1 \
        local frame (length = +X, width = +Y, thickness = +Z). Use this instead of deleting and \
        re-adding a part — a delete drops the joints that referenced it, this keeps them. The move is \
        rejected if it would make the design unbuildable (floating the part, or driving it through \
        another), so the design stays sound.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part to move (from get_design)."),
                "pos": triple("New centre position [x, y, z] in inches; y is up. Omit to keep the current position."),
                "rot": triple("New rotation [x, y, z] in Euler degrees. Omit to keep the current rotation."),
            }),
            &["project_id", "part_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "Provide the id of the part to move (see get_design).")?;
        let pos = args.opt_vec3("pos", -240.0, 240.0, POS_SIZE)?;
        let rot = args.opt_vec3("rot", -180.0, 180.0, ROT_SIZE)?;
        if pos.is_none() && rot.is_none() {
            return Err("Provide a new pos, a new rot, or both.".into());
        }
        let design = w.load_editable(project_id)?;
        let name = find(&design.draft, "parts", part_id)
            .map(|p| text(p, "name").to_owned())
            .ok_or_else(|| no_part(part_id))?;
        let result = w.apply(&design, &format!("Move {name}"), true, |spec| {
            map_one(spec, "parts", part_id, |p| set_transform(p, pos, rot));
        });
        let mut moves = Vec::new();
        if let Some(pos) = pos {
            moves.push(format!("to {}", triple_str(pos)));
        }
        if let Some(rot) = rot {
            moves.push(format!("rotated to {}°", triple_str(rot)));
        }
        w.render(result, &design, &format!("Moved \"{name}\" {}.", moves.join(", ")))
    },
};

fn set_transform(part: &mut Map<String, Value>, pos: Option<[f64; 3]>, rot: Option<[f64; 3]>) {
    let transform = part.entry("transform").or_insert_with(|| json!({}));
    if let Some(pos) = pos {
        transform["pos"] = json!(pos);
    }
    if let Some(rot) = rot {
        transform["rot"] = json!(rot);
    }
}

pub const EDIT_PARTS: ToolDef = ToolDef {
    name: "edit_parts",
    description: "Move, rotate, resize, rename or re-material SEVERAL parts in ONE call, validated once \
        at the end. Use this for any re-orientation: move_part and resize_part reject each intermediate \
        state, so flipping a shelf from the bottom of a carcase to the top — which pierces the sides \
        partway through every possible ordering — cannot be done one call at a time. Each edit names a \
        part_id and whatever it changes: pos, rot, size, material_id, name. Edits apply in order; only \
        the final design must be buildable.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "edits": array(
                    object(
                        json!({
                            "part_id": string("Which part to edit (from get_design)."),
                            "pos": triple("New centre position [x, y, z] in inches, y up."),
                            "rot": triple("New rotation [x, y, z] in intrinsic Euler degrees (§3.1 local frame)."),
                            "size": {
                                "type": "object",
                                "properties": {
                                    "length": number("New length in inches (local +X)."),
                                    "width": number("New width in inches (local +Y)."),
                                },
                                "description": "New face size; thickness always comes from the material.",
                            },
                            "material_id": string("Point the part at a different material already in the design."),
                            "name": string("New name (organisational only)."),
                        }),
                        &["part_id"],
                    ),
                    "The edits to apply, in order. Only the design that results is checked for buildability.",
                ),
            }),
            &["project_id", "edits"],
        )
    },
    run: edit_parts,
};

struct PartEdit {
    part_id: String,
    pos: Option<[f64; 3]>,
    rot: Option<[f64; 3]>,
    length: Option<f64>,
    width: Option<f64>,
    material_id: Option<String>,
    name: Option<String>,
}

impl PartEdit {
    fn changes(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.pos.is_some() {
            out.push("pos");
        }
        if self.rot.is_some() {
            out.push("rot");
        }
        if self.material_id.is_some() {
            out.push("material_id");
        }
        if self.name.is_some() {
            out.push("name");
        }
        if self.length.is_some() || self.width.is_some() {
            out.push("size");
        }
        out
    }
}

fn edit_parts(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let edits_required = "Provide `edits`: a list of {part_id, and any of pos, rot, size, material_id, name}.";
    let items = args.objects("edits", 200)?;
    if items.is_empty() {
        return Err(edits_required.into());
    }
    let mut edits = Vec::new();
    for item in &items {
        let (length, width) = match item.opt_object("size")? {
            Some(size) => {
                let size = Args::nested(size, String::new());
                (
                    size.opt_num("length", 0.01, 240.0)?,
                    size.opt_num("width", 0.01, 240.0)?,
                )
            }
            None => (None, None),
        };
        edits.push(PartEdit {
            part_id: item
                .str("part_id", "Every edit needs a part_id (see get_design).")?
                .to_owned(),
            pos: item.opt_vec3("pos", -240.0, 240.0, POS_SIZE)?,
            rot: item.opt_vec3("rot", -180.0, 180.0, ROT_SIZE)?,
            length,
            width,
            material_id: item.opt_str("material_id")?.map(str::to_owned),
            name: item
                .opt_str_max("name", 80)?
                .filter(|n| !n.is_empty())
                .map(str::to_owned),
        });
    }

    let design = w.load_editable(project_id)?;
    let materials = ids(&design.draft, "materials");
    for (index, edit) in edits.iter().enumerate() {
        if find(&design.draft, "parts", &edit.part_id).is_none() {
            return Err(format!(
                "Edit #{index} names part \"{}\", which is not in this design. Call get_design to see its part ids.",
                edit.part_id
            ));
        }
        if let Some(material) = &edit.material_id
            && !materials.contains(material)
        {
            return Err(format!(
                "Edit #{index} names material \"{material}\", which is not in this design. Its materials are: {}.",
                materials.join(", ")
            ));
        }
        if edit.changes().is_empty() {
            return Err(format!(
                "Edit #{index} for \"{}\" changes nothing — give it a pos, rot, size, material_id or name.",
                edit.part_id
            ));
        }
    }

    let label = format!("Edit {} part{}", edits.len(), plural(edits.len()));
    let result = w.apply(&design, &label, true, |spec| {
        for edit in &edits {
            map_one(spec, "parts", &edit.part_id, |p| {
                set_transform(p, edit.pos, edit.rot);
                let size = p.entry("size").or_insert_with(|| json!({}));
                if let Some(l) = edit.length {
                    size["l"] = l.into();
                }
                if let Some(wd) = edit.width {
                    size["w"] = wd.into();
                }
                if let Some(m) = &edit.material_id {
                    p.insert("materialId".into(), m.clone().into());
                }
                if let Some(n) = &edit.name {
                    p.insert("name".into(), n.clone().into());
                }
            });
        }
    });
    let summary: Vec<String> = edits
        .iter()
        .map(|e| format!("\"{}\" ({})", e.part_id, e.changes().join(", ")))
        .collect();
    w.render(result, &design, &format!("Edited {}.", summary.join(", ")))
}

pub const RENAME_PART: ToolDef = ToolDef {
    name: "rename_part",
    description: "Rename one part in an existing design. This is organisational only — it changes no \
        geometry.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part to rename (from get_design)."),
                "name": string("The new name for the part."),
            }),
            &["project_id", "part_id", "name"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "Provide the id of the part to rename (see get_design).")?;
        let name = args
            .str_max("name", 80, "Provide the new name for the part.")?
            .trim()
            .to_owned();
        if name.is_empty() {
            return Err("The new name cannot be empty.".into());
        }
        let design = w.load_editable(project_id)?;
        let was = find(&design.draft, "parts", part_id)
            .map(|p| text(p, "name").to_owned())
            .ok_or_else(|| no_part(part_id))?;
        let result = w.apply(&design, &format!("Rename {was}"), true, |spec| {
            map_one(spec, "parts", part_id, |p| {
                p.insert("name".into(), name.clone().into());
            });
        });
        w.render(result, &design, &format!("Renamed \"{was}\" to \"{name}\"."))
    },
};

pub const SET_PART_MATERIAL: ToolDef = ToolDef {
    name: "set_part_material",
    description: "Point a part at a different material that already exists in the design (by material \
        id — see the design's `materials` list via get_design). The part's thickness follows the new \
        material. Rejected if it would make the design unbuildable.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part (from get_design)."),
                "material_id": string("The id of an existing material in the design (from get_design)."),
            }),
            &["project_id", "part_id", "material_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "Provide the id of the part (see get_design).")?;
        let material_id = args.str(
            "material_id",
            "Provide the id of an existing material in the design (see get_design).",
        )?;
        let design = w.load_editable(project_id)?;
        let name = find(&design.draft, "parts", part_id)
            .map(|p| text(p, "name").to_owned())
            .ok_or_else(|| no_part(part_id))?;
        let materials = ids(&design.draft, "materials");
        if !materials.iter().any(|m| m == material_id) {
            return Err(format!(
                "No material \"{material_id}\" in this design. Available materials: {}.",
                materials.join(", ")
            ));
        }
        let result = w.apply(&design, &format!("Re-material {name}"), true, |spec| {
            map_one(spec, "parts", part_id, |p| {
                p.insert("materialId".into(), material_id.into());
            });
        });
        w.render(
            result,
            &design,
            &format!("Set \"{name}\" to material \"{material_id}\"."),
        )
    },
};

pub const SET_PART_SPECIES: ToolDef = ToolDef {
    name: "set_part_species",
    description: "Change a part's wood species (pine, oak, maple, walnut, cherry). Reuses a material with \
        the same stock and that species if one exists, otherwise clones the part's current material \
        into a new one of that species — so \"make the legs walnut\" just works.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part (from get_design)."),
                "species": one_of(SPECIES, "The wood species to use."),
            }),
            &["project_id", "part_id", "species"],
        )
    },
    run: set_part_species,
};

fn species_label(species: &str) -> String {
    let mut c = species.chars();
    c.next()
        .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
        .unwrap_or_default()
}

/// Same stock, whatever the species: type, thickness, grain, sheet size, board width and lengths.
fn same_stock(a: &Value, b: &Value) -> bool {
    let grain = |m: &Value| m["grain"].as_bool().unwrap_or(true);
    ["type", "thickness", "sheetSize", "stockWidth", "stockLengths"]
        .iter()
        .all(|k| a[k] == b[k])
        && grain(a) == grain(b)
}

fn set_part_species(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let part_id = args.str("part_id", "")?;
    let species = args.enumerated(
        "species",
        SPECIES,
        "Species must be one of: pine, oak, maple, walnut, cherry.",
        "",
    )?;
    let design = w.load_editable(project_id)?;
    let part = find(&design.draft, "parts", part_id).ok_or_else(|| no_part(part_id))?;
    let name = text(part, "name").to_owned();
    let current = find(&design.draft, "materials", text(part, "materialId"))
        .cloned()
        .ok_or_else(|| format!("Part \"{part_id}\" has no resolvable material."))?;
    if current["species"] == species {
        return Err(format!("\"{name}\" is already {species}."));
    }

    let result = w.apply(&design, &format!("Set {name} to {species}"), true, |spec| {
        let existing = spec["materials"]
            .as_array()
            .and_then(|ms| ms.iter().find(|m| m["species"] == species && same_stock(m, &current)))
            .map(|m| text(m, "id").to_owned());
        let target = existing.unwrap_or_else(|| {
            let current_name = text(&current, "name");
            let base_name = ["Pine", "Oak", "Maple", "Walnut", "Cherry"]
                .iter()
                .find_map(|s| current_name.strip_prefix(&format!("{s} — ")))
                .unwrap_or(current_name);
            let id = unique_id(&ids(spec, "materials"), "mat_", &format!("{species}_{base_name}"));
            let mut material = current.clone();
            material["id"] = id.clone().into();
            material["species"] = species.into();
            material["name"] = format!("{} — {base_name}", species_label(species))
                .chars()
                .take(80)
                .collect::<String>()
                .into();
            crate::ctx::push(spec, "materials", material);
            id
        });
        map_one(spec, "parts", part_id, |p| {
            p.insert("materialId".into(), target.into());
        });
    });
    w.render(result, &design, &format!("Set \"{name}\" to {species}."))
}

pub const DELETE_PART: ToolDef = ToolDef {
    name: "delete_part",
    description: "Remove a part from an existing design. Any joints that referenced it are dropped, and \
        groups are pruned (a group left with fewer than two members dissolves). Rejected if it would \
        leave the design unbuildable (e.g. removing the last part).",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part to delete (from get_design)."),
            }),
            &["project_id", "part_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "Provide the id of the part to delete (see get_design).")?;
        let design = w.load_editable(project_id)?;
        let name = find(&design.draft, "parts", part_id)
            .map(|p| text(p, "name").to_owned())
            .ok_or_else(|| no_part(part_id))?;
        let result = w.apply(&design, &format!("Delete {name}"), true, |spec| {
            remove_part(spec, part_id)
        });
        w.render(result, &design, &format!("Deleted \"{name}\"."))
    },
};

/// Remove a part and everything that only made sense with it: joints naming it, its place in
/// groups (dissolving a group left with one member), and its place in a movable (dissolving the
/// movable when it was the anchor).
fn remove_part(spec: &mut Value, part_id: &str) {
    let has = |list: &Value| list.as_array().is_some_and(|ids| ids.iter().any(|id| id == part_id));
    let without = |list: &Value| -> Vec<Value> {
        list.as_array()
            .into_iter()
            .flatten()
            .filter(|id| *id != part_id)
            .cloned()
            .collect()
    };
    if let Some(parts) = spec["parts"].as_array_mut() {
        parts.retain(|p| p["id"] != part_id);
    }
    if let Some(joints) = spec["joints"].as_array_mut() {
        joints.retain(|j| j["hostPartId"] != part_id && j["insertPartId"] != part_id);
    }
    if let Some(groups) = spec["groups"].as_array_mut() {
        groups.retain_mut(|g| {
            if !has(&g["partIds"]) {
                return true;
            }
            let remaining = without(&g["partIds"]);
            let keep = remaining.len() >= 2;
            g["partIds"] = remaining.into();
            keep
        });
    }
    if let Some(movables) = spec["movables"].as_array_mut() {
        movables.retain_mut(|m| {
            if !has(&m["partIds"]) {
                return true;
            }
            let anchor = if m["kind"] == "door" {
                &m["panelPartId"]
            } else {
                &m["frontPartId"]
            };
            if anchor == part_id {
                return false;
            }
            m["partIds"] = without(&m["partIds"]).into();
            true
        });
    }
}
