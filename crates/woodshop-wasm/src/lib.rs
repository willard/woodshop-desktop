//! WebAssembly facade over `woodshop-core`, so the webview runs the exact domain code the native
//! side does — synchronously, with no IPC hop in the editor's per-edit loop.
//!
//! Every value crosses as plain JSON-compatible JS (objects, not `Map`s). Names are camelCase to
//! match the TypeScript modules they replace.

use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;
use woodshop_core::cutlist::{self, CutList, CutListConfig};
use woodshop_core::geometry::{self, outline};
use woodshop_core::spec::{self, Curve, Notch, Op, Part, Spec};
use woodshop_core::{fasteners, lint, units};

type JsResult<T> = Result<T, JsError>;

fn to_js<T: Serialize>(value: &T) -> JsResult<JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

fn from_js<T: DeserializeOwned>(value: JsValue) -> JsResult<T> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&e.to_string()))
}

fn json_from_js(value: JsValue) -> JsResult<serde_json::Value> {
    from_js(value)
}

/// A spec already parsed by [`parse_spec`] — trusted, so only typed, not re-validated.
fn spec_from_js(value: JsValue) -> JsResult<Spec> {
    from_js(value)
}

// ---------------------------------------------------------------------------------------------
// Spec layer

#[wasm_bindgen(js_name = currentSpecVersion)]
pub fn current_spec_version() -> String {
    spec::CURRENT_SPEC_VERSION.into()
}

#[cfg(feature = "validate")]
#[wasm_bindgen(js_name = specSchemaJson)]
pub fn spec_schema_json() -> String {
    spec::validate::SCHEMA_JSON.into()
}

/// Migrate → validate → fill defaults. Throws with every validation message joined.
#[wasm_bindgen(js_name = parseSpec)]
pub fn parse_spec(input: JsValue) -> JsResult<JsValue> {
    let spec = spec::parse(json_from_js(input)?).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&spec::to_value(&spec))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum SafeParse {
    Ok { data: serde_json::Value },
    Err { messages: Vec<String> },
}

/// Non-throwing [`parse_spec`]: `{status: "ok", data}` or `{status: "err", messages}`.
#[wasm_bindgen(js_name = safeParseSpec)]
pub fn safe_parse_spec(input: JsValue) -> JsResult<JsValue> {
    let result = match json_from_js(input).map_err(|e| vec![format!("{e:?}")]) {
        Err(messages) => SafeParse::Err { messages },
        Ok(raw) => match spec::parse(raw) {
            Ok(s) => SafeParse::Ok {
                data: spec::to_value(&s),
            },
            Err(e) => SafeParse::Err { messages: e.messages() },
        },
    };
    to_js(&result)
}

#[wasm_bindgen(js_name = migrateToLatest)]
pub fn migrate_to_latest(input: JsValue) -> JsResult<JsValue> {
    let migrated = spec::migrate_to_latest(json_from_js(input)?).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&migrated)
}

/// Schema errors as readable messages; empty when valid.
#[cfg(feature = "validate")]
#[wasm_bindgen(js_name = validateSpec)]
pub fn validate_spec(input: JsValue) -> JsResult<Vec<String>> {
    Ok(spec::validate::validate(&json_from_js(input)?)
        .err()
        .unwrap_or_default())
}

#[wasm_bindgen(js_name = starterSpec)]
pub fn starter_spec(name: &str, options: JsValue) -> JsResult<JsValue> {
    let opts: spec::starter::StarterOptions = if options.is_undefined() || options.is_null() {
        Default::default()
    } else {
        from_js(options)?
    };
    let mut s = spec::starter::minimal(name, &opts);
    spec::fill_defaults(&mut s);
    to_js(&spec::to_value(&s))
}

#[wasm_bindgen(js_name = lintSpec)]
pub fn lint_spec(spec: JsValue) -> JsResult<JsValue> {
    to_js(&lint::lint(&spec_from_js(spec)?))
}

#[wasm_bindgen(js_name = duplicatePlacements)]
pub fn duplicate_placements(spec: JsValue) -> JsResult<JsValue> {
    to_js(&lint::duplicate_placements(&spec_from_js(spec)?))
}

// ---------------------------------------------------------------------------------------------
// Geometry

#[wasm_bindgen(js_name = overallSize)]
pub fn overall_size(spec: JsValue) -> JsResult<JsValue> {
    to_js(&geometry::overall_size(&spec_from_js(spec)?))
}

#[wasm_bindgen(js_name = buildOutline)]
pub fn build_outline(l: f64, w: f64, curves: JsValue, notches: JsValue) -> JsResult<JsValue> {
    // The editor passes whole ops; accept them as ops and keep the curve/notch payloads.
    let curves: Vec<Op> = from_js(curves)?;
    let notches: Vec<Op> = if notches.is_undefined() {
        Vec::new()
    } else {
        from_js(notches)?
    };
    let curves: Vec<Curve> = curves
        .into_iter()
        .filter_map(|o| if let Op::Curve(c) = o { Some(c) } else { None })
        .collect();
    let notches: Vec<Notch> = notches
        .into_iter()
        .filter_map(|o| if let Op::Notch(n) = o { Some(n) } else { None })
        .collect();
    to_js(&outline::build(l, w, &curves, &notches))
}

