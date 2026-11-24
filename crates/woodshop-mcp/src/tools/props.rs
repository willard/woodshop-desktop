//! Props (spec 1.22): things shown with the piece but not built, such as the totes on a tote rack.

use serde_json::{Value, json};
use woodshop_core::hardware;

use super::*;
use crate::ctx::{find, ids, map_one, num, push, text, unique_id};

const POS_HELP: &str = "World position [x, y, z] in inches of the middle of its bottom (y is up), in the same \
     frame as the parts. A tote hung by its rim on runners: its bottom sits the catalog's rim height below the \
     runners' tops (see the item's description).";
const ROT_HELP: &str = "Turn about the vertical in degrees, -180 to 180. At 0 its length runs along world X; 90 \
     runs it along world Z (front to back).";
const COLOR_HELP: &str = "Its main colour as #rrggbb (a tote's base). Omit for the catalog colour.";
const ACCENT_HELP: &str = "Its second colour as #rrggbb (a tote's lid). Omit for the catalog colour.";

fn no_prop(id: &str) -> String {
    format!("No prop \"{id}\" in this design. Call get_design to see its `props` list.")
}

fn colour<'a>(args: &Args<'a>, key: &str) -> Result<Option<&'a str>, String> {
    let colour = args.opt_str(key)?;
    match colour {
        Some(c) if !(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())) => {
            Err(format!("{key} must be #rrggbb, e.g. \"#f2c230\"; got \"{c}\"."))
        }
        _ => Ok(colour),
    }
}

fn prop_item(id: &str) -> Result<&'static hardware::Item, String> {
    match hardware::find(id) {
        Some(item) if item.prop => Ok(item),
        Some(item) => Err(format!(
            "{} is hardware, not a prop: mount it on a part with add_hardware. Props are in list_hardware's \
             \"props\" category.",
            item.name
        )),
        None => Err(format!(
            "No \"{id}\" in the catalog. Call list_hardware with category \"props\" for the props."
        )),
    }
}

pub const ADD_PROP: ToolDef = ToolDef {
    name: "add_prop",
    description: "Show something with the piece that is not built: the totes on a tote rack, a saw on its stand. \
        Give a catalog prop `item` (list_hardware, category \"props\") and where it stands in the world. It is \
        drawn in the 3D view and the 3D plan, so a client sees the piece in use, but it is never in the cut list, \
        the hardware list, the cost, the overall size or the design checks. Returns the new prop id.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "item": string("The catalog prop id, e.g. \"prop.tote-hdx-27gal\"."),
                "pos": triple(POS_HELP),
                "rot": number(ROT_HELP),
                "name": string("What to call it, e.g. \"Tote, bay 1 upper\". Omit for the catalog name."),
                "color": string(COLOR_HELP),
                "accent": string(ACCENT_HELP),
            }),
            &["project_id", "item", "pos"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let item_id = args.str(
            "item",
            "Provide the catalog id of the prop (list_hardware, category \"props\").",
        )?;
        let item = prop_item(item_id)?;
        let pos = args.vec3("pos", -240.0, 240.0, "pos must be three numbers: [x, y, z].")?;
        let rot = args.opt_num("rot", -180.0, 180.0)?;
        let name = args.opt_str_max("name", 60)?.map(str::trim).filter(|n| !n.is_empty());
        let color = colour(args, "color")?;
        let accent = colour(args, "accent")?;
        let design = w.load_editable(project_id)?;
        let id = unique_id(&ids(&design.draft, "props"), "pr_", item_id.trim_start_matches("prop."));
        let mut prop = json!({ "id": id, "item": item_id, "pos": pos });
        for (key, value) in [("name", name), ("color", color), ("accent", accent)] {
            if let Some(v) = value {
                prop[key] = v.into();
            }
        }
        if let Some(rot) = rot.filter(|r| *r != 0.0) {
            prop["rot"] = rot.into();
        }
        let label = name.unwrap_or(&item.name).to_owned();
        let result = w.apply(&design, &format!("Add {label}"), false, |spec| {
            push(spec, "props", prop)
        });
        w.render(
            result,
            &design,
            &format!(
                "Placed {label} with its bottom at ({}, {}, {}), id \"{id}\". It is shown, not built.",
                num(pos[0]),
                num(pos[1]),
                num(pos[2])
            ),
        )
    },
};

