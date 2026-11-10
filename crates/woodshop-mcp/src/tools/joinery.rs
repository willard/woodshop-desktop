//! Joinery: ops cut into parts, joints recorded between them, and movables (doors and drawers).

use serde_json::{Value, json};

use super::hardware::fitting;
use super::*;
use crate::ctx::{Loaded, compact, find, ids, map_one, plural, push, text, unique_id};
use woodshop_core::hardware::Role;

fn op_arg<'a>(args: &Args<'a>, required: &str, needs_type: &str) -> Result<&'a Value, String> {
    let op = args.raw("op").ok_or_else(|| required.to_owned())?;
    let obj = op.as_object().ok_or("The op field must be an object.")?;
    if !obj.get("type").is_some_and(Value::is_string) {
        return Err(needs_type.into());
    }
    Ok(op)
}

/// The op list of a part in the draft, and the index checked against it.
fn op_at<'a>(design: &'a Loaded, part_id: &str, index: i64, verb: &str) -> Result<(&'a Value, &'a Value), String> {
    let part = find(&design.draft, "parts", part_id).ok_or_else(|| no_part(part_id))?;
    let ops = part["ops"].as_array().map(Vec::as_slice).unwrap_or_default();
    match usize::try_from(index).ok().and_then(|i| ops.get(i)) {
        Some(op) => Ok((part, op)),
        None => {
            let count = ops.len();
            let has = if count == 0 {
                "no ops".to_owned()
            } else {
                format!("{count} op{} (indexes 0–{})", plural(count), count - 1)
            };
            Err(format!(
                "\"{}\" has {has}, so there is no op #{index} to {verb}.",
                text(part, "name")
            ))
        }
    }
}

pub const ADD_OP: ToolDef = ToolDef {
    name: "add_op",
    description: "Add ONE subtractive feature (op) to a part. Pass `op` as an object with a `type` and \
        that type's fields. edge is one of l0, l1, w0, w1 (zero-based — there is no l2); face is front \
        or back; every dimension is decimal inches. The signatures:\n  \
        dado/groove {\"type\":\"dado\",\"face\":\"front\",\"axis\":\"l|w\",\"offset\":6,\"width\":0.75,\"depth\":0.375} — optional from, to\n  \
        rabbet      {\"type\":\"rabbet\",\"edge\":\"l0\",\"width\":0.5,\"depth\":0.25}\n  \
        hole        {\"type\":\"hole\",\"face\":\"front\",\"x\":3,\"y\":2,\"diameter\":0.375} — optional depth, purpose\n  \
        pocketHoles {\"type\":\"pocketHoles\",\"edge\":\"w0\",\"count\":2} — edge w0/w1 for ends, l0/l1 for edges; face is drill face (default \"back\")\n  \
        screws      {\"type\":\"screws\",\"face\":\"back\",\"axis\":\"l\",\"offset\":3,\"count\":4} — face is where heads sit, pointing away from mate\n  \
        miter       {\"type\":\"miter\",\"edge\":\"w1\",\"angle\":45}\n  \
        curve       {\"type\":\"curve\",\"edge\":\"l1\",\"kind\":\"arc\",\"height\":3} | kind \"round\" + radius (optional corner) | kind \"ramp\" + height + low\n  \
        notch       {\"type\":\"notch\",\"edge\":\"l0\",\"from\":1.25,\"to\":4.25,\"depth\":3}\n  \
        ease        {\"type\":\"ease\",\"edge\":\"l1\",\"profile\":\"roundover\",\"radius\":0.25} | profile \"chamfer\" + width | profile \"bullnose\" — optional face, from, to\n\
        Offsets and from/to measure from the low perpendicular edge (w0 for l-edges, l0 for w-edges); \
        call get_conventions for the datum, the bounds, and what each field means. The op is validated \
        against the schema and its fit to the part; problems come back so you can adjust.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part to cut the op into (from get_design)."),
                "op": { "type": "object", "description": "The op object: a `type` plus that type's fields (dimensions in inches)." },
            }),
            &["project_id", "part_id", "op"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "")?;
        let op = op_arg(
            args,
            "Provide the op object, e.g. {\"type\":\"dado\",\"face\":\"front\",\"axis\":\"w\",\"offset\":6,\"width\":0.75,\"depth\":0.375}.",
            "The op needs a \"type\" (dado, groove, rabbet, hole, pocketHoles, miter, curve, notch, or ease).",
        )?;
        let design = w.load_editable(project_id)?;
        let name = find(&design.draft, "parts", part_id)
            .map(|p| text(p, "name").to_owned())
            .ok_or_else(|| no_part(part_id))?;
        let ty = text(op, "type").to_owned();
        let result = w.apply(&design, &format!("Add {ty} to {name}"), false, |spec| {
            map_one(spec, "parts", part_id, |p| {
                match p.get_mut("ops").and_then(Value::as_array_mut) {
                    Some(ops) => ops.push(op.clone()),
                    None => {
                        p.insert("ops".into(), json!([op]));
                    }
                }
            });
        });
        w.render(result, &design, &format!("Added a {ty} op to \"{name}\"."))
    },
};

