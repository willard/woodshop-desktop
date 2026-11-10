//! Catalog hardware (spec 1.15): browse the catalog, and mount pieces on parts.

use serde_json::{Value, json};
use woodshop_core::hardware::{self, side_extent};
use woodshop_core::spec::Side;

use super::*;
use crate::ctx::{find, ids, map_one, num, push, text, unique_id};

const SIDES: &[&str] = &["front", "back", "l0", "l1", "w0", "w1"];
const SIDE_HELP: &str = "Which side of the part, in its LOCAL frame (§3.1): front (+Z) or back (-Z) face, an l-edge (l0, l1) \
     or an end (w0, w1).";
const X_HELP: &str = "Inches along the side's first axis. Faces and l-edges: along the length from the w0 end. Ends (w0, w1): \
     along the width from the l0 edge. Omit to centre.";
const Y_HELP: &str = "Inches along the side's second axis. Faces: along the width from the l0 edge (as a hole's y). Edges and \
     ends: across the thickness from the back face. Omit to centre.";

pub const LIST_HARDWARE: ToolDef = ToolDef {
    name: "list_hardware",
    description: "Browse the hardware catalog: pulls and knobs, hinges, drawer slides, casters, feet, brackets, \
        shelf hardware, latches, lid stays and handles, hooks. Each item has an id, its real dimensions in inches \
        (`model`), and — for hinges, slides and pulls — the `role` a door or drawer can use it in. Pass `category` \
        or `role` to narrow the list; with neither you get the categories and a count each. Use the ids with \
        add_hardware, and with add_movable / update_movable for a door or drawer's hinge, slide and pull. Read-only.",
    read_only: true,
    schema: || {
        let categories: Vec<&str> = hardware::catalog().categories.iter().map(|c| c.id.as_str()).collect();
        object(
            json!({
                "category": one_of(&categories, "One category to list in full."),
                "role": one_of(&["hinge", "slide", "pull"], "Only items a door or drawer can use in this role."),
            }),
            &[],
        )
    },
    run: |_, args| {
        let catalog = hardware::catalog();
        let categories: Vec<&str> = catalog.categories.iter().map(|c| c.id.as_str()).collect();
        let category = args.opt_enum(
            "category",
            &categories,
            &format!(
                "There is no such category. The categories are: {}.",
                categories.join(", ")
            ),
        )?;
        let role = args.opt_enum(
            "role",
            &["hinge", "slide", "pull"],
            "role must be hinge, slide or pull.",
        )?;
        if category.is_none() && role.is_none() {
            let overview: Vec<Value> = catalog
                .categories
                .iter()
                .map(|c| {
                    json!({
                        "id": c.id,
                        "name": c.name,
                        "items": catalog.items.iter().filter(|i| i.category == c.id).count(),
                    })
                })
                .collect();
            return Ok(json!({
                "categories": overview,
                "next": "Call list_hardware with a `category` (or a `role`: hinge, slide, pull) for the items and their ids.",
            }));
        }
        let items: Vec<Value> = catalog
            .items
            .iter()
            .filter(|i| category.is_none_or(|c| i.category == c))
            .filter(|i| role.is_none_or(|r| json!(i.role) == r))
            .map(|i| json!(i))
            .collect();
        Ok(json!({ "items": items }))
    },
};

fn no_hardware(id: &str) -> String {
    format!("No hardware \"{id}\" in this design. Call get_design to see its `hardware` list.")
}

fn side_of(name: &str) -> Side {
    serde_json::from_value(json!(name)).unwrap_or(Side::Front)
}

/// The range `(x, y)` may take on a side of a part in the draft.
fn extent_of(design: &crate::ctx::Loaded, part_id: &str, side: &str) -> Option<(f64, f64)> {
    let spec = design.spec();
    let part = spec.part(part_id)?;
    let thickness = spec.material(&part.material_id).map(|m| m.thickness).unwrap_or(0.0);
    Some(side_extent(part, thickness, side_of(side)))
}

fn off_side(x: f64, y: f64, extent: (f64, f64), side: &str, part: &str) -> Option<String> {
    (x > extent.0 + 1e-6 || y > extent.1 + 1e-6).then(|| {
        format!(
            "({}, {}) is off the {side} of \"{part}\", which is {} × {} in. Positions are measured from that side's \
             low corner; see get_conventions.",
            num(x),
            num(y),
            num(extent.0),
            num(extent.1)
        )
    })
}

