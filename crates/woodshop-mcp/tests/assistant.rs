//! The in-app assistant's loop, against scripted provider replies: what it sends, how it runs the
//! tools it is asked to, and what it hands back.

use std::cell::RefCell;

use serde_json::{Value, json};
use woodshop_mcp::assistant::{self, Config, Event, Http, HttpError, Provider};
use woodshop_mcp::{Woodshop, tools};
use woodshop_store::Store;

/// One request as sent: the URL, the headers and the body.
type Sent = (String, Vec<(String, String)>, Value);

/// Answers each request with the next scripted reply, and keeps what was sent.
struct Script {
    replies: RefCell<Vec<Result<Value, HttpError>>>,
    sent: RefCell<Vec<Sent>>,
}

impl Script {
    fn new(replies: Vec<Result<Value, HttpError>>) -> Self {
        Self {
            replies: RefCell::new(replies),
            sent: RefCell::new(Vec::new()),
        }
    }
}

impl Http for Script {
    fn post(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<Value, HttpError> {
        let headers = headers.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
        self.sent.borrow_mut().push((url.to_string(), headers, body.clone()));
        self.replies.borrow_mut().remove(0)
    }
}

fn library() -> (Woodshop, i64) {
    let w = Woodshop::new(Store::open_in_memory().unwrap());
    let args = json!({ "template": "bookshelf" });
    let started = tools::call(&w, "start_from_template", args.as_object().unwrap()).unwrap();
    let id = started["projectId"].as_i64().unwrap();
    (w, id)
}

fn claude(model: &str) -> Config {
    Config {
        provider: Provider::Anthropic,
        model: model.into(),
        base_url: None,
        api_key: "sk-test".into(),
    }
}

fn first_part(w: &Woodshop, id: i64) -> (String, f64) {
    let design = tools::call(w, "get_design", json!({ "project_id": id }).as_object().unwrap()).unwrap();
    let part = &design["spec"]["parts"][0];
    (
        part["id"].as_str().unwrap().to_string(),
        part["size"]["l"].as_f64().unwrap(),
    )
}

#[test]
fn claude_runs_a_tool_on_the_open_design_and_answers() {
    let (w, id) = library();
    let (part, length) = first_part(&w, id);
    let http = Script::new(vec![
        Ok(json!({
            "stop_reason": "tool_use",
            "content": [
                { "type": "thinking", "thinking": "", "signature": "abc" },
                { "type": "tool_use", "id": "tu_1", "name": "resize_part",
                  "input": { "part_id": part, "length": length + 1.0 } },
            ],
        })),
        Ok(json!({ "stop_reason": "end_turn", "content": [{ "type": "text", "text": "Made it an inch longer." }] })),
    ]);
    let mut events = Vec::new();
    let turn = assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        "Longer, please",
        &mut |e| events.push(e),
    )
    .unwrap();

    assert_eq!(turn.reply, "Made it an inch longer.");
    assert!(turn.changed);
    assert_eq!(turn.actions.len(), 1);
    assert!(turn.actions[0].ok, "{:?}", turn.actions[0].error);
    assert!(matches!(&events[0], Event::Tool { name } if name == "resize_part"));
    // The project id was filled in, and the change is in the library.
    assert_eq!(first_part(&w, id).1, length + 1.0);

    let sent = http.sent.borrow();
    let (url, headers, body) = &sent[0];
    assert_eq!(url, assistant::ANTHROPIC_URL);
    assert!(headers.contains(&("anthropic-version".into(), "2026-10-21".into())));
    assert!(headers.contains(&("x-api-key".into(), "sk-test".into())));
    assert_eq!(body["fallbacks"], "default");
    assert!(body.get("temperature").is_none());
    assert!(body["system"].as_str().unwrap().contains(&format!("design #{id}")));
    let names: Vec<&str> = body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"resize_part") && !names.contains(&"start_design"));
    // The second request returns the assistant's content unchanged, then every result in one message.
    let messages = sent[1].2["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[1]["content"][0]["type"], "thinking");
    assert_eq!(messages[2]["content"][0]["tool_use_id"], "tu_1");
    assert_eq!(messages[2]["content"][0]["is_error"], false);
    // And the history carries on into the next turn.
    assert_eq!(turn.history.len(), 4);
}

#[test]
fn a_tool_aimed_at_another_design_is_refused() {
    let (w, id) = library();
    let http = Script::new(vec![
        Ok(json!({ "stop_reason": "tool_use", "content": [
            { "type": "tool_use", "id": "tu_1", "name": "delete_part",
              "input": { "project_id": id + 7, "part_id": "x" } },
            { "type": "tool_use", "id": "tu_2", "name": "start_design", "input": {} },
        ] })),
        Ok(json!({ "stop_reason": "end_turn", "content": [{ "type": "text", "text": "Sorry." }] })),
    ]);
    let turn = assistant::send(
        &w,
        &http,
        &claude("claude-haiku-5-5"),
        id,
        vec![],
        "Delete",
        &mut |_| {},
    )
    .unwrap();
    assert!(!turn.changed);
    assert_eq!(turn.actions.iter().filter(|a| !a.ok).count(), 2);
    let results = &http.sent.borrow()[1].2["messages"][2]["content"];
    assert!(
        results[0]["content"]
            .as_str()
            .unwrap()
            .contains(&format!("only work on design #{id}"))
    );
    assert_eq!(results[1]["is_error"], true);
    // Haiku takes no server-side fallbacks.
    assert!(http.sent.borrow()[0].2.get("fallbacks").is_none());
}

#[test]
fn a_rejected_key_says_where_to_fix_it() {
    let (w, id) = library();
    let http = Script::new(vec![Err(HttpError {
        status: Some(401),
        message: "unauthorized".into(),
    })]);
    let err = assistant::send(&w, &http, &claude("claude-opus-5-5"), id, vec![], "Hi", &mut |_| {}).unwrap_err();
    assert!(err.contains("Settings ▸ AI agents"), "{err}");
}

#[test]
fn an_openai_compatible_server_gets_functions_and_tool_messages() {
    let (w, id) = library();
    let (part, _) = first_part(&w, id);
    let http = Script::new(vec![
        Ok(
            json!({ "choices": [{ "message": { "role": "assistant", "content": null, "tool_calls": [
            { "id": "call_1", "type": "function",
              "function": { "name": "rename_part", "arguments": format!("{{\"part_id\":\"{part}\",\"name\":\"Tall side\"}}") } },
        ] } }] }),
        ),
        Ok(json!({ "choices": [{ "message": { "role": "assistant", "content": "Renamed." } }] })),
    ]);
    let config = Config {
        provider: Provider::Openai,
        model: "local-model".into(),
        base_url: Some("http://localhost:11434/v1/".into()),
        api_key: String::new(),
    };
    let turn = assistant::send(&w, &http, &config, id, vec![], "Rename it", &mut |_| {}).unwrap();
    assert_eq!(turn.reply, "Renamed.");
    assert!(turn.changed);

    let sent = http.sent.borrow();
    assert_eq!(sent[0].0, "http://localhost:11434/v1/chat/completions");
    assert!(sent[0].1.is_empty(), "no key, no authorization header");
    assert_eq!(sent[0].2["messages"][0]["role"], "system");
    assert_eq!(sent[0].2["tools"][0]["type"], "function");
    let messages = sent[1].2["messages"].as_array().unwrap();
    assert_eq!(messages.last().unwrap()["role"], "tool");
    assert_eq!(messages.last().unwrap()["tool_call_id"], "call_1");
}
