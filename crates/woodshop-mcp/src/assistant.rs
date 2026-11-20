//! The in-app design assistant: a chat about the open design, answered by a model the user brings
//! their own API key for, acting through the same tools the MCP server offers.
//!
//! Provider-neutral and synchronous. The conversation is kept by the caller as the provider's own
//! message list (opaque JSON) and passed back each turn; HTTP is behind [`Http`], so the app
//! supplies a real client and tests a scripted one.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::ctx::Woodshop;
use crate::server::INSTRUCTIONS;
use crate::tools::{self, TOOLS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// Claude, through the Messages API.
    Anthropic,
    /// Any server that speaks the OpenAI chat-completions format (OpenAI, a local Ollama, …).
    Openai,
}

pub const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-opus-5-5";
pub const DEFAULT_OPENAI_BASE: &str = "https://api.openai.com/v1";
/// The Messages API version this code is written against.
const ANTHROPIC_VERSION: &str = "2026-10-21";
/// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS: &[&str] = &[
    "claude-fable-5-2",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
];
/// Rounds of tool calls in one turn before the assistant is stopped.
const MAX_ROUNDS: usize = 30;
const MAX_TOKENS: u32 = 16_000;

/// Tools left out of the chat: it works on the open design, so it neither lists nor starts others.
const LEFT_OUT: &[&str] = &["list_projects", "start_design", "start_from_template", "quick_build"];

#[derive(Debug, Clone)]
pub struct Config {
    pub provider: Provider,
    pub model: String,
    /// OpenAI-compatible servers only; ignored for Anthropic.
    pub base_url: Option<String>,
    /// Empty for a local server that needs none.
    pub api_key: String,
}

/// What the user sends: their words, and optionally a picture of the editor's 3D view.
#[derive(Debug, Clone, Default)]
pub struct Ask {
    pub text: String,
    /// A JPEG, base64-encoded.
    pub image: Option<String>,
}

/// A failed request: the HTTP status if there was a response, and what went wrong.
#[derive(Debug, Clone)]
pub struct HttpError {
    pub status: Option<u16>,
    pub message: String,
}

pub trait Http {
    /// POSTs `body` and feeds the payload of each server-sent `data:` line to `on_data`, in order,
    /// until it returns `false` (the user stopped the assistant) or the stream ends.
    fn post_stream(
        &self,
        url: &str,
        headers: &[(&str, String)],
        body: &Value,
        on_data: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), HttpError>;
}

/// Something that happened during a turn, for a live progress line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Event {
    /// More of the reply being written. A new round (after tools run) starts a new reply.
    Text {
        delta: String,
    },
    Tool {
        name: String,
    },
    ToolDone {
        name: String,
        ok: bool,
        message: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub tool: String,
    pub ok: bool,
    /// The error the tool returned, when it failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    /// What the assistant said at the end.
    pub reply: String,
    /// Every tool it ran, in order.
    pub actions: Vec<Action>,
    /// The whole conversation in the provider's format, to send back with the next message.
    pub history: Vec<Value>,
    /// Whether any tool changed the design.
    pub changed: bool,
    /// The version holding the design as it was before this turn changed it: restoring it undoes
    /// the whole turn. Only set when something changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restore_point: Option<i64>,
}

fn system_prompt(project_id: i64, name: &str) -> String {
    format!(
        "{INSTRUCTIONS}\n\nYou are the design assistant inside the Woodshop app. The user has design \
         #{project_id} (\"{name}\") open in the editor and is chatting with you beside it; every change \
         you make appears there at once and can be undone from Versions. Work only on design \
         #{project_id}. Look before you change: read the design, then make the smallest set of edits \
         that does what was asked, and check the result. Reply in a few plain sentences: what you \
         changed, and anything the user should decide or know. The user may work in millimetres, but \
         the tools take decimal inches. A message may come with a picture of the editor's 3D view as \
         the user sees it; read the design with the tools for exact sizes."
    )
}

/// The tools the chat may use, as `(name, description, input schema)`.
fn chat_tools() -> impl Iterator<Item = &'static tools::ToolDef> {
    TOOLS.iter().filter(|t| !LEFT_OUT.contains(&t.name))
}

