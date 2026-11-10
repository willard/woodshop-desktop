//! Read-only tools: the authoring contract, the library, one design, its cut list, whether it is
//! buildable, where its parts sit, and full-size part drawings. None of them write anything.

use serde_json::{Map, Value, json};
use woodshop_core::cutlist::{CutListConfig, compute_cut_list, grouping::group_cut_list, stock_advice::stock_advice};
use woodshop_core::geometry::frame::{
    Aabb, axis_map, face_map, obb_penetration, overall_size, php_float, rotation_rows, round_to, to_world, world_aabb,
};
use woodshop_core::geometry::op_extent::{datum_note, local_box};
use woodshop_core::geometry::outline_svg;
use woodshop_core::lint::{self, LintIssue, Severity};
use woodshop_core::spec::{self, MaterialType, Part, Spec, catalog, validate};
use woodshop_core::units::fraction::inch_label;

use super::*;
use crate::CONVENTIONS;
use crate::ctx::{compact, plural};

pub const GET_CONVENTIONS: ToolDef = ToolDef {
    name: "get_conventions",
    description: "The authoring contract for Woodshop designs — CALL THIS FIRST, before add_op or \
        add_parts. With no arguments it returns the build conventions (§3.1: the local part frame, the \
        rot recipes saying which world axis a part's length and width land on, the datum every op \
        measures from, and the connectivity/fastening rules the linter enforces), plus the exact \
        signature of every op type and the values `edge`, `face` and joint `type` accept. Pass `op` \
        (e.g. \"curve\", \"notch\", \"ease\", \"dado\") for just that op: every variant, its required and \
        optional fields, each field's allowed values and bounds, and what the field means. Generated \
        from the schema the validator uses, so it is never out of date. Read-only: nothing is written, \
        no design is touched.",
    read_only: true,
    schema: || {
        object(
            json!({ "op": string(
                "One op type to describe in full — dado, groove, rabbet, hole, pocketHoles, screws, \
                 miter, curve, notch or ease. Omit for the whole contract."
            ) }),
            &[],
        )
    },
    run: get_conventions,
};

fn get_conventions(_: &Woodshop, args: &Args) -> Outcome {
    let enums: Map<String, Value> = catalog::enums()
        .into_iter()
        .map(|(name, info)| (name.to_owned(), json!(info)))
        .collect();
    let Some(ty) = args.opt_str("op")? else {
        let ops: Map<String, Value> = catalog::types()
            .into_iter()
            .map(|t| (t.clone(), json!(catalog::signatures(&t))))
            .collect();
        return Ok(json!({
            "conventions": CONVENTIONS,
            "opTypes": catalog::types(),
            "ops": ops,
            "enums": enums,
            "next": "Call get_conventions with `op` (e.g. {\"op\":\"curve\"}) for one op type in full: \
                     every variant, its fields, their bounds and what they mean.",
        }));
    };
    if !catalog::types().iter().any(|t| t == ty) {
        return Err(format!(
            "There is no \"{ty}\" op. The op types are: {}.",
            catalog::types().join(", ")
        ));
    }
    let variants: Vec<Value> = catalog::for_type(ty)
        .into_iter()
        .map(|v| {
            let fields: Map<String, Value> = v
                .fields
                .iter()
                .filter(|(name, _)| name != "type")
                .map(|(name, f)| {
                    let allowed = f.get("enum").cloned().or_else(|| f.get("const").map(|c| json!([c])));
                    let min = f.get("minimum").or_else(|| f.get("exclusiveMinimum")).cloned();
                    (
                        name.clone(),
                        compact(json!({
                            "allowed": allowed,
                            "type": f.get("type"),
                            "min": min,
                            "max": f.get("maximum"),
                            "description": f.get("description"),
                        })),
                    )
                })
                .collect();
            let mut entry = compact(json!({
                "variant": v.variant,
                "required": v.required,
                "fields": fields,
                "description": v.description,
            }));
            if !v.optional.is_empty() {
                entry["optional"] = json!(v.optional);
            }
            entry
        })
        .collect();
    Ok(json!({
        "op": ty,
        "signatures": catalog::signatures(ty),
        "discriminator": catalog::discriminator_for(ty),
        "variants": variants,
        "enums": enums,
        "next": "Call get_conventions with no arguments for the full §3.1 contract — the local part frame, \
                 the rot recipes, and the datum these offsets measure from.",
    }))
}