pub const UPDATE_PROP: ToolDef = ToolDef {
    name: "update_prop",
    description: "Move, turn, rename or recolour one prop, or swap it for another catalog prop in the same place. \
        Pass only what changes; `color` or `accent` \"catalog\" goes back to the catalog colour.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "prop_id": string("The prop's id (from get_design's `props` list)."),
                "item": string("Swap it for this catalog prop."),
                "pos": triple(POS_HELP),
                "rot": number(ROT_HELP),
                "name": string("A new name."),
                "color": string(COLOR_HELP),
                "accent": string(ACCENT_HELP),
            }),
            &["project_id", "prop_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let prop_id = args.str("prop_id", "Provide the id of the prop to change (see get_design).")?;
        let item = args.opt_str("item")?;
        if let Some(id) = item {
            prop_item(id)?;
        }
        let pos = args.opt_vec3("pos", -240.0, 240.0, "pos must be three numbers: [x, y, z].")?;
        let rot = args.opt_num("rot", -180.0, 180.0)?;
        let name = args.opt_str_max("name", 60)?.map(str::trim).filter(|n| !n.is_empty());
        let catalog = |key: &str| args.opt_str(key).ok().flatten() == Some("catalog");
        let (reset_color, reset_accent) = (catalog("color"), catalog("accent"));
        let color = if reset_color { None } else { colour(args, "color")? };
        let accent = if reset_accent { None } else { colour(args, "accent")? };
        if item.is_none()
            && pos.is_none()
            && rot.is_none()
            && name.is_none()
            && color.is_none()
            && accent.is_none()
            && !reset_color
            && !reset_accent
        {
            return Err("Provide what to change: item, pos, rot, name, color or accent.".into());
        }
        let design = w.load_editable(project_id)?;
        let current = find(&design.draft, "props", prop_id).ok_or_else(|| no_prop(prop_id))?;
        let label = current["name"]
            .as_str()
            .or_else(|| hardware::find(text(current, "item")).map(|i| i.name.as_str()))
            .unwrap_or(prop_id)
            .to_owned();
        let result = w.apply(&design, "Edit prop", false, |spec| {
            map_one(spec, "props", prop_id, |p| {
                if let Some(item) = item {
                    p.insert("item".into(), item.into());
                }
                if let Some(pos) = pos {
                    p.insert("pos".into(), json!(pos));
                }
                match rot {
                    Some(0.0) => {
                        p.remove("rot");
                    }
                    Some(r) => {
                        p.insert("rot".into(), r.into());
                    }
                    None => {}
                }
                if let Some(name) = name {
                    p.insert("name".into(), name.into());
                }
                for (key, value, reset) in [("color", color, reset_color), ("accent", accent, reset_accent)] {
                    if reset {
                        p.remove(key);
                    } else if let Some(v) = value {
                        p.insert(key.into(), Value::from(v));
                    }
                }
            });
        });
        w.render(result, &design, &format!("Updated {label} (\"{prop_id}\")."))
    },
};

pub const DELETE_PROP: ToolDef = ToolDef {
    name: "delete_prop",
    description: "Remove one prop (something shown with the piece, not built). The parts are untouched.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "prop_id": string("The prop's id (from get_design's `props` list)."),
            }),
            &["project_id", "prop_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let prop_id = args.str("prop_id", "Provide the id of the prop to remove (see get_design).")?;
        let design = w.load_editable(project_id)?;
        find(&design.draft, "props", prop_id).ok_or_else(|| no_prop(prop_id))?;
        let result = w.apply(&design, "Remove prop", false, |spec| {
            if let Some(list) = spec["props"].as_array_mut() {
                list.retain(|p| p["id"] != prop_id);
            }
        });
        w.render(result, &design, &format!("Removed \"{prop_id}\"."))
    },
};