/// Runs one tool call for the chat, held to the open design.
fn run_tool(woodshop: &Woodshop, project_id: i64, name: &str, input: &Value) -> (Result<Value, String>, bool) {
    let Some(tool) = tools::find(name).filter(|t| !LEFT_OUT.contains(&t.name)) else {
        return (Err(format!("There is no \"{name}\" tool here.")), false);
    };
    let mut args = input.as_object().cloned().unwrap_or_default();
    match args.get("project_id").and_then(Value::as_i64) {
        Some(id) if id != project_id => {
            return (Err(format!("This chat can only work on design #{project_id}.")), false);
        }
        None if (tool.schema)()["properties"].get("project_id").is_some() => {
            args.insert("project_id".into(), json!(project_id));
        }
        _ => {}
    }
    let outcome = tools::call(woodshop, name, &args);
    let changed = outcome.is_ok() && !tool.read_only;
    (outcome, changed)
}

fn result_text(outcome: &Result<Value, String>) -> String {
    match outcome {
        Ok(v) => serde_json::to_string(v).unwrap_or_default(),
        Err(e) => e.clone(),
    }
}

/// Sends `text` in the conversation `history` and runs the assistant until it answers, or until
/// `stop` says the user pressed Stop.
#[allow(clippy::too_many_arguments)]
pub fn send(
    woodshop: &Woodshop,
    http: &dyn Http,
    config: &Config,
    project_id: i64,
    history: Vec<Value>,
    ask: &Ask,
    stop: &dyn Fn() -> bool,
    on_event: &mut dyn FnMut(Event),
) -> Result<Turn, String> {
    let name = woodshop.load(project_id)?.name().to_string();
    let system = system_prompt(project_id, &name);
    let before = newest_version(woodshop, project_id)?;
    let mut turn = match config.provider {
        Provider::Anthropic => anthropic(
            woodshop, http, config, project_id, &system, history, ask, stop, on_event,
        ),
        Provider::Openai => openai(
            woodshop, http, config, project_id, &system, history, ask, stop, on_event,
        ),
    }?;
    if turn.changed {
        turn.restore_point = restore_point(woodshop, project_id, before)?;
    }
    Ok(turn)
}

/// Where the design stood when a turn began: the newest version, and whether the draft is that
/// version unchanged.
struct Before {
    newest: Option<i64>,
    saved: bool,
}

fn newest_version(woodshop: &Woodshop, project_id: i64) -> Result<Before, String> {
    let store = woodshop.store();
    let newest = store
        .list_versions(project_id)
        .map_err(|e| e.to_string())?
        .iter()
        .map(|v| v.id)
        .max();
    let saved = match newest {
        Some(id) => {
            let draft = store.get_project(project_id).map_err(|e| e.to_string())?.draft;
            store.get_version_spec(project_id, id).ok().as_ref() == Some(&draft)
        }
        None => false,
    };
    Ok(Before { newest, saved })
}

/// The version that holds the design as it was when the turn began. If the draft was already the
/// newest version, that is it; otherwise the turn's first change kept the draft as a version
/// before replacing it, so it is the first version the turn added.
fn restore_point(woodshop: &Woodshop, project_id: i64, before: Before) -> Result<Option<i64>, String> {
    if before.saved {
        return Ok(before.newest);
    }
    let versions = woodshop.store().list_versions(project_id).map_err(|e| e.to_string())?;
    Ok(versions
        .iter()
        .map(|v| v.id)
        .filter(|&id| before.newest.is_none_or(|b| id > b))
        .min())
}

fn http_message(e: HttpError, who: &str) -> String {
    match e.status {
        Some(401 | 403) => format!("{who} didn't accept the API key. Check it in Settings ▸ AI agents."),
        Some(404) => format!("{who} doesn't know that model or address. Check them in Settings ▸ AI agents."),
        Some(429) => format!("{who} is rate-limiting this key. Wait a moment and try again."),
        Some(s) if s >= 500 => format!("{who} had a problem ({s}). Try again in a moment."),
        _ => format!("Couldn't get an answer from {who}: {}", e.message),
    }
}