pub const UPDATE_OP: ToolDef = ToolDef {
    name: "update_op",
    description: "Replace one op on a part, in place, by its index (get_design shows them in order). Use \
        this to nudge a dado offset, deepen a notch, or re-aim a screw row — NOT delete_op followed by \
        add_op, which drops any joint that pointed at the op and renumbers the rest, silently losing the \
        joinery. Pass the COMPLETE replacement op, not just the fields you are changing: op variants are \
        tagged unions, so a partial merge could leave a curve carrying fields from a different kind. Read \
        the current op from get_design or explain_part, change what you need, send it back. The op is \
        validated against the schema and its fit to the part.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part the op is on (from get_design)."),
                "op_index": integer("Which op to replace: its 0-based position in that part's ops. The index is kept, so joints referencing this op still point at it."),
                "op": { "type": "object", "description": "The COMPLETE replacement op: a `type` plus that type's fields (dimensions in inches). Not a partial patch — see get_conventions for each type's full signature." },
            }),
            &["project_id", "part_id", "op_index", "op"],
        )
    },
    run: update_op,
};

fn update_op(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let part_id = args.str("part_id", "Provide the id of the part the op is on (see get_design).")?;
    let index = args.int(
        "op_index",
        "Provide the index of the op to replace (its position in the part's ops, starting at 0).",
    )?;
    let op = op_arg(
        args,
        "Provide the complete replacement op, e.g. {\"type\":\"notch\",\"edge\":\"l0\",\"from\":1.25,\"to\":4.25,\"depth\":3}.",
        "The replacement op needs a \"type\" (dado, groove, rabbet, hole, pocketHoles, screws, miter, curve, notch, or ease).",
    )?;
    let design = w.load_editable(project_id)?;
    let (part, old) = op_at(&design, part_id, index, "replace")?;
    let name = text(part, "name").to_owned();
    let was = old["type"].as_str().unwrap_or("op").to_owned();
    let ty = text(op, "type").to_owned();
    let i = index as usize;
    let result = w.apply(&design, &format!("Update {was} on {name}"), false, |spec| {
        // In place — every opRef on this part still points where it did.
        map_one(spec, "parts", part_id, |p| p["ops"][i] = op.clone());
    });
    let summary = if was == ty {
        format!("Replaced op #{index} ({was}) on \"{name}\".")
    } else {
        let affected = design.draft["joints"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|j| j["hostPartId"] == part_id && j["opRef"] == index)
            .count();
        let note = if affected == 0 {
            String::new()
        } else {
            format!(
                " {affected} joint{} still point{} at op #{index} — check the joint type still matches a {ty}, or \
                 the linter will call it a mismatch.",
                plural(affected),
                if affected == 1 { "s" } else { "" }
            )
        };
        format!("Replaced op #{index} on \"{name}\": {was} → {ty}.{note}")
    };
    w.render(result, &design, &summary)
}

