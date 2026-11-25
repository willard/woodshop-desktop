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
    assert_eq!(tools::TOOLS.len(), 43);
    let mut names: Vec<_> = tools::TOOLS.iter().map(|t| t.name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), tools::TOOLS.len());
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
    assert_eq!(curve["variants"].as_array().unwrap().len(), 5);
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

    // Edge banding: stored in a fixed order, totalled on the cut list, and cleared with [].
    ok(
        &w,
        "set_edge_banding",
        json!({ "project_id": id, "part_id": "p_top", "edges": ["w1", "l1", "l1"] }),
    );
    assert_eq!(part(&w, id, "p_top")["edgeBand"], json!(["l1", "w1"]));
    let cut = ok(&w, "get_cut_list", json!({ "project_id": id }));
    assert!(cut.to_string().contains("edge banding"), "{cut}");
    assert!(
        err(
            &w,
            "set_edge_banding",
            json!({ "project_id": id, "part_id": "p_top", "edges": ["top"] })
        )
        .contains("l0, l1, w0, w1")
    );
    ok(
        &w,
        "set_edge_banding",
        json!({ "project_id": id, "part_id": "p_top", "edges": [] }),
    );
    assert_eq!(part(&w, id, "p_top")["edgeBand"], Value::Null);

    // Ops: add, replace in place, remove; joints follow.
    ok(
        &w,
        "add_op",
        json!({ "project_id": id, "part_id": "p_top", "op": { "type": "hole", "face": "front", "x": 3, "y": 2, "diameter": 0.375 } }),
    );
    // The cut list words it as joinery, with the drill setting to make it.
    let cut = ok(&w, "get_cut_list", json!({ "project_id": id }));
    assert_eq!(cut["joinery"]["setups"][0]["setup"], "3/8\" bit, through", "{cut}");
    assert!(
        cut["joinery"]["parts"][0]["lines"][0]
            .as_str()
            .unwrap()
            .starts_with("Hole ⌀ 3/8\"")
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
    // The assembly order names every part, from the floor up.
    let steps = cut["assemblyOrder"].as_array().unwrap();
    assert!(!steps.is_empty());
    assert!(steps[0]["heading"].as_str().is_some());
    let order = cut["assemblyOrder"].to_string();
    for row in cut["parts"].as_array().unwrap() {
        let name = row["name"].as_str().unwrap();
        assert!(order.contains(name), "{name} missing from {order}");
    }

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
        "A door needs hinge_edge: the edge the hinges mount on (l0, l1, w0, or w1), in its own frame."
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

    // explain_part says where the pull ended up, and which way it faces.
    let explained = ok(&w, "explain_part", json!({ "project_id": id, "part_id": part }))["parts"][0].clone();
    let mounted = &explained["hardware"][0];
    assert_eq!(mounted["id"], "hw_pull_bar_96mm", "{explained}");
    assert_eq!(mounted["name"], "Bar pull, 96 mm centers");
    assert_eq!(mounted["side"], "back");
    assert_eq!(mounted["at"].as_array().unwrap().len(), 3);
    assert!(mounted["faces"].as_str().unwrap().contains('('), "{mounted}");
    assert!(
        explained.get("hardwareBorings").is_none(),
        "a piano hinge bores nothing"
    );

    // Concealed hinges need cups in the door: derived, reported, and never written into ops.
    ok(
        &w,
        "update_movable",
        json!({ "project_id": id, "movable_id": "mv_door", "hinge": "hinge.euro-full-overlay" }),
    );
    let explained = ok(&w, "explain_part", json!({ "project_id": id, "part_id": part }))["parts"][0].clone();
    let cups = explained["hardwareBorings"]["holes"].as_array().unwrap();
    assert!(cups.len() >= 2, "{explained}");
    assert_eq!(cups[0]["face"], "back");
    assert_eq!(cups[0]["for"], "Concealed hinge, full overlay");
    assert!(cups[0]["world"].is_object(), "{}", cups[0]);
    let ops_after = ok(&w, "get_design", json!({ "project_id": id }))["spec"]["parts"][0]["ops"].clone();
    assert_eq!(ops_after, spec["parts"][0]["ops"], "the cups are not stored in ops");
    let drawing = ok(&w, "render_preview", json!({ "project_id": id, "part_id": part }));
    assert!(drawing.to_string().contains("circle"), "the pattern shows the cups");

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

#[test]
fn shelf_pin_holes_go_up_a_case_side_in_two_columns() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "bookshelf" }));
    let id = started["projectId"].as_i64().unwrap();
    let side = json!({ "project_id": id, "part_id": "p_side_l", "face": "front", "axis": "w" });

    // 72" tall, 32 mm apart, about 6" clear at each end: 48 a column.
    let added = ok(&w, "add_shelf_pin_holes", side.clone());
    assert!(
        added["summary"]
            .as_str()
            .unwrap()
            .starts_with("Added 96 shelf-pin holes to \"Left Side\": 2 columns of 48, ops #1–#96."),
        "{added}"
    );
    let ops = part(&w, id, "p_side_l")["ops"].as_array().unwrap().clone();
    assert_eq!(ops.len(), 97);
    let pins = &ops[1..];
    assert!(pins.iter().all(|h| h["purpose"] == "shelfPin" && h["face"] == "front"));
    let mut columns: Vec<f64> = pins.iter().map(|h| h["x"].as_f64().unwrap()).collect();
    columns.dedup();
    assert_eq!(columns, vec![1.4567, 9.7933]);
    assert_eq!(ok(&w, "check_design", json!({ "project_id": id }))["buildable"], true);

    // A second run would pass the 100-op limit; a hole as deep as the stock goes through.
    assert!(err(&w, "add_shelf_pin_holes", side.clone()).contains("at most 100"));
    let mut through = side.clone();
    through["part_id"] = json!("p_side_r");
    through["depth"] = json!(0.75);
    assert!(err(&w, "add_shelf_pin_holes", through.clone()).contains("right through"));
    through["depth"] = json!(0.375);
    through["spacing"] = json!(2);
    through["from"] = json!(8);
    through["to"] = json!(64.5);
    assert!(
        ok(&w, "add_shelf_pin_holes", through)["summary"]
            .as_str()
            .unwrap()
            .contains("2 columns of 29")
    );
}