#[allow(clippy::too_many_arguments)]
fn anthropic(
    woodshop: &Woodshop,
    http: &dyn Http,
    config: &Config,
    project_id: i64,
    system: &str,
    mut messages: Vec<Value>,
    ask: &Ask,
    stop: &dyn Fn() -> bool,
    on_event: &mut dyn FnMut(Event),
) -> Result<Turn, String> {
    let tools: Vec<Value> = chat_tools()
        .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": (t.schema)() }))
        .collect();
    let fallbacks = FALLBACK_MODELS.contains(&config.model.as_str());
    let mut headers = vec![
        ("x-api-key", config.api_key.clone()),
        ("anthropic-version", ANTHROPIC_VERSION.to_string()),
    ];
    if fallbacks {
        headers.push(("anthropic-beta", "server-side-fallback-2026-07-01".to_string()));
    }
    messages.push(json!({ "role": "user", "content": match &ask.image {
        // The picture first, then what the user asked about it.
        Some(jpeg) => json!([
            { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": jpeg } },
            { "type": "text", "text": ask.text },
        ]),
        None => json!(ask.text),
    } }));
    let mut actions = Vec::new();
    let mut changed = false;
    for _ in 0..MAX_ROUNDS {
        if stop() {
            return Ok(user_stopped(actions, messages, changed));
        }
        let mut body = json!({
            "model": config.model,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "tools": tools,
            "messages": messages,
            "output_config": { "effort": "high" },
            "stream": true,
        });
        if fallbacks {
            body["fallbacks"] = json!("default");
        }
        let response = anthropic_stream(http, &headers, &body, stop, on_event)?;
        if stop() {
            // A reply cut off part way is not sent back; the conversation ends before it.
            return Ok(user_stopped(actions, messages, changed));
        }
        let content = echoable(response["content"].as_array().cloned().unwrap_or_default());
        // The whole content goes back: thinking and fallback blocks must be returned unchanged.
        messages.push(json!({ "role": "assistant", "content": content }));
        let reply: String = content
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        match response["stop_reason"].as_str() {
            Some("tool_use") => {
                let mut results = Vec::new();
                for call in content.iter().filter(|b| b["type"] == "tool_use") {
                    if stop() {
                        // Every call needs its result; the ones left over say why they didn't run.
                        results.push(json!({
                            "type": "tool_result",
                            "tool_use_id": call["id"],
                            "content": NOT_RUN,
                            "is_error": true,
                        }));
                        continue;
                    }
                    let name = call["name"].as_str().unwrap_or_default().to_string();
                    on_event(Event::Tool { name: name.clone() });
                    let (outcome, did_change) = run_tool(woodshop, project_id, &name, &call["input"]);
                    changed |= did_change;
                    let error = outcome.as_ref().err().cloned();
                    on_event(Event::ToolDone {
                        name: name.clone(),
                        ok: error.is_none(),
                        message: error.clone(),
                    });
                    results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": call["id"],
                        "content": result_text(&outcome),
                        "is_error": error.is_some(),
                    }));
                    actions.push(Action {
                        tool: name,
                        ok: error.is_none(),
                        error,
                    });
                }
                // All results in one user message, so parallel calls stay parallel.
                messages.push(json!({ "role": "user", "content": results }));
            }
            // A long turn paused by the server: send it back as it is to let it continue.
            Some("pause_turn") => {}
            Some("refusal") => {
                return Ok(Turn {
                    reply: "The model declined to help with this request.".into(),
                    actions,
                    history: messages,
                    changed,
                    restore_point: None,
                });
            }
            Some("max_tokens") => {
                return Ok(Turn {
                    reply: format!("{reply}\n\n(The answer was cut off at its length limit.)")
                        .trim()
                        .into(),
                    actions,
                    history: messages,
                    changed,
                    restore_point: None,
                });
            }
            _ => {
                return Ok(Turn {
                    reply,
                    actions,
                    history: messages,
                    changed,
                    restore_point: None,
                });
            }
        }
    }
    Ok(stopped(actions, messages, changed))
}

const NOT_RUN: &str = "The user stopped the assistant before this ran.";

fn user_stopped(actions: Vec<Action>, history: Vec<Value>, changed: bool) -> Turn {
    Turn {
        reply: "Stopped.".into(),
        actions,
        history,
        changed,
        restore_point: None,
    }
}