pub const DELETE_OP: ToolDef = ToolDef {
    name: "delete_op",
    description: "Remove one op from a part by its index in that part's ops (get_design shows them in \
        order). Use it to undo a dado, hole, or fastener row placed wrongly, instead of deleting the \
        whole part. Joints on this part are kept in step automatically: any joint that pointed at the \
        removed op is dropped, and joints pointing at later ops are renumbered.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The id of the part the op is on (from get_design)."),
                "op_index": integer("Which op to remove: its 0-based position in that part's ops."),
            }),
            &["project_id", "part_id", "op_index"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let part_id = args.str("part_id", "Provide the id of the part the op is on (see get_design).")?;
        let index = args.int(
            "op_index",
            "Provide the index of the op to remove (its position in the part's ops, starting at 0).",
        )?;
        let design = w.load_editable(project_id)?;
        let (part, op) = op_at(&design, part_id, index, "remove")?;
        let name = text(part, "name").to_owned();
        let ty = op["type"].as_str().unwrap_or("op").to_owned();
        let i = index as usize;
        let mut dropped = 0;
        let result = w.apply(&design, &format!("Delete {ty} from {name}"), false, |spec| {
            map_one(spec, "parts", part_id, |p| {
                if let Some(ops) = p.get_mut("ops").and_then(Value::as_array_mut) {
                    ops.remove(i);
                }
            });
            if let Some(joints) = spec["joints"].as_array_mut() {
                joints.retain_mut(|j| {
                    let Some(op_ref) = j["opRef"].as_u64().filter(|_| j["hostPartId"] == part_id) else {
                        return true;
                    };
                    let op_ref = op_ref as usize;
                    if op_ref == i {
                        dropped += 1; // the joinery this joint described is gone with the op
                        return false;
                    }
                    if op_ref > i {
                        j["opRef"] = (op_ref - 1).into();
                    }
                    true
                });
            }
        });
        let note = if dropped == 0 {
            String::new()
        } else {
            format!(" Dropped {dropped} joint{} that described it.", plural(dropped))
        };
        w.render(result, &design, &format!("Removed the {ty} op from \"{name}\".{note}"))
    },
};

const JOINT_TYPE_INVALID: &str = "Joint type must be one of: dado, rabbet, butt, pocketScrew, screw, dowel.";

pub const ADD_JOINT: ToolDef = ToolDef {
    name: "add_joint",
    description: "Record a joint annotation between two existing parts (dado, rabbet, butt, pocketScrew, \
        screw, or dowel). Joints describe how parts connect; they do not move geometry. For a dado/rabbet \
        housing, set op_ref to the index of the receiving op in the host part. The response returns the \
        new joint's stable id — use that with delete_joint rather than counting positions.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "host_part_id": string("The part that receives the joint (e.g. the grooved/housing part)."),
                "insert_part_id": string("The part that seats into the host."),
                "type": one_of(JOINT_TYPES, "The joint type."),
                "op_ref": integer("For a dado/rabbet housing: the index of the receiving op in the host part."),
            }),
            &["project_id", "host_part_id", "insert_part_id", "type"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let host = args.str("host_part_id", "")?;
        let insert = args.str("insert_part_id", "")?;
        let kind = args.enumerated("type", JOINT_TYPES, JOINT_TYPE_INVALID, "")?;
        let op_ref = args.opt_int_in("op_ref", 0, i64::MAX)?;
        let design = w.load_editable(project_id)?;
        for (label, part_id) in [("host_part_id", host), ("insert_part_id", insert)] {
            if find(&design.draft, "parts", part_id).is_none() {
                return Err(format!(
                    "No part \"{part_id}\" (the {label}) in this design. See get_design for part ids."
                ));
            }
        }
        let id = unique_id(&ids(&design.draft, "joints"), "j_", &format!("{host}_{insert}"));
        let joint =
            compact(json!({ "id": id, "type": kind, "hostPartId": host, "insertPartId": insert, "opRef": op_ref }));
        let result = w.apply(&design, &format!("Add {kind} joint"), false, |spec| {
            push(spec, "joints", joint)
        });
        w.render(
            result,
            &design,
            &format!("Recorded a {kind} joint from \"{host}\" to \"{insert}\", id \"{id}\"."),
        )
    },
};