#[test]
fn hardware_holes_take_one_column_for_hinge_plates() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "bookshelf" }));
    let id = started["projectId"].as_i64().unwrap();
    let added = ok(
        &w,
        "add_shelf_pin_holes",
        json!({ "project_id": id, "part_id": "p_side_r", "face": "front", "axis": "w",
                "purpose": "hardware", "columns": "high", "from": 2, "to": 10 }),
    );
    assert!(
        added["summary"]
            .as_str()
            .unwrap()
            .starts_with("Added 7 hardware holes to \"Right Side\": 1 column of 7"),
        "{added}"
    );
    let ops = part(&w, id, "p_side_r")["ops"].as_array().unwrap().clone();
    let holes: Vec<&Value> = ops.iter().filter(|o| o["purpose"] == "hardware").collect();
    assert_eq!(holes.len(), 7);
    assert!(holes.iter().all(|h| h["x"] == json!(9.7933)));
    assert!(
        err(
            &w,
            "add_shelf_pin_holes",
            json!({ "project_id": id, "part_id": "p_side_r", "face": "front", "axis": "w", "columns": "front" })
        )
        .contains("both, low or high")
    );
}

#[test]
fn a_mirrored_left_side_stands_where_the_right_side_was() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "bookshelf" }));
    let id = started["projectId"].as_i64().unwrap();
    let drawn = part(&w, id, "p_side_r");
    ok(&w, "delete_part", json!({ "project_id": id, "part_id": "p_side_r" }));
    ok(
        &w,
        "add_hardware",
        json!({ "project_id": id, "part_id": "p_side_l", "item": "bracket.corner-2in", "side": "front", "x": 2, "y": 10 }),
    );

    let mirrored = ok(
        &w,
        "mirror_parts",
        json!({ "project_id": id, "part_ids": ["p_side_l"], "direction": "left_right", "plane": 0 }),
    );
    let summary = mirrored["summary"].as_str().unwrap();
    assert!(
        summary.starts_with("Added 1 mirrored part across x = 0: \"Right Side\" (p_side_r)."),
        "{summary}"
    );
    let side = part(&w, id, "p_side_r");
    assert_eq!(side["transform"]["pos"], drawn["transform"]["pos"]);
    assert_eq!(side["transform"]["rot"], json!([0, -90, 0]));
    // Turned the other way, so its screws are on the other face — the same world spot, outboard.
    assert_eq!(
        side["ops"][0],
        json!({ "type": "screws", "face": "back", "axis": "w", "offset": 0.375, "count": 12, "from": 1, "to": 71, "gauge": "#8", "length": 1.25 })
    );

    let design = ok(&w, "get_design", json!({ "project_id": id }));
    let spec = &design["spec"];
    let joints: Vec<&Value> = spec["joints"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|j| j["hostPartId"] == "p_side_r" || j["insertPartId"] == "p_side_r")
        .collect();
    // The back is centred, so the side screws into it as the left one does; the pocket screws come
    // from cuts in the top, bottom and shelves that only the left side has.
    assert_eq!(joints.len(), 1, "{joints:?}");
    assert_eq!(joints[0]["insertPartId"], "p_back");
    let bracket = spec["hardware"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["partId"] == "p_side_r")
        .expect("the bracket comes along");
    assert_eq!(
        (bracket["side"].as_str(), bracket["x"].as_f64()),
        (Some("front"), Some(9.25))
    );

    assert!(
        err(
            &w,
            "mirror_parts",
            json!({ "project_id": id, "part_ids": ["nope"], "direction": "left_right" })
        )
        .contains("No part")
    );
    assert!(
        err(
            &w,
            "mirror_parts",
            json!({ "project_id": id, "part_ids": ["p_top"], "direction": "sideways" })
        )
        .contains("direction")
    );
}