pub const LIST_PROJECTS: ToolDef = ToolDef {
    name: "list_projects",
    description: "List the Woodshop furniture designs in this computer's library — each with its id, \
        name, part count, and last-updated time. Call this first to find the id of a design before \
        reading or editing it. Read-only.",
    read_only: true,
    schema: || object(json!({}), &[]),
    run: |w, _| {
        let projects = w.store().list_projects(false).map_err(|e| e.to_string())?;
        let rows: Vec<Value> = projects
            .into_iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "name": p.name,
                    "partCount": p.part_count,
                    "updatedAt": crate::ctx::iso8601(p.updated_at),
                })
            })
            .collect();
        Ok(json!({ "projects": rows }))
    },
};

pub const GET_DESIGN: ToolDef = ToolDef {
    name: "get_design",
    description: "Fetch the full parametric spec — the JSON document Woodshop renders and builds cut \
        lists from — for one design by its id. All dimensions are decimal inches. Returns an error if \
        the design does not exist. Read-only.",
    read_only: true,
    schema: || {
        object(
            json!({ "project_id": integer("The id of the design to fetch (from list_projects).") }),
            &["project_id"],
        )
    },
    run: |w, args| {
        let design = w.load(args.project_id("Provide the id of the design to fetch (see list_projects).")?)?;
        Ok(json!({
            "projectId": design.id(),
            "id": design.id(),
            "name": design.name(),
            "partCount": design.spec().parts.len(),
            "spec": design.draft,
        }))
    },
};

pub const GET_CUT_LIST: ToolDef = ToolDef {
    name: "get_cut_list",
    description: "Get the full cut list for a design by id: every part with its dimensions (decimal \
        inches), quantity, and board feet; the sheet-goods layout (how many sheets and where each part \
        is placed, grain- and kerf-aware); lumber stock cutting; and totals — board feet, sheet count, \
        estimated cost, and waste. `sections` is the shop-friendly view of the same data: identical \
        blanks merged into one row with a quantity, bucketed per material into sheet goods and lumber, \
        each with the stock to buy. Shaped parts carry the ops that shape them, with a pointer to \
        render_preview for the full-size outline. `hardware` counts the screws, pocket screws and \
        dowels, estimating from a recorded joint when no fastener op places them. `stockAdvice` names a \
        smaller panel when a sheet is mostly offcut. Matches what the app shows. Read-only.",
    read_only: true,
    schema: || object(json!({ "project_id": integer(PROJECT_ID) }), &["project_id"]),
    run: get_cut_list,
};

fn get_cut_list(w: &Woodshop, args: &Args) -> Outcome {
    let design = w.load(args.project_id(PROVIDE_PROJECT)?)?;
    let spec = design.spec();
    let built = compute_cut_list(spec, CutListConfig::default());
    let mut payload = json!({ "projectId": design.id(), "name": design.name() });
    let body = spec::to_value(&built);
    for (key, value) in body.as_object().into_iter().flatten() {
        payload[key] = value.clone();
    }
    // Shaped parts carry the ops that shape them: `notched: true` alone is nothing a shop can
    // work from. Scalars only; the full geometry is one render_preview away.
    if let Some(rows) = payload["parts"].as_array_mut() {
        for row in rows {
            let part_id = row["partId"].as_str().unwrap_or_default().to_owned();
            let ops = crate::ctx::find(&design.draft, "parts", &part_id)
                .and_then(|p| p["ops"].as_array())
                .filter(|ops| !ops.is_empty());
            if let Some(ops) = ops {
                let scalars: Vec<Value> = ops
                    .iter()
                    .map(|op| {
                        let mut op = op.clone();
                        if let Some(m) = op.as_object_mut() {
                            m.retain(|_, v| !v.is_null() && !v.is_array() && !v.is_object());
                        }
                        op
                    })
                    .collect();
                row["ops"] = json!(scalars);
                row["outline"] =
                    format!("Call render_preview with part_id \"{part_id}\" for the full-size outline of this part.")
                        .into();
            }
        }
    }
    payload["sections"] = json!(group_cut_list(&built));
    let advice = stock_advice(&built, spec);
    if !advice.is_empty() {
        payload["stockAdvice"] = json!(advice);
    }
    Ok(payload)
}