pub const DELETE_JOINT: ToolDef = ToolDef {
    name: "delete_joint",
    description: "Remove one joint, named by `joint_id` (preferred — ids are stable, see get_design) or by \
        `joint_index`, its 0-based position in the joints array. Prefer the id: positions shift as joints \
        are removed, so deleting several by index means counting down and hoping. Use this to withdraw \
        joinery recorded wrongly — a joint naming the wrong mate, or one left over after the op it \
        described changed. The parts themselves are untouched.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "joint_id": string("Which joint to remove, by its stable id (from get_design). Preferred — ids do not shift when other joints are removed."),
                "joint_index": integer("Which joint to remove, by its 0-based position in the joints array. Use joint_id instead where you can."),
            }),
            &["project_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let joint_id = args.opt_str("joint_id")?;
        let joint_index = args.opt_int_in("joint_index", 0, i64::MAX)?;
        if joint_id.is_none() && joint_index.is_none() {
            return Err(
                "Name the joint to remove: `joint_id` (see get_design), or `joint_index` for its 0-based \
                        position."
                    .into(),
            );
        }
        let design = w.load_editable(project_id)?;
        let joints = design.draft["joints"].as_array().map(Vec::as_slice).unwrap_or_default();
        let count = joints.len();
        let index = match joint_id {
            Some(id) => joints.iter().position(|j| j["id"] == id).ok_or_else(|| {
                let listed = ids(&design.draft, "joints");
                let listed = if listed.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", listed.join(", "))
                };
                format!(
                    "This design has {count} joint{}{listed}, so there is no joint \"{id}\" to remove.",
                    plural(count)
                )
            })?,
            None => {
                let index = joint_index.unwrap_or_default() as usize;
                if index >= count {
                    let has = if count == 0 {
                        "no joints".to_owned()
                    } else {
                        format!("{count} joint{} (indexes 0–{})", plural(count), count - 1)
                    };
                    return Err(format!(
                        "This design has {has}, so there is no joint #{index} to remove."
                    ));
                }
                index
            }
        };
        let joint = &joints[index];
        let kind = joint["type"].as_str().unwrap_or("joint");
        let label = format!(
            "{kind} joint from \"{}\" to \"{}\"",
            joint["hostPartId"].as_str().unwrap_or("?"),
            joint["insertPartId"].as_str().unwrap_or("?")
        );
        let result = w.apply(&design, &format!("Delete {kind} joint"), false, |spec| {
            if let Some(joints) = spec["joints"].as_array_mut() {
                joints.remove(index);
            }
        });
        w.render(result, &design, &format!("Removed the {label}."))
    },
};

pub const ADD_MOVABLE: ToolDef = ToolDef {
    name: "add_movable",
    description: "Declare existing parts a door or a drawer (§3.3). A movable names the parts that move as \
        a unit plus the anchor whose local frame defines the motion: a door needs panel_part_id and \
        hinge_edge, a drawer needs front_part_id (it pulls out along that part's front face, local +Z). \
        The spec stores the CLOSED position — opening is a view, never a change to the geometry. Parts \
        hung this way are held by their hardware, so they no longer need fastening to the carcase, and \
        the cut list gains the hinges, slides, and knob.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "kind": one_of(&["door", "drawer"], "door or drawer."),
                "part_ids": array(json!({ "type": "string" }), "Every part that moves together (a door panel; or a drawer front plus its box parts)."),
                "anchor_part_id": string("The panel (door) or front (drawer). Must be one of part_ids; its local frame defines the motion."),
                "hinge_edge": one_of(EDGES, "Doors only: the panel edge the hinges mount on, in its own frame (§3.1)."),
                "style": one_of(&["overlay", "inset"], "overlay laps the opening, inset sits inside it. Defaults to overlay."),
                "name": string("Optional label, e.g. \"Left Door\"."),
                "hinge": string("Doors only: a catalog hinge id (list_hardware with role \"hinge\"). Omit for the standard hinge for the style."),
                "slide": string("Drawers only: a catalog slide id (list_hardware with role \"slide\"). Omit for side-mount ball-bearing slides."),
                "pull": string("A catalog pull or knob id (list_hardware with role \"pull\"), or \"none\". Omit for a plain knob."),
            }),
            &["project_id", "kind", "part_ids", "anchor_part_id"],
        )
    },
    run: add_movable,
};