#[test]
fn a_finish_rides_on_a_drawer_and_a_mounted_pull() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "nightstand" }));
    let id = started["projectId"].as_i64().unwrap();
    ok(
        &w,
        "update_movable",
        json!({ "project_id": id, "movable_id": "mv_drawer", "finish": "black" }),
    );
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    assert_eq!(spec["movables"][0]["finish"], "black");
    let cut = ok(&w, "get_cut_list", json!({ "project_id": id }));
    assert!(
        cut["hardware"].to_string().contains("matte black"),
        "{}",
        cut["hardware"]
    );

    let added = ok(
        &w,
        "add_hardware",
        json!({ "project_id": id, "item": "knob.round-1-1-4", "part_id": "p_drawer_front", "finish": "brass" }),
    );
    let hw = added["summary"]
        .as_str()
        .unwrap()
        .rsplit('"')
        .nth(1)
        .unwrap()
        .to_owned();
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    let mount = spec["hardware"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["id"] == hw.as_str())
        .unwrap()
        .clone();
    assert_eq!(mount["finish"], "brass");

    // "steel" takes a finish off again; a made-up one is refused.
    ok(
        &w,
        "update_hardware",
        json!({ "project_id": id, "hardware_id": hw, "finish": "steel" }),
    );
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    let mount = spec["hardware"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["id"] == hw.as_str())
        .unwrap()
        .clone();
    assert!(mount.get("finish").is_none());
    assert!(
        err(
            &w,
            "update_movable",
            json!({ "project_id": id, "movable_id": "mv_drawer", "finish": "gold" })
        )
        .contains("nickel, black, brass, bronze or steel")
    );
}

#[test]
fn the_cut_list_is_costed_with_the_users_hardware_prices() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "nightstand" }));
    let id = started["projectId"].as_i64().unwrap();
    let list = ok(&w, "get_cut_list", json!({ "project_id": id }));
    let pull = list["hardware"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["kind"] == "knob")
        .unwrap()
        .clone();
    assert!(pull.get("cost").is_none());
    let key = pull["key"].as_str().unwrap().to_string();
    w.store().set_setting("hardwarePrices", &json!({ key: 7.25 })).unwrap();
    let list = ok(&w, "get_cut_list", json!({ "project_id": id }));
    let pull = list["hardware"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["kind"] == "knob")
        .unwrap()
        .clone();
    assert_eq!(pull["unitPrice"], 7.25);
    assert_eq!(list["totals"]["hardwareCost"], 7.25 * pull["qty"].as_f64().unwrap());
}