pub const CHECK_DESIGN: ToolDef = ToolDef {
    name: "check_design",
    description: "Check whether a design is buildable, WITHOUT changing it. Runs the same schema \
        validation and buildability linter the editing tools run, and reports every finding with its \
        rule code: floating parts, unfastened parts, ops that do not fit their part, parts that pierce \
        another, dado widths that do not match the mate, dead joint references. Also returns the \
        assembled piece's overall width × depth × height in inches, so you can check it against the \
        plan you were given. Call it after a run of authoring calls to confirm the design actually \
        holds together, or on a design you did not author before editing it. Read-only.",
    read_only: true,
    schema: || {
        object(
            json!({ "project_id": integer("The id of the design to check (from list_projects).") }),
            &["project_id"],
        )
    },
    run: check_design,
};

/// Enough to act on without flooding the context window.
const MAX_FINDINGS: usize = 25;

fn check_design(w: &Woodshop, args: &Args) -> Outcome {
    let design = w.load(args.project_id("Provide the id of the design to check (see list_projects).")?)?;
    let spec = design.spec();
    let mut payload = json!({
        "projectId": design.id(),
        "name": design.name(),
        "partCount": spec.parts.len(),
        "specVersion": spec.spec_version,
        "overall": overall_size(spec),
    });
    if let Err(errors) = validate::validate(&design.draft) {
        payload["buildable"] = false.into();
        payload["schemaErrors"] = json!(errors.into_iter().take(MAX_FINDINGS).collect::<Vec<_>>());
        payload["summary"] = "This design does not match the spec schema, so the linter could not run. \
                              Fix the structural problems first."
            .into();
        return Ok(payload);
    }
    let mut issues = lint::lint(spec);
    issues.extend(lint::duplicate_placements(spec));
    let errors = findings(&issues, Severity::Error);
    let warnings = findings(&issues, Severity::Warn);
    let warned = if warnings.is_empty() {
        String::new()
    } else {
        format!(" {} warning{} worth a look.", warnings.len(), plural(warnings.len()))
    };
    payload["buildable"] = errors.is_empty().into();
    payload["summary"] = if errors.is_empty() {
        format!("Buildable: no errors.{warned}")
    } else {
        format!(
            "Not buildable: {} error{} must be fixed before this can be built.{warned}",
            errors.len(),
            plural(errors.len())
        )
    }
    .into();
    payload["errors"] = json!(errors.into_iter().take(MAX_FINDINGS).collect::<Vec<_>>());
    payload["warnings"] = json!(warnings.into_iter().take(MAX_FINDINGS).collect::<Vec<_>>());
    Ok(payload)
}

fn findings(issues: &[LintIssue], severity: Severity) -> Vec<Value> {
    issues
        .iter()
        .filter(|i| i.severity == severity)
        .map(|i| {
            compact(json!({
                "code": i.code,
                "message": i.message,
                "partId": i.part_id,
                "opIndex": i.op_index,
                "jointIndex": i.joint_index,
            }))
        })
        .collect()
}

pub const EXPLAIN_PART: ToolDef = ToolDef {
    name: "explain_part",
    description: "Show where a part and each of its ops actually sit in world inches — the check you \
        would otherwise need a rendered screenshot for. Returns the part's size and transform, its \
        world bounding box, WHICH WORLD AXIS its local length, width and thickness land on after \
        rotation (on a part rotated [0,90,0] the length runs along world -Z, so an op measured 1.25\" \
        along it lands 1.25\" from the front), and for every op its index, type, the datum its offsets \
        count from, and the world box it occupies. Pass part_id for one part, or omit it for every part \
        in the design. Read-only.",
    read_only: true,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("One part to explain (from get_design). Omit for every part."),
            }),
            &["project_id"],
        )
    },
    run: explain_part,
};

/// Enough to read a design without a wall of numbers; ask per part beyond this.
const MAX_EXPLAINED: usize = 40;

