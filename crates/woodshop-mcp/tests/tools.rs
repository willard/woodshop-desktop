//! The tools end to end against an in-memory library: what an agent session actually does.

use serde_json::{Value, json};
use woodshop_mcp::{Outcome, Woodshop, tools};
use woodshop_store::{Author, Store};

fn call(w: &Woodshop, name: &str, args: Value) -> Outcome {
    tools::call(w, name, args.as_object().expect("object args"))
}

fn ok(w: &Woodshop, name: &str, args: Value) -> Value {
    call(w, name, args).unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

fn err(w: &Woodshop, name: &str, args: Value) -> String {
    match call(w, name, args) {
        Ok(v) => panic!("{name} unexpectedly succeeded: {v}"),
        Err(e) => e,
    }
}

fn woodshop() -> Woodshop {
    Woodshop::new(Store::open_in_memory().unwrap())
}

fn part(w: &Woodshop, project: i64, id: &str) -> Value {
    let design = ok(w, "get_design", json!({ "project_id": project }));
    design["spec"]["parts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .cloned()
        .unwrap_or(Value::Null)
}

#[test]
fn every_tool_has_a_unique_name_and_an_object_schema() {
    assert_eq!(tools::TOOLS.len(), 33);
    let mut names: Vec<_> = tools::TOOLS.iter().map(|t| t.name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 33);
    for t in tools::TOOLS {
        let schema = (t.schema)();
        assert_eq!(schema["type"], "object", "{}", t.name);
        for required in schema["required"].as_array().unwrap() {
            assert!(
                schema["properties"].get(required.as_str().unwrap()).is_some(),
                "{}: {required}",
                t.name
            );
        }
        assert!(!t.description.contains("AI generation"), "{}", t.name);
    }
}

#[test]
fn conventions_describe_the_op_union() {
    let w = woodshop();
    let all = ok(&w, "get_conventions", json!({}));
    assert!(all["conventions"].as_str().unwrap().len() > 1000);
    assert!(all["opTypes"].as_array().unwrap().iter().any(|t| t == "notch"));
    assert_eq!(all["enums"]["edge"]["values"], json!(["l0", "l1", "w0", "w1"]));

    let curve = ok(&w, "get_conventions", json!({ "op": "curve" }));
    assert_eq!(curve["discriminator"], "kind");
    assert_eq!(curve["variants"].as_array().unwrap().len(), 3);
    assert!(err(&w, "get_conventions", json!({ "op": "tenon" })).starts_with("There is no \"tenon\" op."));
}

#[test]
fn authoring_session() {
    let w = woodshop();

    // Start blank on 2x4 lumber.
    let started = ok(
        &w,
        "start_design",
        json!({ "name": "Bench", "material_type": "lumber" }),
    );
    let id = started["projectId"].as_i64().unwrap();
    let listed = ok(&w, "list_projects", json!({}));
    assert_eq!(listed["projects"][0]["name"], "Bench");
    assert!(listed["projects"][0]["updatedAt"].as_str().unwrap().ends_with('Z'));
    let base_material = started["spec"]["materials"][0]["id"].as_str().unwrap().to_owned();
    let base = started["spec"]["parts"][0]["id"].as_str().unwrap().to_owned();

    // A sheet material, and a floating part on it: written, with an advisory.
    let added = ok(
        &w,
        "add_material",
        json!({ "project_id": id, "type": "sheet", "name": "Birch Ply", "thickness": 0.75, "sheet_length": 96, "sheet_width": 48 }),
    );
    assert!(added["summary"].as_str().unwrap().contains("mat_birch_ply"), "{added}");
    let floating = ok(
        &w,
        "add_part",
        json!({ "project_id": id, "name": "Top", "material_id": "mat_birch_ply", "length": 20, "width": 10, "pos": [0, 40, 0], "rot": [-90, 0, 0] }),
    );
    assert!(
        floating["advisories"].as_array().is_some_and(|a| !a.is_empty()),
        "{floating}"
    );
    assert!(floating["summary"].as_str().unwrap().contains("not yet buildable"));

    // Bad input is explained, not written.
    assert_eq!(
        err(
            &w,
            "add_material",
            json!({ "project_id": id, "type": "sheet", "name": "X", "thickness": 0.5 })
        ),
        "A sheet material needs both sheet_length and sheet_width (e.g. 96 x 48)."
    );
    assert_eq!(
        err(&w, "resize_part", json!({ "project_id": id, "part_id": "p_top" })),
        "Provide a new length, a new width, or both."
    );
    assert_eq!(
        err(
            &w,
            "resize_part",
            json!({ "project_id": id, "part_id": "nope", "length": 5 })
        ),
        "No part \"nope\" in this design. Call get_design to see its part ids."
    );
    assert_eq!(
        err(&w, "get_design", json!({ "project_id": 999 })),
        "No design #999 was found in your library."
    );
    assert_eq!(
        err(
            &w,
            "move_part",
            json!({ "project_id": id, "part_id": "p_top", "pos": [1, 2] })
        ),
        "pos must be three numbers: [x, y, z] in inches."
    );

    // Precise edits.
    ok(
        &w,
        "resize_part",
        json!({ "project_id": id, "part_id": "p_top", "length": 22 }),
    );
    assert_eq!(part(&w, id, "p_top")["size"], json!({ "l": 22, "w": 10 }));
    ok(
        &w,
        "rename_part",
        json!({ "project_id": id, "part_id": "p_top", "name": "Seat" }),
    );
    assert_eq!(part(&w, id, "p_top")["name"], "Seat");

    // Ops: add, replace in place, remove; joints follow.
    ok(
        &w,
        "add_op",
        json!({ "project_id": id, "part_id": "p_top", "op": { "type": "hole", "face": "front", "x": 3, "y": 2, "diameter": 0.375 } }),
    );
    ok(
        &w,
        "add_joint",
        json!({ "project_id": id, "host_part_id": "p_top", "insert_part_id": base, "type": "dowel", "op_ref": 0 }),
    );
    let updated = ok(
        &w,
        "update_op",
        json!({ "project_id": id, "part_id": "p_top", "op_index": 0, "op": { "type": "hole", "face": "front", "x": 4, "y": 2, "diameter": 0.375 } }),
    );
    assert!(
        updated["summary"]
            .as_str()
            .unwrap()
            .starts_with("Replaced op #0 (hole)")
    );
    assert_eq!(part(&w, id, "p_top")["ops"][0]["x"], 4);
    assert_eq!(
        err(
            &w,
            "delete_op",
            json!({ "project_id": id, "part_id": "p_top", "op_index": 3 })
        ),
        "\"Seat\" has 1 op (indexes 0–0), so there is no op #3 to remove."
    );
    let removed = ok(
        &w,
        "delete_op",
        json!({ "project_id": id, "part_id": "p_top", "op_index": 0 }),
    );
    assert!(
        removed["summary"].as_str().unwrap().contains("Dropped 1 joint"),
        "{removed}"
    );

    // A schema-invalid op is rejected with the validator's words.
    let rejected = err(
        &w,
        "add_op",
        json!({ "project_id": id, "part_id": "p_top", "op": { "type": "curve", "edge": "l0", "kind": "taper" } }),
    );
    assert!(
        rejected.starts_with("That change would make the design unbuildable"),
        "{rejected}"
    );

    // Materials: a used one can't go; species swaps clone the stock.
    let in_use = err(
        &w,
        "delete_material",
        json!({ "project_id": id, "material_id": base_material }),
    );
    assert!(in_use.contains("is still used by 1 part"), "{in_use}");
    ok(
        &w,
        "set_part_species",
        json!({ "project_id": id, "part_id": "p_top", "species": "walnut" }),
    );
    let seat = part(&w, id, "p_top");
    let design = ok(&w, "get_design", json!({ "project_id": id }));
    let walnut = design["spec"]["materials"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == seat["materialId"])
        .unwrap();
    assert_eq!(walnut["species"], "walnut");
    assert_eq!(walnut["name"], "Walnut — Birch Ply");
    ok(
        &w,
        "rename_material",
        json!({ "project_id": id, "material_id": "mat_birch_ply", "name": "Spare ply" }),
    );
    ok(
        &w,
        "delete_material",
        json!({ "project_id": id, "material_id": "mat_birch_ply" }),
    );

    // Batch authoring with a repeat series and joints naming the new parts.
    let batch = ok(
        &w,
        "add_parts",
        json!({
            "project_id": id,
            "parts": [
                { "id": "p_slat", "name": "Slat", "material_id": base_material, "length": 20, "width": 3.5, "pos": [0, 30, -5], "rot": [-90, 0, 0], "repeat": { "count": 3, "step": [0, 0, 4] } }
            ],
            "joints": [ { "type": "screw", "host_part_id": "p_slat_1", "insert_part_id": base } ]
        }),
    );
    assert!(
        batch["summary"]
            .as_str()
            .unwrap()
            .starts_with("Added 3 parts and 1 joint: p_slat_1, p_slat_2, p_slat_3"),
        "{batch}"
    );
    assert_eq!(part(&w, id, "p_slat_3")["transform"]["pos"], json!([0, 30, 3]));
    assert_eq!(part(&w, id, "p_slat_2")["name"], "Slat 2");

    ok(
        &w,
        "edit_parts",
        json!({ "project_id": id, "edits": [
        { "part_id": "p_slat_1", "size": { "width": 3 } },
        { "part_id": "p_slat_2", "name": "Middle slat" },
    ] }),
    );
    assert_eq!(part(&w, id, "p_slat_1")["size"]["w"], 3);
    assert!(
        err(
            &w,
            "edit_parts",
            json!({ "project_id": id, "edits": [{ "part_id": "p_slat_1" }] })
        )
        .contains("changes nothing")
    );

    // Deleting a part drops the joint that named it.
    ok(&w, "delete_part", json!({ "project_id": id, "part_id": "p_slat_1" }));
    let design = ok(&w, "get_design", json!({ "project_id": id }));
    assert!(
        design["spec"]["joints"]
            .as_array()
            .unwrap()
            .iter()
            .all(|j| j["hostPartId"] != "p_slat_1")
    );

    // Every change left a restore point written by mcp.
    let store = w.store();
    let versions = store.list_versions(id).unwrap();
    assert!(versions.len() > 10, "{}", versions.len());
    assert!(versions.iter().all(|v| v.created_by == Author::Mcp));
}

#[test]
fn edits_that_break_a_buildable_design_are_refused() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "bookshelf" }));
    let id = started["projectId"].as_i64().unwrap();
    let check = ok(&w, "check_design", json!({ "project_id": id }));
    assert_eq!(check["buildable"], true, "{check}");
    assert!(check["overall"]["height"].as_f64().unwrap() > 0.0);

    // Fling a part into space: the move itself would introduce a floating part.
    let parts = ok(&w, "get_design", json!({ "project_id": id }))["spec"]["parts"].clone();
    let victim = parts[0]["id"].as_str().unwrap().to_owned();
    let before = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    let refused = err(
        &w,
        "move_part",
        json!({ "project_id": id, "part_id": victim, "pos": [200, 200, 200] }),
    );
    assert!(
        refused.starts_with("That change would make the design unbuildable, so it was not applied."),
        "{refused}"
    );
    assert_eq!(
        ok(&w, "get_design", json!({ "project_id": id }))["spec"],
        before,
        "nothing was written"
    );
}