#[test]
fn the_cut_list_cuts_from_the_users_stock_on_hand() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "nightstand" }));
    let id = started["projectId"].as_i64().unwrap();
    let sheets = |list: &serde_json::Value| list["totals"]["sheetCount"].as_u64().unwrap();
    let before = sheets(&ok(&w, "get_cut_list", json!({ "project_id": id })));
    w.store()
        .set_setting(
            "offcuts",
            &json!([{ "id": "o1", "material": "Birch Plywood (drawer parts)", "thickness": 0.5, "l": 30, "w": 26 }]),
        )
        .unwrap();
    let list = ok(&w, "get_cut_list", json!({ "project_id": id }));
    assert_eq!(sheets(&list), before - 1);
    let drawer = list["sheets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["materialName"] == "Birch Plywood (drawer parts)")
        .unwrap();
    assert_eq!(drawer["offcuts"][0]["id"], "o1");
}

/// Lock parts as the editor does when the user adjusts them by hand.
fn lock(w: &Woodshop, project: i64, ids: &[&str]) {
    let store = w.store();
    let mut draft = woodshop_core::spec::to_value(&store.get_project(project).unwrap().draft);
    for part in draft["parts"].as_array_mut().unwrap() {
        if ids.iter().any(|id| part["id"] == *id) {
            part["locked"] = true.into();
        }
    }
    let spec = woodshop_core::spec::parse(draft).unwrap();
    store.save_draft(project, &spec, None).unwrap();
}

#[test]
fn parts_the_user_locked_are_left_exactly_as_they_are() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "bookshelf" }));
    let id = started["projectId"].as_i64().unwrap();
    lock(&w, id, &["p_shelf_1", "p_shelf_2"]);
    let before = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    assert_eq!(part(&w, id, "p_shelf_1")["locked"], true, "agents can see the lock");

    let refused = err(
        &w,
        "resize_part",
        json!({ "project_id": id, "part_id": "p_shelf_1", "length": 30 }),
    );
    assert_eq!(
        refused,
        "That change would have changed \"Shelf 1\", which the user has locked: it was adjusted by \
         hand in the editor, so agents leave it exactly as it is. Nothing was written. Make the \
         change without touching it, or ask the user to unlock it (the lock beside the part's name \
         in the Inspector)."
    );
    for (tool, args) in [
        (
            "rename_part",
            json!({ "project_id": id, "part_id": "p_shelf_1", "name": "Top shelf" }),
        ),
        ("delete_part", json!({ "project_id": id, "part_id": "p_shelf_2" })),
        (
            "set_part_species",
            json!({ "project_id": id, "part_id": "p_shelf_1", "species": "walnut" }),
        ),
    ] {
        let refused = err(&w, tool, args);
        assert!(refused.contains("which the user has locked"), "{tool}: {refused}");
    }

    // A batch that touches a locked part is refused whole, naming each one.
    let refused = err(
        &w,
        "edit_parts",
        json!({ "project_id": id, "edits": [
            { "part_id": "p_top", "name": "Lid" },
            { "part_id": "p_shelf_1", "name": "A" },
            { "part_id": "p_shelf_2", "name": "B" },
        ] }),
    );
    assert!(
        refused.starts_with(
            "That change would have changed \"Shelf 1\" and \"Shelf 2\", which the user has locked: \
             they were adjusted by hand in the editor, so agents leave them exactly as they are."
        ),
        "{refused}"
    );
    assert_eq!(
        ok(&w, "get_design", json!({ "project_id": id }))["spec"],
        before,
        "nothing was written"
    );

    // The parts around them are still the agent's to change.
    ok(
        &w,
        "rename_part",
        json!({ "project_id": id, "part_id": "p_top", "name": "Lid" }),
    );
    assert_eq!(part(&w, id, "p_top")["name"], "Lid");
    assert_eq!(part(&w, id, "p_shelf_1"), before["parts"][4]);
}