fn explain_part(w: &Woodshop, args: &Args) -> Outcome {
    let design = w.load(args.project_id("Provide the id of the design to explain (see list_projects).")?)?;
    let spec = design.spec();
    let parts: Vec<&Part> = match args.opt_str("part_id")? {
        Some(id) => {
            let part = spec.part(id).ok_or_else(|| no_such_part(spec, id))?;
            vec![part]
        }
        None => spec.parts.iter().collect(),
    };
    let mut payload = json!({
        "projectId": design.id(),
        "name": design.name(),
        "frame": "World inches, y up. Local frame per §3.1: length = +X, width = +Y, thickness = +Z, \
                  origin at the part centre. The direction words in `localAxesInWorld` are from the \
                  editor's default viewpoint — looking at the piece from +Z, so +Z is front, +X is right, \
                  +Y is up. An axis more than about a degree off square is reported as its components \
                  and marked oblique, because a splayed leg genuinely points nowhere in particular.",
        "parts": parts.iter().take(MAX_EXPLAINED).map(|p| explain(p, spec)).collect::<Vec<_>>(),
    });
    if parts.len() > MAX_EXPLAINED {
        payload["truncated"] =
            format!("Showing the first {MAX_EXPLAINED} parts. Pass part_id for a specific one.").into();
    }
    Ok(payload)
}

fn no_such_part(spec: &Spec, id: &str) -> String {
    let ids: Vec<&str> = spec.parts.iter().map(|p| p.id.as_str()).collect();
    format!("No part \"{id}\" in this design. Its parts are: {}.", ids.join(", "))
}

fn thickness_of(spec: &Spec, part: &Part) -> f64 {
    spec.material(&part.material_id).map(|m| m.thickness).unwrap_or(0.0)
}

fn explain(part: &Part, spec: &Spec) -> Value {
    let thickness = thickness_of(spec, part);
    let overlapping: Vec<Value> = spec
        .parts
        .iter()
        .filter(|other| other.id != part.id)
        .filter_map(|other| {
            let pen = obb_penetration(part, thickness, other, thickness_of(spec, other));
            (pen > 0.02).then(|| json!({ "partId": other.id, "name": other.name, "penetration": round_to(pen, 3) }))
        })
        .collect();
    let (length, width, thick) = axis_map(part);
    let (front, back) = face_map(part);
    let rotation = rotation_rows(part.transform.rot());
    let ops: Vec<Value> = part
        .ops
        .iter()
        .flatten()
        .enumerate()
        .map(|(index, op)| {
            let raw = spec::to_value(op);
            let local = local_box(op, part, thickness);
            compact(json!({
                "index": index,
                "type": raw["type"],
                "edge": raw.get("edge"),
                "face": raw.get("face"),
                "datum": datum_note(op),
                "world": local.map(|b| range(&world_of(&b, part, &rotation))),
                "note": local.is_none().then_some("This op has no footprint to resolve — it carries no position."),
            }))
        })
        .collect();
    let mut out = json!({
        "id": part.id,
        "name": part.name,
        "size": { "length": part.size.l, "width": part.size.w, "thickness": thickness },
        "materialId": part.material_id,
        "transform": spec::to_value(&part.transform),
        // The sentence that makes `from`/`to` readable on a rotated part.
        "localAxesInWorld": { "length": length, "width": width, "thickness": thick },
        "facesInWorld": { "front": front, "back": back },
        "world": range(&world_aabb(part, thickness)),
        "ops": ops,
    });
    if !overlapping.is_empty() {
        out["overlappingParts"] = json!(overlapping);
    }
    out
}

/// A local-frame box in world inches: its eight corners transformed and re-bounded, because a
/// rotated box is not axis-aligned.
fn world_of(local: &Aabb, part: &Part, rotation: &woodshop_core::geometry::frame::Mat3) -> Aabb {
    let mut out = Aabb::EMPTY;
    for xi in [local.min[0], local.max[0]] {
        for yi in [local.min[1], local.max[1]] {
            for zi in [local.min[2], local.max[2]] {
                out.include(to_world(part, rotation, [xi, yi, zi]));
            }
        }
    }
    out
}