fn add_movable(w: &Woodshop, args: &Args) -> Outcome {
    let project_id = args.project_id(PROVIDE_PROJECT)?;
    let kind = args.enumerated(
        "kind",
        &["door", "drawer"],
        "A movable is either a door or a drawer.",
        "",
    )?;
    let part_ids: Vec<String> = match args.opt_array("part_ids", usize::MAX)? {
        Some(ids) if !ids.is_empty() => ids
            .iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .ok_or("Every entry in part_ids must be a part id string.")
            })
            .collect::<Result<_, _>>()?,
        _ => return Err("List every part that moves together — the panel, or the drawer front and its box.".into()),
    };
    let anchor = args.str(
        "anchor_part_id",
        "Name the panel (door) or front (drawer); it defines the motion and must be one of part_ids.",
    )?;
    let hinge_edge = args.opt_enum(
        "hinge_edge",
        EDGES,
        "hinge_edge must be one of: l0, l1, w0, w1 (the panel's own edge, §3.1).",
    )?;
    let style = args.opt_enum("style", &["overlay", "inset"], "")?;
    let name = args.opt_str_max("name", 80)?;
    let hinge = fitting(args, "hinge", Role::Hinge)?;
    let slide = fitting(args, "slide", Role::Slide)?;
    let pull = fitting(args, "pull", Role::Pull)?;
    if kind == "drawer" && hinge.is_some() {
        return Err("A drawer has no hinge; give it a `slide` instead.".into());
    }
    if kind == "door" && slide.is_some() {
        return Err("A door has no slides; give it a `hinge` instead.".into());
    }

    let design = w.load_editable(project_id)?;
    for part_id in &part_ids {
        if find(&design.draft, "parts", part_id).is_none() {
            return Err(format!(
                "No part \"{part_id}\" in this design. See get_design for part ids."
            ));
        }
    }
    if !part_ids.iter().any(|p| p == anchor) {
        return Err(format!(
            "The anchor \"{anchor}\" must also be listed in part_ids — it is the part whose frame defines the motion."
        ));
    }
    if kind == "door" && hinge_edge.is_none() {
        return Err("A door needs hinge_edge: the panel edge the hinges mount on (l0, l1, w0, or w1).".into());
    }
    for existing in design.draft["movables"].as_array().into_iter().flatten() {
        for claimed in existing["partIds"].as_array().into_iter().flatten() {
            if let Some(part_id) = claimed.as_str()
                && part_ids.iter().any(|p| p == part_id)
            {
                return Err(format!(
                    "Part \"{part_id}\" already belongs to \"{}\" — movables are flat, a part moves with only one.",
                    text(existing, "id")
                ));
            }
        }
    }

    let taken = ids(&design.draft, "movables");
    let stem = format!("mv_{kind}");
    let mut id = stem.clone();
    let mut n = 1;
    while taken.contains(&id) {
        n += 1;
        id = format!("{stem}_{n}");
    }
    let door = kind == "door";
    let movable = compact(json!({
        "id": id,
        "kind": kind,
        "name": name,
        "partIds": part_ids,
        "panelPartId": door.then_some(anchor),
        "frontPartId": (!door).then_some(anchor),
        "hingeEdge": if door { hinge_edge } else { None },
        "style": style.unwrap_or("overlay"),
        "hinge": if door { hinge } else { None },
        "slide": if door { None } else { slide },
        "pull": pull,
    }));
    let result = w.apply(&design, &format!("Add {kind}"), false, |spec| {
        push(spec, "movables", movable)
    });
    let count = part_ids.len();
    let parts = if count == 1 {
        "1 part".to_owned()
    } else {
        format!("{count} parts")
    };
    w.render(
        result,
        &design,
        &format!("Declared {parts} a {kind}, anchored on \"{anchor}\"."),
    )
}

fn no_movable(id: &str) -> String {
    format!("No door or drawer \"{id}\" in this design. Call get_design to see its movables.")
}