#[test]
fn a_material_takes_the_thickness_its_stock_measures_and_its_dados_follow() {
    let w = woodshop();
    let id = ok(&w, "start_from_template", json!({ "template": "record-stand" }))["projectId"]
        .as_i64()
        .unwrap();
    let set = |thickness: f64| json!({ "project_id": id, "material_id": "mat_bb18", "thickness": thickness });

    let done = ok(&w, "set_material_thickness", set(0.71875));
    assert_eq!(
        done["summary"],
        "Set \"Baltic Birch 18mm\" to 0.71875\" thick, and resized 2 joint cuts to match."
    );
    let design = ok(&w, "get_design", json!({ "project_id": id }));
    assert_eq!(design["spec"]["materials"][0]["thickness"], 0.71875);
    for side in ["p_side_l", "p_side_r"] {
        let dado = &part(&w, id, side)["ops"][0];
        assert_eq!(
            (dado["type"].as_str(), dado["width"].as_f64()),
            (Some("dado"), Some(0.71875))
        );
    }

    assert!(err(&w, "set_material_thickness", set(0.71875)).contains("is already 0.71875\" thick"));
    assert!(
        err(
            &w,
            "set_material_thickness",
            json!({ "project_id": id, "material_id": "nope", "thickness": 0.5 })
        )
        .starts_with("No material \"nope\"")
    );

    // A side the user locked keeps its dado, so the change is refused whole.
    lock(&w, id, &["p_side_l"]);
    let refused = err(&w, "set_material_thickness", set(0.75));
    assert!(refused.contains("which the user has locked"), "{refused}");
    assert_eq!(
        ok(&w, "get_design", json!({ "project_id": id }))["spec"]["materials"][0]["thickness"],
        0.71875
    );
}

#[test]
fn a_thickness_that_would_leave_parts_apart_is_refused() {
    let w = woodshop();
    let id = ok(&w, "start_from_template", json!({ "template": "record-stand" }))["projectId"]
        .as_i64()
        .unwrap();
    let refused = err(
        &w,
        "set_material_thickness",
        json!({ "project_id": id, "material_id": "mat_bb18", "thickness": 0.25 }),
    );
    assert!(
        refused.starts_with("That change would make the design unbuildable") && refused.contains("only overlaps it"),
        "{refused}"
    );
    assert_eq!(
        ok(&w, "get_design", json!({ "project_id": id }))["spec"]["materials"][0]["thickness"],
        0.709
    );
}

#[test]
fn the_whole_piece_is_drawn_with_its_sizes() {
    let w = woodshop();
    let id = ok(&w, "start_from_template", json!({ "template": "bookshelf" }))["projectId"]
        .as_i64()
        .unwrap();
    let front = ok(&w, "render_drawing", json!({ "project_id": id, "view": "front" }));
    let svg = front["svg"].as_str().unwrap();
    assert!(svg.starts_with("<svg") && svg.contains(">72\"</text>") && svg.contains(">17 1/4\"</text>"));
    assert!(svg.contains("data-part=\"Shelf 2\""));
    assert!(err(&w, "render_drawing", json!({ "project_id": id, "view": "back" })).contains("front"));
}

#[test]
fn deleting_a_part_takes_it_out_of_your_build_steps() {
    let w = woodshop();
    let id = ok(&w, "start_from_template", json!({ "template": "bookshelf" }))["projectId"]
        .as_i64()
        .unwrap();
    {
        let store = w.store();
        let mut draft = woodshop_core::spec::to_value(&store.get_project(id).unwrap().draft);
        draft["meta"]["buildSteps"] = json!([
            { "heading": "Box", "partIds": ["p_bottom", "p_side_l", "p_side_r", "p_top", "p_back"] },
            { "heading": "Shelves", "partIds": ["p_shelf_1", "p_shelf_2", "p_shelf_3"] }
        ]);
        store
            .save_draft(id, &woodshop_core::spec::parse(draft).unwrap(), None)
            .unwrap();
    }
    ok(&w, "delete_part", json!({ "project_id": id, "part_id": "p_shelf_2" }));
    let design = ok(&w, "get_design", json!({ "project_id": id }));
    assert_eq!(
        design["spec"]["meta"]["buildSteps"][1]["partIds"],
        json!(["p_shelf_1", "p_shelf_3"])
    );
    let check = ok(&w, "check_design", json!({ "project_id": id }));
    assert!(!check.to_string().contains("build-step"), "{check}");
}

#[test]
fn a_quick_build_starts_a_sound_design() {
    let w = woodshop();
    let built = ok(
        &w,
        "quick_build",
        json!({ "kind": "shelfUnit", "width": 30, "height": 48, "depth": 12, "shelves": 3 }),
    );
    assert_eq!(built["name"], "Shelf unit");
    let id = built["projectId"].as_i64().unwrap();
    let check = ok(&w, "check_design", json!({ "project_id": id }));
    assert_eq!(check["buildable"], true, "{check}");
    assert_eq!(check["warnings"], json!([]), "{check}");
    let refused = err(
        &w,
        "quick_build",
        json!({ "kind": "box", "width": 96, "height": 60, "depth": 30 }),
    );
    assert!(refused.contains("bigger than a 96\" × 48\" sheet"), "{refused}");
}