pub const ADD_HARDWARE: ToolDef = ToolDef {
    name: "add_hardware",
    description: "Mount one piece of catalog hardware on a part: a pull on a door front, a caster under a base, a \
        corner brace, a hasp, a lid stay. Give the catalog `item` id (from list_hardware), the part, the `side` it \
        sits on and where on that side. It moves with its part, appears in the 3D view and is counted in the \
        hardware list; it never cuts the part. For the hinge, slides and pull of a door or drawer, set them on the \
        movable instead (add_movable / update_movable) — they are then placed for you. Returns the new hardware id.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "item": string("The catalog id, e.g. \"pull.bar-96mm\" or \"caster.locking-3in\" (see list_hardware)."),
                "part_id": string("The part to mount it on (from get_design)."),
                "side": one_of(SIDES, SIDE_HELP),
                "x": number(X_HELP),
                "y": number(Y_HELP),
                "rot": { "type": "integer", "enum": [0, 90, 180, 270], "description": "Quarter turns about the outward normal. At 0 the piece's long axis runs along the side's first axis." },
            }),
            &["project_id", "item", "part_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let item_id = args.str(
            "item",
            "Provide the catalog id of the hardware to mount (see list_hardware).",
        )?;
        let part_id = args.str("part_id", "Provide the id of the part to mount it on (see get_design).")?;
        let side = args
            .opt_enum("side", SIDES, "side must be one of: front, back, l0, l1, w0, w1.")?
            .unwrap_or("front");
        let rot = args.opt_int("rot")?.unwrap_or(0);
        if ![0, 90, 180, 270].contains(&rot) {
            return Err("rot must be 0, 90, 180 or 270.".into());
        }
        let item = hardware::find(item_id)
            .ok_or_else(|| format!("No \"{item_id}\" in the hardware catalog. Call list_hardware to see the ids."))?;
        if !item.placeable {
            return Err(format!(
                "{} belong to a drawer, not a part. Declare the drawer with add_movable and pass this id as its `slide`.",
                item.name
            ));
        }
        let design = w.load_editable(project_id)?;
        let part_name = find(&design.draft, "parts", part_id)
            .map(|p| text(p, "name").to_owned())
            .ok_or_else(|| no_part(part_id))?;
        let extent = extent_of(&design, part_id, side).unwrap_or((240.0, 240.0));
        let x = args.opt_num("x", 0.0, 240.0)?.unwrap_or(extent.0 / 2.0);
        let y = args.opt_num("y", 0.0, 240.0)?.unwrap_or(extent.1 / 2.0);
        if let Some(problem) = off_side(x, y, extent, side, &part_name) {
            return Err(problem);
        }
        let id = unique_id(&ids(&design.draft, "hardware"), "hw_", item_id);
        let mut mount = json!({ "id": id, "item": item_id, "partId": part_id, "side": side, "x": x, "y": y });
        if rot != 0 {
            mount["rot"] = rot.into();
        }
        let result = w.apply(&design, &format!("Add {}", item.name), false, |spec| {
            push(spec, "hardware", mount)
        });
        w.render(
            result,
            &design,
            &format!(
                "Mounted {} on the {side} of \"{part_name}\" at ({}, {}), id \"{id}\".",
                item.name,
                num(x),
                num(y)
            ),
        )
    },
};