fn stopped(actions: Vec<Action>, history: Vec<Value>, changed: bool) -> Turn {
    Turn {
        reply: format!(
            "I stopped after {MAX_ROUNDS} rounds of changes without finishing. Say \"continue\" to let me \
             carry on, or ask for something smaller."
        ),
        actions,
        history,
        changed,
        restore_point: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn openai(
    woodshop: &Woodshop,
    http: &dyn Http,
    config: &Config,
    project_id: i64,
    system: &str,
    mut messages: Vec<Value>,
    ask: &Ask,
    stop: &dyn Fn() -> bool,
    on_event: &mut dyn FnMut(Event),
) -> Result<Turn, String> {
    let base = config
        .base_url
        .as_deref()
        .filter(|b| !b.trim().is_empty())
        .unwrap_or(DEFAULT_OPENAI_BASE)
        .trim_end_matches('/');
    let url = format!("{base}/chat/completions");
    let tools: Vec<Value> = chat_tools()
        .map(|t| {
            json!({ "type": "function", "function": {
                "name": t.name, "description": t.description, "parameters": (t.schema)() } })
        })
        .collect();
    let mut headers = Vec::new();
    if !config.api_key.is_empty() {
        headers.push(("authorization", format!("Bearer {}", config.api_key)));
    }
    if messages.is_empty() {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": match &ask.image {
        Some(jpeg) => json!([
            { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{jpeg}") } },
            { "type": "text", "text": ask.text },
        ]),
        None => json!(ask.text),
    } }));
    let mut actions = Vec::new();
    let mut changed = false;
    for _ in 0..MAX_ROUNDS {
        if stop() {
            return Ok(user_stopped(actions, messages, changed));
        }
        let body = json!({ "model": config.model, "messages": messages, "tools": tools, "stream": true });
        let message = openai_stream(http, &url, &headers, &body, stop, on_event)?;
        if stop() {
            return Ok(user_stopped(actions, messages, changed));
        }
        messages.push(message.clone());
        let calls = message["tool_calls"].as_array().cloned().unwrap_or_default();
        if calls.is_empty() {
            let reply = message["content"].as_str().unwrap_or_default().to_string();
            return Ok(Turn {
                reply,
                actions,
                history: messages,
                changed,
                restore_point: None,
            });
        }
        for call in calls {
            if stop() {
                messages.push(json!({ "role": "tool", "tool_call_id": call["id"], "content": NOT_RUN }));
                continue;
            }
            let name = call["function"]["name"].as_str().unwrap_or_default().to_string();
            on_event(Event::Tool { name: name.clone() });
            let input: Value = call["function"]["arguments"]
                .as_str()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| Value::Object(Map::new()));
            let (outcome, did_change) = run_tool(woodshop, project_id, &name, &input);
            changed |= did_change;
            let error = outcome.as_ref().err().cloned();
            on_event(Event::ToolDone {
                name: name.clone(),
                ok: error.is_none(),
                message: error.clone(),
            });
            messages.push(json!({ "role": "tool", "tool_call_id": call["id"], "content": result_text(&outcome) }));
            actions.push(Action {
                tool: name,
                ok: error.is_none(),
                error,
            });
        }
    }
    Ok(stopped(actions, messages, changed))
}