#[test]
fn a_material_can_be_painted_and_back_to_bare_wood() {
    let w = woodshop();
    let id = ok(&w, "start_from_template", json!({ "template": "record-stand" }))["projectId"]
        .as_i64()
        .unwrap();
    let paint = json!({ "project_id": id, "material_id": "mat_bb18", "kind": "paint",
        "color": "#8A9A5B", "name": "Sage green" });
    let done = ok(&w, "set_material_appearance", paint);
    assert_eq!(done["summary"], "\"Baltic Birch 18mm\" is now paint, Sage green.");
    let material = &ok(&w, "get_design", json!({ "project_id": id }))["spec"]["materials"][0];
    assert_eq!(
        material["appearance"],
        json!({ "kind": "paint", "color": "#8A9A5B", "name": "Sage green" })
    );

    let bad = json!({ "project_id": id, "material_id": "mat_bb18", "kind": "paint", "color": "green" });
    assert!(err(&w, "set_material_appearance", bad).starts_with("color must be #rrggbb"));

    let bare = json!({ "project_id": id, "material_id": "mat_bb18", "kind": "wood" });
    ok(&w, "set_material_appearance", bare);
    let material = &ok(&w, "get_design", json!({ "project_id": id }))["spec"]["materials"][0];
    assert!(material.get("appearance").is_none(), "{material}");
}

#[test]
fn hardware_comes_off_a_part_in_one_call_and_goes_with_a_replaced_part() {
    let w = woodshop();
    let started = ok(&w, "start_design", json!({ "name": "Cart", "material_type": "lumber" }));
    let id = started["projectId"].as_i64().unwrap();
    let material = started["spec"]["materials"][0]["id"].as_str().unwrap().to_owned();
    let base = started["spec"]["parts"][0]["id"].as_str().unwrap().to_owned();
    let hooks = |w: &Woodshop| {
        for _ in 0..2 {
            ok(
                w,
                "add_hardware",
                json!({ "project_id": id, "item": "hook.coat-single", "part_id": base }),
            );
        }
    };
    let mounted = |w: &Woodshop| {
        ok(w, "get_design", json!({ "project_id": id }))["spec"]["hardware"]
            .as_array()
            .map_or(0, Vec::len)
    };

    hooks(&w);
    assert_eq!(mounted(&w), 2);
    let removed = ok(&w, "delete_hardware", json!({ "project_id": id, "part_id": base }));
    assert!(
        removed["summary"].as_str().unwrap().contains("Removed 2 pieces"),
        "{removed}"
    );
    assert_eq!(mounted(&w), 0);
    assert!(err(&w, "delete_hardware", json!({ "project_id": id, "part_id": base })).contains("nothing to remove"));
    assert!(err(&w, "delete_hardware", json!({ "project_id": id })).contains("either"));

    // Replacing the parts keeps what is on a part whose id comes back, and drops the rest.
    hooks(&w);
    let same = json!({ "id": base, "name": "Base", "material_id": material, "length": 24, "width": 3.5, "pos": [0, 0.75, 0], "rot": [90, 0, 0] });
    ok(
        &w,
        "add_parts",
        json!({ "project_id": id, "replace_parts": true, "parts": [same] }),
    );
    assert_eq!(mounted(&w), 2);
    let other = json!({ "id": "p_deck", "name": "Deck", "material_id": material, "length": 24, "width": 3.5, "pos": [0, 0.75, 0], "rot": [90, 0, 0] });
    ok(
        &w,
        "add_parts",
        json!({ "project_id": id, "replace_parts": true, "parts": [other] }),
    );
    assert_eq!(mounted(&w), 0);

    // The short cut list: what to cut and buy, and a pointer to the rest.
    let short = ok(&w, "get_cut_list", json!({ "project_id": id, "detail": "summary" }));
    let mut keys: Vec<&str> = short.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["hardware", "more", "name", "projectId", "sections", "tools", "totals"]
    );
    assert!(err(&w, "get_cut_list", json!({ "project_id": id, "detail": "brief" })).contains("summary"));
}