/// A world box as the three ranges a person reads off a drawing: `"x": "-6…-5.25"`. Three
/// decimals — past that it is float dust, not a measurement anyone can cut to.
fn range(b: &Aabb) -> Value {
    let r = |i: usize| {
        format!(
            "{}…{}",
            php_float(round_to(b.min[i], 3)),
            php_float(round_to(b.max[i], 3))
        )
    };
    json!({ "x": r(0), "y": r(1), "z": r(2) })
}

pub const RENDER_PREVIEW: ToolDef = ToolDef {
    name: "render_preview",
    description: "Draw a part full-size as an SVG shop template — the outline you would cut, with the \
        rectangular blank behind it, holes and channels marked, and dimensions in fractional inches. \
        Pass part_id for one part at 1:1 (printable at 100% as a cutting pattern); omit it for an index \
        of every part with its blank size and op count, so you can pick one. This is how you check a \
        shape you cannot see: whether a cradle is deep enough to hold anything, whether a curve leaves \
        the notch beside it intact. Elements carry data-op-index and data-op-type, so you can cite what \
        you find without parsing path data. Read-only.",
    read_only: true,
    schema: || {
        object(
            json!({
                "project_id": integer(PROJECT_ID),
                "part_id": string("The part to draw full-size (from get_design). Omit for an index of every part."),
            }),
            &["project_id"],
        )
    },
    run: render_preview,
};

/// A heavily-notched part runs a few KB; past this, the index is more useful than a drawing.
const MAX_SVG_BYTES: usize = 262_144;

fn render_preview(w: &Woodshop, args: &Args) -> Outcome {
    let design = w.load(args.project_id("Provide the id of the design to draw (see list_projects).")?)?;
    let spec = design.spec();
    let Some(part_id) = args.opt_str("part_id")? else {
        return Ok(json!({
            "projectId": design.id(),
            "name": design.name(),
            "parts": spec.parts.iter().map(|p| summarise(p, spec)).collect::<Vec<_>>(),
            "next": "Call render_preview again with `part_id` for that part's full-size drawing.",
        }));
    };
    let part = spec.part(part_id).ok_or_else(|| no_such_part(spec, part_id))?;
    let material = spec.material(&part.material_id);
    let thickness = material.map(|m| m.thickness).unwrap_or(0.0);
    // Round stock has no face to draw a pattern of — its blank is a rod.
    if material.is_some_and(|m| m.kind == MaterialType::Round) {
        return Err(format!(
            "\"{}\" is round stock — a {} dowel {} long. There is no face outline to draw; cut it to length \
             from the rod.",
            part.name,
            inch_label(thickness),
            inch_label(part.size.l)
        ));
    }
    let drawing = outline_svg::render(part, thickness, material.map(|m| m.name.as_str()).unwrap_or(""), &[]);
    let mut payload = json!({ "projectId": design.id() });
    merge(&mut payload, summarise(part, spec));
    payload["bytes"] = drawing.len().into();
    if drawing.len() > MAX_SVG_BYTES {
        payload["error"] = format!(
            "This drawing is {} bytes, past the {MAX_SVG_BYTES}-byte cap. Simplify the part's ops, or read \
             its geometry with explain_part.",
            drawing.len()
        )
        .into();
        return Ok(payload);
    }
    payload["scale"] = "1:1 — print at 100%, no fit-to-page".into();
    payload["svg"] = drawing.into();
    Ok(payload)
}

fn summarise(part: &Part, spec: &Spec) -> Value {
    let material = spec.material(&part.material_id);
    let ops: Vec<Value> = part
        .ops
        .iter()
        .flatten()
        .enumerate()
        .map(|(index, op)| {
            let raw = spec::to_value(op);
            compact(json!({ "index": index, "type": raw["type"], "edge": raw.get("edge"), "face": raw.get("face") }))
        })
        .collect();
    json!({
        "partId": part.id,
        "partName": part.name,
        "blank": {
            "length": part.size.l,
            "width": part.size.w,
            "thickness": material.map(|m| m.thickness),
            "label": format!("{} × {}", inch_label(part.size.l), inch_label(part.size.w)),
        },
        "material": material.map(|m| m.name.clone()),
        "ops": ops,
    })
}

fn merge(into: &mut Value, from: Value) {
    if let (Some(into), Value::Object(from)) = (into.as_object_mut(), from) {
        into.extend(from);
    }
}