#[test]
fn reading_tools_describe_a_template() {
    let w = woodshop();
    let listing = ok(&w, "start_from_template", json!({}));
    assert!(listing["templates"].as_array().unwrap().len() >= 10);
    assert!(
        err(&w, "start_from_template", json!({ "template": "throne" }))
            .starts_with("No template \"throne\". Available:")
    );

    let id = ok(&w, "start_from_template", json!({ "template": "record-stand" }))["projectId"]
        .as_i64()
        .unwrap();

    let cut = ok(&w, "get_cut_list", json!({ "project_id": id }));
    assert!(!cut["parts"].as_array().unwrap().is_empty());
    assert!(!cut["sections"].as_array().unwrap().is_empty());
    assert!(cut["totals"]["boardFeet"].as_f64().is_some());

    let explained = ok(&w, "explain_part", json!({ "project_id": id }));
    let first = &explained["parts"][0];
    assert!(first["world"]["x"].as_str().unwrap().contains('…'));
    assert!(first["localAxesInWorld"]["length"].as_str().is_some());
    assert!(
        err(&w, "explain_part", json!({ "project_id": id, "part_id": "zz" }))
            .starts_with("No part \"zz\" in this design. Its parts are:")
    );

    let index = ok(&w, "render_preview", json!({ "project_id": id }));
    let part_id = index["parts"][0]["partId"].as_str().unwrap().to_owned();
    let drawing = ok(&w, "render_preview", json!({ "project_id": id, "part_id": part_id }));
    assert!(drawing["svg"].as_str().unwrap().starts_with("<svg"), "{drawing}");
}