#[test]
fn a_wing_is_a_leaf_with_hinges_and_folding_brackets() {
    let w = woodshop();
    let started = ok(
        &w,
        "start_design",
        json!({ "name": "Saw cart", "material_type": "sheet" }),
    );
    let id = started["projectId"].as_i64().unwrap();
    let material = started["spec"]["materials"][0]["id"].as_str().unwrap().to_owned();
    let base = started["spec"]["parts"][0]["id"].as_str().unwrap().to_owned();
    let base_part = part(&w, id, &base);
    let (l, pos) = (
        base_part["size"]["l"].as_f64().unwrap(),
        base_part["transform"]["pos"].clone(),
    );
    let rot = base_part["transform"]["rot"].clone();
    // A 24"-deep wing butted to the base's +X end, level with it.
    let x = pos[0].as_f64().unwrap() + l / 2.0 + 12.0;
    ok(
        &w,
        "add_part",
        json!({ "project_id": id, "id": "p_wing", "name": "Wing", "material_id": material, "length": 24, "width": base_part["size"]["w"], "pos": [x, pos[1], pos[2]], "rot": rot }),
    );
    assert!(
        err(
            &w,
            "add_movable",
            json!({ "project_id": id, "kind": "leaf", "part_ids": ["p_wing"], "anchor_part_id": "p_wing" })
        )
        .contains("hinge_edge")
    );
    assert!(
        err(&w, "add_movable", json!({ "project_id": id, "kind": "leaf", "part_ids": ["p_wing"], "anchor_part_id": "p_wing", "hinge_edge": "w0", "support": "caster.swivel-3in" }))
            .contains("not a folding bracket")
    );
    let added = ok(
        &w,
        "add_movable",
        json!({ "project_id": id, "kind": "leaf", "part_ids": ["p_wing"], "anchor_part_id": "p_wing", "hinge_edge": "w0", "support": "bracket.folding-16in", "name": "Right wing" }),
    );
    assert!(added["summary"].as_str().unwrap().contains("leaf"), "{added}");
    let movable = ok(&w, "get_design", json!({ "project_id": id }))["spec"]["movables"][0].clone();
    assert_eq!(movable["kind"], "leaf");
    assert_eq!(movable["leafPartId"], "p_wing");
    assert!(
        movable.get("style").is_none() && movable.get("pull").is_none(),
        "{movable}"
    );

    let cut = ok(&w, "get_cut_list", json!({ "project_id": id, "detail": "summary" }));
    assert!(
        cut["hardware"].to_string().contains("16\\\" folding shelf brackets"),
        "{}",
        cut["hardware"]
    );
    assert!(
        err(
            &w,
            "update_movable",
            json!({ "project_id": id, "movable_id": movable["id"], "pull": "none" })
        )
        .contains("no style or pull")
    );
    ok(
        &w,
        "update_movable",
        json!({ "project_id": id, "movable_id": movable["id"], "support": "bracket.folding-20in" }),
    );
    // Hung on its brackets alone, as on a miter-saw cart: no hinges on the list.
    ok(
        &w,
        "update_movable",
        json!({ "project_id": id, "movable_id": movable["id"], "hinge": "none" }),
    );
    let cut = ok(&w, "get_cut_list", json!({ "project_id": id, "detail": "summary" }));
    assert!(!cut["hardware"].to_string().contains("hinge"), "{}", cut["hardware"]);
    // A door can't go without hinges.
    ok(
        &w,
        "add_part",
        json!({ "project_id": id, "id": "p_door", "name": "Door", "material_id": material, "length": 12, "width": 12, "pos": [pos[0], pos[1].as_f64().unwrap() - 12.0, 0] }),
    );
    assert!(
        err(&w, "add_movable", json!({ "project_id": id, "kind": "door", "part_ids": ["p_door"], "anchor_part_id": "p_door", "hinge_edge": "w0", "hinge": "none" }))
            .contains("Only a leaf")
    );
    // Deleting the wing takes the leaf with it.
    ok(&w, "delete_part", json!({ "project_id": id, "part_id": "p_wing" }));
    let after = ok(&w, "get_design", json!({ "project_id": id }))["spec"]["movables"].clone();
    assert!(after.as_array().is_none_or(Vec::is_empty), "{after}");
}