pub const UPDATE_MOVABLE: ToolDef = ToolDef {
    name: "update_movable",
    description: "Change a door or drawer already on a design: its hinge edge, its style, or its name. Use \
        this when it opens the wrong way — hingeEdge names an edge in the anchor part's OWN local frame \
        (§3.1), so the fix is usually a different edge, not moved geometry. Only doors have a hinge edge. \
        The parts and their positions are untouched.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "movable_id": string("The id of the door or drawer (from get_design)."),
                "hinge_edge": one_of(EDGES, "Doors only: the panel edge the hinges mount on, in its own frame (§3.1)."),
                "style": one_of(&["overlay", "inset"], "Overlay laps the opening; inset sits inside it."),
                "name": string("New display name, e.g. \"Left Door\"."),
                "hinge": string("Doors only: a catalog hinge id (list_hardware with role \"hinge\"). Omit for the standard hinge for the style."),
                "slide": string("Drawers only: a catalog slide id (list_hardware with role \"slide\"). Omit for side-mount ball-bearing slides."),
                "pull": string("A catalog pull or knob id (list_hardware with role \"pull\"), or \"none\". Omit for a plain knob."),
            }),
            &["project_id", "movable_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let movable_id = args.str(
            "movable_id",
            "Provide the id of the door or drawer to change (see get_design).",
        )?;
        let changes: Vec<(&str, &str)> = [
            (
                "hingeEdge",
                args.opt_enum(
                    "hinge_edge",
                    EDGES,
                    "hinge_edge must be one of: l0, l1, w0, w1 (an edge of the panel in its own frame, §3.1).",
                )?,
            ),
            (
                "style",
                args.opt_enum("style", &["overlay", "inset"], "style must be overlay or inset.")?,
            ),
            ("name", args.opt_str_max("name", 80)?.filter(|n| !n.is_empty())),
            ("hinge", fitting(args, "hinge", Role::Hinge)?),
            ("slide", fitting(args, "slide", Role::Slide)?),
            ("pull", fitting(args, "pull", Role::Pull)?),
        ]
        .into_iter()
        .filter_map(|(k, v)| v.map(|v| (k, v)))
        .collect();
        if changes.is_empty() {
            return Err("Provide what to change: hinge_edge, style, name, hinge, slide or pull.".into());
        }
        let design = w.load_editable(project_id)?;
        let movable = find(&design.draft, "movables", movable_id).ok_or_else(|| no_movable(movable_id))?;
        let is_door = movable["kind"] == "door";
        if changes.iter().any(|(k, _)| *k == "hinge") && !is_door {
            return Err(format!(
                "\"{movable_id}\" is a drawer, which has no hinge; set its `slide` instead."
            ));
        }
        if changes.iter().any(|(k, _)| *k == "slide") && is_door {
            return Err(format!(
                "\"{movable_id}\" is a door, which has no slides; set its `hinge` instead."
            ));
        }
        if changes.iter().any(|(k, _)| *k == "hingeEdge") && movable["kind"] != "door" {
            return Err(format!(
                "\"{movable_id}\" is a drawer, which has no hinge edge — it pulls out along its front's own +Z \
                 face normal. Rotate the front if it opens the wrong way."
            ));
        }
        let label = movable["name"].as_str().unwrap_or(movable_id).to_owned();
        let result = w.apply(&design, &format!("Update movable {movable_id}"), true, |spec| {
            map_one(spec, "movables", movable_id, |m| {
                for (k, v) in &changes {
                    m.insert((*k).into(), (*v).into());
                }
            });
        });
        let described: Vec<String> = changes.iter().map(|(k, v)| format!("{k} → {v}")).collect();
        w.render(
            result,
            &design,
            &format!("Updated \"{label}\": {}.", described.join(", ")),
        )
    },
};

pub const DELETE_MOVABLE: ToolDef = ToolDef {
    name: "delete_movable",
    description: "Dissolve a door or drawer: the parts stay exactly where they are, they just stop moving \
        as a unit and their hinges, slides, and knob leave the hardware list. Use it when something was \
        declared a movable by mistake, or to rebuild one differently with add_movable.",
    read_only: false,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "movable_id": string("The id of the door or drawer to dissolve (from get_design)."),
            }),
            &["project_id", "movable_id"],
        )
    },
    run: |w, args| {
        let project_id = args.project_id(PROVIDE_PROJECT)?;
        let movable_id = args.str(
            "movable_id",
            "Provide the id of the door or drawer to dissolve (see get_design).",
        )?;
        let design = w.load_editable(project_id)?;
        let movable = find(&design.draft, "movables", movable_id).ok_or_else(|| no_movable(movable_id))?;
        let label = movable["name"].as_str().unwrap_or(movable_id).to_owned();
        let members = movable["partIds"].as_array().map_or(0, Vec::len);
        let result = w.apply(&design, &format!("Dissolve movable {movable_id}"), false, |spec| {
            if let Some(ms) = spec["movables"].as_array_mut() {
                ms.retain(|m| m["id"] != movable_id);
            }
        });
        w.render(
            result,
            &design,
            &format!(
                "Dissolved \"{label}\". Its {members} part{} stayed exactly where they were.",
                plural(members)
            ),
        )
    },
};