pub const UPDATE_HARDWARE: ToolDef = ToolDef {
    name: "update_hardware",
    description: "Move, turn or swap one mounted piece of hardware: a new position, side, quarter-turn, or a \
        different catalog item in the same place. Pass only what changes. Changing `side` without a position \
        centres it on the new side.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "hardware_id": string("The id of the mounted piece (from get_design's `hardware` list)."),
                "item": string("Swap it for this catalog item."),
                "side": one_of(SIDES, SIDE_HELP),
                "x": number(X_HELP),
                "y": number(Y_HELP),
                "rot": { "type": "integer", "enum": [0, 90, 180, 270], "description": "Quarter turns about the outward normal." },
            }),
            &["project_id", "hardware_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let hardware_id = args.str(
            "hardware_id",
            "Provide the id of the hardware to change (see get_design).",
        )?;
        let item = args.opt_str("item")?;
        let side = args.opt_enum("side", SIDES, "side must be one of: front, back, l0, l1, w0, w1.")?;
        let x = args.opt_num("x", 0.0, 240.0)?;
        let y = args.opt_num("y", 0.0, 240.0)?;
        let rot = args.opt_int("rot")?;
        if rot.is_some_and(|r| ![0, 90, 180, 270].contains(&r)) {
            return Err("rot must be 0, 90, 180 or 270.".into());
        }
        if item.is_none() && side.is_none() && x.is_none() && y.is_none() && rot.is_none() {
            return Err("Provide what to change: item, side, x, y or rot.".into());
        }
        if let Some(id) = item {
            let found = hardware::find(id)
                .ok_or_else(|| format!("No \"{id}\" in the hardware catalog. Call list_hardware."))?;
            if !found.placeable {
                return Err(format!("{} belong to a drawer, not a part.", found.name));
            }
        }
        let design = w.load_editable(project_id)?;
        let current = find(&design.draft, "hardware", hardware_id)
            .ok_or_else(|| no_hardware(hardware_id))?
            .clone();
        let part_id = text(&current, "partId").to_owned();
        let next_side = side.unwrap_or(text(&current, "side"));
        let extent = extent_of(&design, &part_id, next_side).unwrap_or((240.0, 240.0));
        // A new side has a new size: without a position, start from its centre.
        let moved = side.is_some_and(|s| s != text(&current, "side"));
        let next_x = x.unwrap_or(if moved {
            extent.0 / 2.0
        } else {
            current["x"].as_f64().unwrap_or(0.0)
        });
        let next_y = y.unwrap_or(if moved {
            extent.1 / 2.0
        } else {
            current["y"].as_f64().unwrap_or(0.0)
        });
        let part_name = find(&design.draft, "parts", &part_id)
            .map(|p| text(p, "name"))
            .unwrap_or(&part_id)
            .to_owned();
        if let Some(problem) = off_side(next_x, next_y, extent, next_side, &part_name) {
            return Err(problem);
        }
        let result = w.apply(&design, "Edit hardware", false, |spec| {
            map_one(spec, "hardware", hardware_id, |h| {
                h.insert("side".into(), next_side.into());
                h.insert("x".into(), next_x.into());
                h.insert("y".into(), next_y.into());
                if let Some(item) = item {
                    h.insert("item".into(), item.into());
                }
                if let Some(rot) = rot {
                    h.insert("rot".into(), rot.into());
                }
            });
        });
        w.render(
            result,
            &design,
            &format!(
                "Updated \"{hardware_id}\": on the {next_side} of \"{part_name}\" at ({}, {}).",
                num(next_x),
                num(next_y)
            ),
        )
    },
};

pub const DELETE_HARDWARE: ToolDef = ToolDef {
    name: "delete_hardware",
    description: "Remove one mounted piece of hardware by its id. The part is untouched.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "hardware_id": string("The id of the mounted piece (from get_design's `hardware` list)."),
            }),
            &["project_id", "hardware_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let hardware_id = args.str(
            "hardware_id",
            "Provide the id of the hardware to remove (see get_design).",
        )?;
        let design = w.load_editable(project_id)?;
        let current = find(&design.draft, "hardware", hardware_id).ok_or_else(|| no_hardware(hardware_id))?;
        let name = hardware::find(text(current, "item"))
            .map(|i| i.name.clone())
            .unwrap_or_else(|| text(current, "item").to_owned());
        let result = w.apply(&design, "Remove hardware", false, |spec| {
            if let Some(list) = spec["hardware"].as_array_mut() {
                list.retain(|h| h["id"] != hardware_id);
            }
        });
        w.render(result, &design, &format!("Removed {name} (\"{hardware_id}\")."))
    },
};

/// A movable's `hinge` / `slide` / `pull` argument, checked against the catalog. `Ok(None)` when
/// not given. `"none"` is allowed for a pull only.
pub(super) fn fitting<'a>(args: &Args<'a>, key: &str, role: hardware::Role) -> Result<Option<&'a str>, String> {
    let Some(id) = args.opt_str(key)? else { return Ok(None) };
    if id == "none" && role == hardware::Role::Pull {
        return Ok(Some(id));
    }
    match hardware::find(id) {
        Some(item) if item.role == Some(role) => Ok(Some(id)),
        Some(item) => Err(format!(
            "{} is not a {key}. Call list_hardware with role \"{key}\" for the ones that are.",
            item.name
        )),
        None => Err(format!(
            "No \"{id}\" in the hardware catalog. Call list_hardware with role \"{key}\"."
        )),
    }
}
