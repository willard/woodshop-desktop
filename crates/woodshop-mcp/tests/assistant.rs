//! The in-app assistant's loop, against scripted provider replies: what it sends, how it runs the
//! tools it is asked to, and what it hands back.

use std::cell::{Cell, RefCell};

use serde_json::{Value, json};
use woodshop_mcp::assistant::{self, Ask, Config, Event, Http, HttpError, Provider};
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
    fn post_stream(
        &self,
        url: &str,
        headers: &[(&str, String)],
        body: &Value,
        on_data: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), HttpError> {
        let headers = headers.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
        self.sent.borrow_mut().push((url.to_string(), headers, body.clone()));
        let reply = self.replies.borrow_mut().remove(0)?;
        // A scripted reply is the finished answer; send it the way the provider streams it. An
        // array is a stream already, sent as it is.
        let events = if let Some(raw) = reply.as_array() {
            raw.iter().map(Value::to_string).collect()
        } else if reply.get("choices").is_some() {
            openai_stream(&reply["choices"][0]["message"])
        } else {
            claude_stream(&reply)
        };
        for data in events {
            if !on_data(&data) {
                break;
            }
        }
        Ok(())
    }
}

/// Splits a string in two, so every delta arrives in more than one piece.
fn halves(s: &str) -> [String; 2] {
    let mid = s.char_indices().nth(s.chars().count() / 2).map_or(s.len(), |(i, _)| i);
    [s[..mid].to_string(), s[mid..].to_string()]
}

/// A Messages API response as the stream of events that delivers it.
fn claude_stream(message: &Value) -> Vec<String> {
    let mut events = vec![json!({ "type": "message_start", "message": { "content": [] } })];
    for (index, block) in message["content"].as_array().unwrap().iter().enumerate() {
        let (start, deltas) = match block["type"].as_str().unwrap() {
            "text" => (
                json!({ "type": "text", "text": "" }),
                halves(block["text"].as_str().unwrap())
                    .map(|t| json!({ "type": "text_delta", "text": t }))
                    .to_vec(),
            ),
            "thinking" => (
                json!({ "type": "thinking", "thinking": "" }),
                vec![
                    json!({ "type": "thinking_delta", "thinking": block["thinking"] }),
                    json!({ "type": "signature_delta", "signature": block["signature"] }),
                ],
            ),
            "tool_use" => (
                json!({ "type": "tool_use", "id": block["id"], "name": block["name"], "input": {} }),
                halves(&block["input"].to_string())
                    .map(|j| json!({ "type": "input_json_delta", "partial_json": j }))
                    .to_vec(),
            ),
            _ => (block.clone(), vec![]),
        };
        events.push(json!({ "type": "content_block_start", "index": index, "content_block": start }));
        for delta in deltas {
            events.push(json!({ "type": "content_block_delta", "index": index, "delta": delta }));
        }
        events.push(json!({ "type": "content_block_stop", "index": index }));
    }
    events.push(json!({ "type": "message_delta", "delta": { "stop_reason": message["stop_reason"] } }));
    events.push(json!({ "type": "message_stop" }));
    events.iter().map(Value::to_string).collect()
}

/// A chat-completions message as the chunks that deliver it.
fn openai_stream(message: &Value) -> Vec<String> {
    let mut chunks = Vec::new();
    for part in message["content"].as_str().map(halves).into_iter().flatten() {
        chunks.push(json!({ "choices": [{ "delta": { "content": part } }] }));
    }
    for (index, call) in message["tool_calls"].as_array().into_iter().flatten().enumerate() {
        let f = &call["function"];
        chunks.push(json!({ "choices": [{ "delta": { "tool_calls": [{
            "index": index, "id": call["id"], "type": "function",
            "function": { "name": f["name"], "arguments": "" } }] } }] }));
        for part in halves(f["arguments"].as_str().unwrap()) {
            chunks.push(json!({ "choices": [{ "delta": { "tool_calls": [{
                "index": index, "function": { "arguments": part } }] } }] }));
        }
    }
    let mut out: Vec<String> = chunks.iter().map(Value::to_string).collect();
    out.push("[DONE]".into());
    out
}