#[test]
fn movables_round_trip() {
    let w = woodshop();
    let id = ok(&w, "start_from_template", json!({ "template": "nightstand" }))["projectId"]
        .as_i64()
        .unwrap();
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    // Drop whatever movables the template ships so this starts clean.
    for m in spec["movables"].as_array().into_iter().flatten() {
        ok(&w, "delete_movable", json!({ "project_id": id, "movable_id": m["id"] }));
    }
    let panel = spec["parts"][0]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        err(
            &w,
            "add_movable",
            json!({ "project_id": id, "kind": "door", "part_ids": [panel], "anchor_part_id": panel })
        ),
        "A door needs hinge_edge: the panel edge the hinges mount on (l0, l1, w0, or w1)."
    );
    let added = ok(
        &w,
        "add_movable",
        json!({ "project_id": id, "kind": "door", "part_ids": [panel], "anchor_part_id": panel, "hinge_edge": "w0", "name": "Door" }),
    );
    assert!(
        added["summary"].as_str().unwrap().starts_with("Declared 1 part a door"),
        "{added}"
    );
    let dup = err(
        &w,
        "add_movable",
        json!({ "project_id": id, "kind": "drawer", "part_ids": [panel], "anchor_part_id": panel }),
    );
    assert!(dup.contains("already belongs to \"mv_door\""), "{dup}");
    ok(
        &w,
        "update_movable",
        json!({ "project_id": id, "movable_id": "mv_door", "hinge_edge": "w1" }),
    );
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    assert_eq!(
        spec["movables"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == "mv_door")
            .unwrap()["hingeEdge"],
        "w1"
    );
    let gone = ok(
        &w,
        "delete_movable",
        json!({ "project_id": id, "movable_id": "mv_door" }),
    );
    assert!(
        gone["summary"].as_str().unwrap().contains("Its 1 part stayed"),
        "{gone}"
    );
}