#[test]
fn a_tote_is_placed_moved_and_removed_as_a_prop_and_never_counted() {
    let w = woodshop();
    let started = ok(&w, "start_design", json!({ "name": "Rack", "material_type": "lumber" }));
    let id = started["projectId"].as_i64().unwrap();
    let base = started["spec"]["parts"][0]["id"].as_str().unwrap().to_owned();
    let before = ok(&w, "get_cut_list", json!({ "project_id": id }))["hardware"].clone();

    let props = ok(&w, "list_hardware", json!({ "category": "props" }))["items"].clone();
    assert!(props.to_string().contains("prop.tote-hdx-27gal"), "{props}");
    assert!(
        err(
            &w,
            "add_hardware",
            json!({ "project_id": id, "item": "prop.tote-hdx-27gal", "part_id": base })
        )
        .contains("add_prop")
    );
    assert!(
        err(
            &w,
            "add_prop",
            json!({ "project_id": id, "item": "hook.coat-single", "pos": [0, 0, 0] })
        )
        .contains("add_hardware")
    );
    assert!(
        err(
            &w,
            "add_prop",
            json!({ "project_id": id, "item": "prop.tote-hdx-27gal", "pos": [0, 0, 0], "accent": "yellow" })
        )
        .contains("#rrggbb")
    );

    assert!(
        err(
            &w,
            "add_prop",
            json!({ "project_id": id, "model": "m_box", "pos": [0, 0, 0] })
        )
        .contains("No model")
    );
    assert!(err(&w, "add_prop", json!({ "project_id": id, "pos": [0, 0, 0] })).contains("Give one of"));
    let placed = ok(
        &w,
        "add_prop",
        json!({ "project_id": id, "item": "prop.tote-hdx-27gal", "pos": [0, 2, 0], "rot": 90, "name": "Tote" }),
    );
    assert!(
        placed["summary"].as_str().unwrap().contains("pr_tote_hdx_27gal"),
        "{placed}"
    );
    ok(
        &w,
        "update_prop",
        json!({ "project_id": id, "prop_id": "pr_tote_hdx_27gal", "pos": [1, 2, 3], "rot": 0, "accent": "#ff0000" }),
    );
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    let prop = &spec["props"][0];
    assert_eq!(prop["pos"], json!([1, 2, 3]));
    assert!(prop.get("rot").is_none(), "a zero turn is left out: {prop}");
    assert_eq!(prop["accent"], "#ff0000");
    ok(
        &w,
        "update_prop",
        json!({ "project_id": id, "prop_id": "pr_tote_hdx_27gal", "accent": "catalog" }),
    );
    let spec = ok(&w, "get_design", json!({ "project_id": id }))["spec"].clone();
    assert!(spec["props"][0].get("accent").is_none());

    // Never in the hardware list.
    assert_eq!(ok(&w, "get_cut_list", json!({ "project_id": id }))["hardware"], before);

    ok(
        &w,
        "delete_prop",
        json!({ "project_id": id, "prop_id": "pr_tote_hdx_27gal" }),
    );

    // A shape sized by hand; a bad one is turned down by the schema.
    let bin = ok(
        &w,
        "add_prop",
        json!({ "project_id": id, "shape": { "kind": "box", "l": 16, "w": 11, "h": 7, "open": true }, "pos": [0, 0, 20] }),
    );
    assert!(bin["summary"].as_str().unwrap().contains("Placed Bin"), "{bin}");
    assert!(
        !err(
            &w,
            "add_prop",
            json!({ "project_id": id, "shape": { "kind": "crate", "h": 7 }, "pos": [0, 0, 0] })
        )
        .is_empty()
    );
    assert!(
        err(
            &w,
            "delete_prop",
            json!({ "project_id": id, "prop_id": "pr_tote_hdx_27gal" })
        )
        .contains("No prop")
    );
}

#[test]
fn the_cut_list_names_the_tools_for_the_build() {
    let w = woodshop();
    let started = ok(&w, "start_from_template", json!({ "template": "record-stand-dado" }));
    let id = started["projectId"].as_i64().unwrap();
    for detail in ["full", "summary"] {
        let list = ok(&w, "get_cut_list", json!({ "project_id": id, "detail": detail }));
        let tools = list["tools"].as_array().unwrap();
        let dado = tools.iter().find(|t| t["name"] == "Router or dado stack").unwrap();
        assert_eq!(dado["required"], true);
        assert!(dado["detail"].as_str().unwrap().contains("wide"), "{dado}");
        assert!(
            tools.iter().any(|t| t["required"] == false),
            "{detail}: no nice-to-have"
        );
    }
}