fn ask(text: &str) -> Ask {
    Ask {
        text: text.into(),
        image: None,
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
        &ask("Longer, please"),
        &|| false,
        &mut |e| events.push(e),
    )
    .unwrap();

    assert_eq!(turn.reply, "Made it an inch longer.");
    assert!(turn.changed);
    assert_eq!(turn.actions.len(), 1);
    assert!(turn.actions[0].ok, "{:?}", turn.actions[0].error);
    assert!(matches!(&events[0], Event::Tool { name } if name == "resize_part"));
    // The reply streamed in pieces.
    let streamed: String = events
        .iter()
        .filter_map(|e| match e {
            Event::Text { delta } => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(streamed, "Made it an inch longer.");
    // The project id was filled in, and the change is in the library.
    assert_eq!(first_part(&w, id).1, length + 1.0);

    let sent = http.sent.borrow();
    let (url, headers, body) = &sent[0];
    assert_eq!(url, assistant::ANTHROPIC_URL);
    assert!(headers.contains(&("anthropic-version".into(), "2026-10-21".into())));
    assert!(headers.contains(&("x-api-key".into(), "sk-test".into())));
    assert_eq!(body["fallbacks"], "default");
    assert_eq!(body["stream"], true);
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
    assert_eq!(
        messages[1]["content"][0],
        json!({ "type": "thinking", "thinking": "", "signature": "abc" })
    );
    assert_eq!(messages[1]["content"][1]["input"]["part_id"], json!(part));
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
        &ask("Delete"),
        &|| false,
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
    let err = assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        &ask("Hi"),
        &|| false,
        &mut |_| {},
    )
    .unwrap_err();
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
    let turn = assistant::send(
        &w,
        &http,
        &config,
        id,
        vec![],
        &ask("Rename it"),
        &|| false,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(turn.reply, "Renamed.");
    assert!(turn.changed);

    let sent = http.sent.borrow();
    assert_eq!(sent[0].0, "http://localhost:11434/v1/chat/completions");
    assert!(sent[0].1.is_empty(), "no key, no authorization header");
    assert_eq!(sent[0].2["messages"][0]["role"], "system");
    assert_eq!(sent[0].2["tools"][0]["type"], "function");
    assert_eq!(sent[0].2["stream"], true);
    let messages = sent[1].2["messages"].as_array().unwrap();
    assert_eq!(messages.last().unwrap()["role"], "tool");
    assert_eq!(messages.last().unwrap()["tool_call_id"], "call_1");
    // The assistant message it echoes back has the call put together from its pieces.
    let call = &messages[messages.len() - 2]["tool_calls"][0];
    assert_eq!(call["id"], "call_1");
    assert_eq!(call["function"]["name"], "rename_part");
    assert!(call["function"]["arguments"].as_str().unwrap().contains("Tall side"));
}

#[test]
fn after_a_fallback_partway_through_only_the_new_attempt_is_acted_on_and_echoed() {
    let (w, id) = library();
    let (part, _) = first_part(&w, id);
    let http = Script::new(vec![
        Ok(json!({ "stop_reason": "tool_use", "content": [
            { "type": "thinking", "thinking": "declined attempt", "signature": "s1" },
            { "type": "text", "text": "Let me look" },
            { "type": "tool_use", "id": "tu_old", "name": "delete_part", "input": { "part_id": part } },
            { "type": "fallback", "from": { "model": "claude-opus-5-5" }, "to": { "model": "claude-opus-4-8" } },
            { "type": "tool_use", "id": "tu_new", "name": "get_design", "input": {} },
        ] })),
        Ok(json!({ "stop_reason": "end_turn", "content": [{ "type": "text", "text": "Done." }] })),
    ]);
    let turn = assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        &ask("Look"),
        &|| false,
        &mut |_| {},
    )
    .unwrap();
    // Only the call after the boundary ran: the part is still there.
    assert_eq!(turn.actions.len(), 1);
    assert_eq!(turn.actions[0].tool, "get_design");
    assert_eq!(first_part(&w, id).0, part);
    let echoed = &http.sent.borrow()[1].2["messages"][1]["content"];
    let types: Vec<&str> = echoed
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["type"].as_str().unwrap())
        .collect();
    assert_eq!(types, ["text", "fallback", "tool_use"]);
}