#[test]
fn trashed_designs_are_invisible() {
    let w = woodshop();
    let id = ok(&w, "start_design", json!({}))["projectId"].as_i64().unwrap();
    w.store().trash_project(id).unwrap();
    assert!(
        ok(&w, "list_projects", json!({}))["projects"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        err(&w, "get_design", json!({ "project_id": id })),
        format!("No design #{id} was found in your library.")
    );
}

#[test]
fn hardware_from_the_catalog() {
    let w = woodshop();
    let overview = ok(&w, "list_hardware", json!({}));
    assert!(
        overview["categories"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == "casters")
    );
    let pulls = ok(&w, "list_hardware", json!({ "role": "pull" }));
    assert!(
        pulls["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["id"] == "pull.bar-96mm")
    );

    let id = ok(&w, "start_from_template", json!({ "template": "bookshelf" }))["projectId"]
        .as_i64()
        .unwrap();
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    let part = spec["parts"][0]["id"].as_str().unwrap().to_owned();

    // Mounted at the centre of the front face unless told otherwise.
    let added = ok(
        &w,
        "add_hardware",
        json!({ "project_id": id, "item": "pull.bar-96mm", "part_id": part }),
    );
    assert!(
        added["summary"].as_str().unwrap().contains("hw_pull_bar_96mm"),
        "{added}"
    );
    let listed = ok(&w, "get_cut_list", json!({ "project_id": id }));
    assert!(
        listed["hardware"]
            .as_array()
            .unwrap()
            .iter()
            .any(|h| h["description"] == "bar pulls, 96 mm centers" && h["qty"] == 1)
    );

    ok(
        &w,
        "update_hardware",
        json!({ "project_id": id, "hardware_id": "hw_pull_bar_96mm", "side": "back", "rot": 90 }),
    );
    let mount = ok(&w, "get_design", json!({ "project_id": id }))["spec"]["hardware"][0].clone();
    assert_eq!(mount["side"], "back");
    assert_eq!(mount["rot"], 90);

    // Explained refusals: off the part, not in the catalog, slides are not for parts.
    assert!(
        err(
            &w,
            "add_hardware",
            json!({ "project_id": id, "item": "pull.bar-96mm", "part_id": part, "x": 200 })
        )
        .contains("is off the front")
    );
    assert!(
        err(
            &w,
            "add_hardware",
            json!({ "project_id": id, "item": "pull.unobtainium", "part_id": part })
        )
        .starts_with("No \"pull.unobtainium\" in the hardware catalog")
    );
    assert!(
        err(
            &w,
            "add_hardware",
            json!({ "project_id": id, "item": "slide.side-mount", "part_id": part })
        )
        .contains("belong to a drawer")
    );

    // A door names its hinge and pull; the list follows.
    ok(
        &w,
        "add_movable",
        json!({ "project_id": id, "kind": "door", "part_ids": [part], "anchor_part_id": part, "hinge_edge": "w0", "hinge": "hinge.piano-24in", "pull": "none" }),
    );
    let listed = ok(&w, "get_cut_list", json!({ "project_id": id }));
    let rows = listed["hardware"].as_array().unwrap();
    assert!(
        rows.iter()
            .any(|h| h["description"] == "24\" piano (continuous) hinges" && h["qty"] == 1),
        "{rows:?}"
    );
    assert!(!rows.iter().any(|h| h["description"] == "cabinet knobs"), "{rows:?}");
    assert!(
        err(
            &w,
            "update_movable",
            json!({ "project_id": id, "movable_id": "mv_door", "hinge": "pull.bar-96mm" })
        )
        .contains("is not a hinge")
    );

    // Deleting the part takes its hardware with it.
    ok(
        &w,
        "delete_hardware",
        json!({ "project_id": id, "hardware_id": "hw_pull_bar_96mm" }),
    );
    ok(
        &w,
        "add_hardware",
        json!({ "project_id": id, "item": "hook.coat-single", "part_id": part }),
    );
    ok(
        &w,
        "delete_movable",
        json!({ "project_id": id, "movable_id": "mv_door" }),
    );
    let _ = call(&w, "delete_part", json!({ "project_id": id, "part_id": part }));
    let after = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    if after["parts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["id"] != part.as_str())
    {
        assert!(after["hardware"].as_array().unwrap().is_empty());
    }
}