/// Reads one streamed Messages API response back into the message it describes: the content
/// blocks as the API would have returned them, and the stop reason.
fn anthropic_stream(
    http: &dyn Http,
    headers: &[(&str, String)],
    body: &Value,
    stop: &dyn Fn() -> bool,
    on_event: &mut dyn FnMut(Event),
) -> Result<Value, String> {
    let mut content: Vec<Value> = Vec::new();
    let mut partial_json: Vec<String> = Vec::new();
    let mut stop_reason = Value::Null;
    let mut failure: Option<String> = None;
    http.post_stream(ANTHROPIC_URL, headers, body, &mut |data| {
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return !stop();
        };
        match event["type"].as_str() {
            Some("content_block_start") => {
                let index = event["index"].as_u64().unwrap_or(content.len() as u64) as usize;
                if content.len() <= index {
                    content.resize(index + 1, Value::Null);
                    partial_json.resize(index + 1, String::new());
                }
                content[index] = event["content_block"].clone();
            }
            Some("content_block_delta") => {
                let index = event["index"].as_u64().unwrap_or(0) as usize;
                let (Some(block), delta) = (content.get_mut(index), &event["delta"]) else {
                    return !stop();
                };
                match delta["type"].as_str() {
                    Some("text_delta") => {
                        let text = delta["text"].as_str().unwrap_or_default();
                        append(block, "text", text);
                        on_event(Event::Text {
                            delta: text.to_string(),
                        });
                    }
                    Some("thinking_delta") => append(block, "thinking", delta["thinking"].as_str().unwrap_or_default()),
                    Some("signature_delta") => block["signature"] = delta["signature"].clone(),
                    Some("input_json_delta") => {
                        partial_json[index].push_str(delta["partial_json"].as_str().unwrap_or_default())
                    }
                    _ => {}
                }
            }
            Some("content_block_stop") => {
                let index = event["index"].as_u64().unwrap_or(0) as usize;
                if let (Some(block), Some(json)) = (content.get_mut(index), partial_json.get(index))
                    && block["type"] == "tool_use"
                {
                    block["input"] = if json.is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(json).unwrap_or_else(|_| json!({}))
                    };
                }
            }
            Some("message_delta") => {
                if !event["delta"]["stop_reason"].is_null() {
                    stop_reason = event["delta"]["stop_reason"].clone();
                }
            }
            Some("error") => {
                failure = Some(
                    event["error"]["message"]
                        .as_str()
                        .unwrap_or("the stream failed")
                        .to_string(),
                );
            }
            _ => {}
        }
        !stop()
    })
    .map_err(|e| http_message(e, "Anthropic"))?;
    if let Some(message) = failure {
        return Err(format!("Anthropic stopped answering: {message}"));
    }
    content.retain(|b| !b.is_null());
    Ok(json!({ "content": content, "stop_reason": stop_reason }))
}

fn append(block: &mut Value, field: &str, more: &str) {
    let mut text = block[field].as_str().unwrap_or_default().to_string();
    text.push_str(more);
    block[field] = Value::String(text);
}

/// The content to send back, and to act on. After a refusal fallback partway through a reply, the
/// declined attempt's thinking and tool calls before the last `fallback` block are left out (its
/// text and the block itself stay where they were), as the Messages API requires.
fn echoable(content: Vec<Value>) -> Vec<Value> {
    let Some(boundary) = content.iter().rposition(|b| b["type"] == "fallback") else {
        return content;
    };
    content
        .into_iter()
        .enumerate()
        .filter(|(i, b)| *i >= boundary || b["type"] == "text")
        .map(|(_, b)| b)
        .collect()
}

/// Reads one streamed chat-completions response back into the assistant message it describes.
fn openai_stream(
    http: &dyn Http,
    url: &str,
    headers: &[(&str, String)],
    body: &Value,
    stop: &dyn Fn() -> bool,
    on_event: &mut dyn FnMut(Event),
) -> Result<Value, String> {
    let mut text = String::new();
    let mut calls: Vec<Value> = Vec::new();
    let mut saw_choice = false;
    http.post_stream(url, headers, body, &mut |data| {
        if data.trim() == "[DONE]" {
            return !stop();
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            return !stop();
        };
        let delta = &chunk["choices"][0]["delta"];
        if delta.is_null() {
            return !stop();
        }
        saw_choice = true;
        if let Some(more) = delta["content"].as_str() {
            text.push_str(more);
            on_event(Event::Text {
                delta: more.to_string(),
            });
        }
        for call in delta["tool_calls"].as_array().into_iter().flatten() {
            let index = call["index"].as_u64().unwrap_or(calls.len() as u64) as usize;
            if calls.len() <= index {
                calls.resize(
                    index + 1,
                    json!({ "type": "function", "function": { "name": "", "arguments": "" } }),
                );
            }
            let slot = &mut calls[index];
            if let Some(id) = call["id"].as_str() {
                slot["id"] = json!(id);
            }
            if let Some(name) = call["function"]["name"].as_str() {
                append(&mut slot["function"], "name", name);
            }
            if let Some(args) = call["function"]["arguments"].as_str() {
                append(&mut slot["function"], "arguments", args);
            }
        }
        !stop()
    })
    .map_err(|e| http_message(e, "The model server"))?;
    if !saw_choice {
        return Err("The model server sent back an answer Woodshop couldn't read.".into());
    }
    let mut message = json!({ "role": "assistant", "content": text });
    if !calls.is_empty() {
        message["tool_calls"] = json!(calls);
    }
    Ok(message)
}