#[test]
fn an_error_in_the_stream_is_reported() {
    let (w, id) = library();
    let http = Script::new(vec![Ok(json!([
        { "type": "message_start", "message": {} },
        { "type": "error", "error": { "type": "overloaded_error", "message": "Overloaded" } },
    ]))]);
    let err = assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        &ask("Hi"),
        &|| false,
        &mut |_| {},
    )
    .unwrap_err();
    assert!(err.contains("Overloaded"), "{err}");
}

#[test]
fn stopping_runs_nothing_more_and_leaves_a_conversation_that_can_go_on() {
    let (w, id) = library();
    let (part, length) = first_part(&w, id);
    let http = Script::new(vec![Ok(json!({ "stop_reason": "tool_use", "content": [
        { "type": "tool_use", "id": "tu_1", "name": "resize_part", "input": { "part_id": part, "length": length + 2.0 } },
        { "type": "tool_use", "id": "tu_2", "name": "delete_part", "input": { "part_id": part } },
    ] }))]);
    // The user presses Stop while the first tool runs.
    let stopped = Cell::new(false);
    let turn = assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        &ask("Go"),
        &|| stopped.get(),
        &mut |e| {
            if matches!(e, Event::ToolDone { .. }) {
                stopped.set(true);
            }
        },
    )
    .unwrap();
    assert_eq!(turn.reply, "Stopped.");
    assert_eq!(turn.actions.len(), 1, "the second call never ran");
    assert!(turn.changed);
    assert_eq!(first_part(&w, id), (part, length + 2.0));
    assert_eq!(http.sent.borrow().len(), 1, "no further request");
    // Both calls have a result, so the next message can follow on.
    let last = turn.history.last().unwrap();
    assert_eq!(last["role"], "user");
    assert_eq!(last["content"].as_array().unwrap().len(), 2);
    assert_eq!(last["content"][1]["is_error"], true);
}

#[test]
fn a_reply_stopped_part_way_is_not_kept() {
    let (w, id) = library();
    let http = Script::new(vec![Ok(json!({ "stop_reason": "end_turn", "content": [
        { "type": "text", "text": "A long answer that is cut short" },
    ] }))]);
    let stopped = Cell::new(false);
    let turn = assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        &ask("Explain"),
        &|| stopped.get(),
        &mut |e| {
            if matches!(e, Event::Text { .. }) {
                stopped.set(true);
            }
        },
    )
    .unwrap();
    assert_eq!(turn.reply, "Stopped.");
    // The conversation ends with the user's message, not half an answer.
    assert_eq!(turn.history.len(), 1);
    assert_eq!(turn.history[0]["role"], "user");
}

#[test]
fn a_picture_of_the_view_goes_first_in_the_message() {
    let (w, id) = library();
    let answer = || Ok(json!({ "stop_reason": "end_turn", "content": [{ "type": "text", "text": "Looks good." }] }));
    let http = Script::new(vec![answer()]);
    let with_picture = Ask {
        text: "How does it look?".into(),
        image: Some("SlBFRw==".into()),
    };
    assistant::send(
        &w,
        &http,
        &claude("claude-opus-5-5"),
        id,
        vec![],
        &with_picture,
        &|| false,
        &mut |_| {},
    )
    .unwrap();
    let content = &http.sent.borrow()[0].2["messages"][0]["content"];
    assert_eq!(content[0]["type"], "image");
    assert_eq!(
        content[0]["source"],
        json!({ "type": "base64", "media_type": "image/jpeg", "data": "SlBFRw==" })
    );
    assert_eq!(content[1], json!({ "type": "text", "text": "How does it look?" }));

    let http = Script::new(vec![Ok(
        json!({ "choices": [{ "message": { "role": "assistant", "content": "Fine." } }] }),
    )]);
    let config = Config {
        provider: Provider::Openai,
        model: "m".into(),
        base_url: None,
        api_key: String::new(),
    };
    assistant::send(&w, &http, &config, id, vec![], &with_picture, &|| false, &mut |_| {}).unwrap();
    let content = &http.sent.borrow()[0].2["messages"][1]["content"];
    assert_eq!(content[0]["image_url"]["url"], "data:image/jpeg;base64,SlBFRw==");
    assert_eq!(content[1]["text"], "How does it look?");
}