#[wasm_bindgen(js_name = outlineForPart)]
pub fn outline_for_part(part: JsValue) -> JsResult<JsValue> {
    let part: Part = from_js(part)?;
    to_js(&outline::for_part(&part))
}

#[wasm_bindgen(js_name = outlineSvg)]
pub fn outline_svg(part: JsValue, thickness: f64, material_name: &str, notes: Vec<String>) -> JsResult<String> {
    let part: Part = from_js(part)?;
    Ok(geometry::outline_svg::render(&part, thickness, material_name, &notes))
}

#[wasm_bindgen(js_name = fastenerSegments)]
pub fn fastener_segments(part: JsValue, thickness: f64, op: JsValue) -> JsResult<JsValue> {
    let part: Part = from_js(part)?;
    let segments = match from_js::<Op>(op)? {
        Op::PocketHoles(p) => fasteners::pocket_segments(&part, thickness, &p),
        Op::Screws(s) => fasteners::screw_segments(&part, thickness, &s),
        _ => Vec::new(),
    };
    to_js(&segments)
}

// ---------------------------------------------------------------------------------------------
// Fastener tables

#[wasm_bindgen(js_name = woodScrewLength)]
pub fn wood_screw_length(host: f64, mate: f64) -> f64 {
    fasteners::wood_screw_length(host, mate)
}

#[wasm_bindgen(js_name = pocketScrewLength)]
pub fn pocket_screw_length(host: f64, mate: Option<f64>) -> f64 {
    fasteners::pocket_screw_length(host, mate)
}

#[wasm_bindgen(js_name = pocketScrewThread)]
pub fn pocket_screw_thread(mate: JsValue) -> JsResult<String> {
    let mate: Option<spec::Material> = if mate.is_undefined() || mate.is_null() {
        None
    } else {
        Some(from_js(mate)?)
    };
    Ok(match fasteners::pocket_screw_thread(mate.as_ref()) {
        spec::Thread::Coarse => "coarse".into(),
        spec::Thread::Fine => "fine".into(),
    })
}

#[wasm_bindgen(js_name = screwGauge)]
pub fn screw_gauge(mate_thickness: f64) -> String {
    fasteners::screw_gauge(mate_thickness).as_str().into()
}

// ---------------------------------------------------------------------------------------------
// Cut list

#[wasm_bindgen(js_name = computeCutList)]
pub fn compute_cut_list(spec: JsValue, config: JsValue) -> JsResult<JsValue> {
    let config: CutListConfig = if config.is_undefined() || config.is_null() {
        CutListConfig::default()
    } else {
        from_js(config)?
    };
    to_js(&cutlist::compute_cut_list(&spec_from_js(spec)?, config))
}

#[wasm_bindgen(js_name = groupCutList)]
pub fn group_cut_list(cut_list: JsValue) -> JsResult<JsValue> {
    let cut_list: CutList = from_js(cut_list)?;
    to_js(&cutlist::group_cut_list(&cut_list))
}

#[wasm_bindgen(js_name = groupLabel)]
pub fn group_label(names: Vec<String>) -> String {
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    if refs.is_empty() {
        String::new()
    } else {
        cutlist::grouping::group_label(&refs)
    }
}

#[wasm_bindgen(js_name = computeHardware)]
pub fn compute_hardware(spec: JsValue) -> JsResult<JsValue> {
    to_js(&cutlist::compute_hardware(&spec_from_js(spec)?))
}

#[wasm_bindgen(js_name = stockAdvice)]
pub fn stock_advice(cut_list: JsValue, spec: JsValue) -> JsResult<JsValue> {
    let cut_list: CutList = from_js(cut_list)?;
    to_js(&cutlist::stock_advice(&cut_list, &spec_from_js(spec)?))
}

#[derive(serde::Deserialize)]
struct SheetDims {
    l: f64,
    w: f64,
}

/// Guillotine-pack loose items onto sheets (the Stock calculator, outside any spec).
#[wasm_bindgen(js_name = packGuillotine)]
pub fn pack_guillotine(items: JsValue, sheet: JsValue, kerf: f64) -> JsResult<JsValue> {
    let items: Vec<cutlist::pack::SheetItem> = from_js(items)?;
    let sheet: SheetDims = from_js(sheet)?;
    to_js(&cutlist::pack::pack_guillotine(items, sheet.l, sheet.w, kerf))
}

/// First-fit-decreasing stick cutting for loose items.
#[wasm_bindgen(js_name = packLumber)]
pub fn pack_lumber(items: JsValue, stock_length: f64, kerf: f64) -> JsResult<JsValue> {
    let items: Vec<cutlist::pack::LumberItem> = from_js(items)?;
    to_js(&cutlist::pack::pack_lumber(items, stock_length, kerf))
}

// ---------------------------------------------------------------------------------------------
// Units

#[wasm_bindgen(js_name = formatFraction)]
pub fn format_fraction(value: f64, denominator: Option<u32>) -> String {
    units::format_fraction(value, denominator.unwrap_or(units::fraction::DEFAULT_DENOMINATOR))
}

#[wasm_bindgen(js_name = parseFraction)]
pub fn parse_fraction(input: &str) -> Option<f64> {
    units::parse_fraction(input)
}

#[wasm_bindgen(js_name = parseSignedFraction)]
pub fn parse_signed_fraction(input: &str) -> Option<f64> {
    units::parse_signed_fraction(input)
}
