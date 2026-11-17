//! The design assistant's desktop side: the API key in the system keychain, an HTTP client for
//! the provider, and the command the chat panel calls. The conversation itself lives in
//! `woodshop_mcp::assistant`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};
use woodshop_mcp::Woodshop;
use woodshop_mcp::assistant::{self, Ask, Config, Http, HttpError, Provider, Turn};
use woodshop_store::Store;

use crate::commands::Library;
use crate::error::{CmdResult, CommandError};

const KEYCHAIN_SERVICE: &str = "studio.woodshop.desktop";

fn key_entry(provider: Provider) -> CmdResult<keyring::Entry> {
    let account = match provider {
        Provider::Anthropic => "assistant-anthropic",
        Provider::Openai => "assistant-openai",
    };
    keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(keychain_error)
}

fn keychain_error(e: keyring::Error) -> CommandError {
    log::warn!("keychain: {e}");
    CommandError::Io {
        message: "Woodshop couldn't use the system keychain to keep the API key.".into(),
    }
}

fn read_key(provider: Provider) -> CmdResult<Option<String>> {
    match key_entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keychain_error(e)),
    }
}

/// Which providers have a key saved. The key itself never goes back to the webview.
#[derive(Serialize)]
pub struct KeyStatus {
    anthropic: bool,
    openai: bool,
}

#[tauri::command]
pub fn assistant_keys() -> CmdResult<KeyStatus> {
    Ok(KeyStatus {
        anthropic: read_key(Provider::Anthropic)?.is_some(),
        openai: read_key(Provider::Openai)?.is_some(),
    })
}

/// Saves the key for a provider, or forgets it when `key` is empty or missing.
#[tauri::command]
pub fn assistant_set_key(provider: Provider, key: Option<String>) -> CmdResult<()> {
    let entry = key_entry(provider)?;
    match key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => entry.set_password(k).map_err(keychain_error),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(e)),
        },
    }
}

/// What the user chose in Settings ▸ AI agents, stored as the `assistant` setting.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Choice {
    provider: Option<Provider>,
    anthropic_model: Option<String>,
    openai_model: Option<String>,
    openai_base_url: Option<String>,
}

fn config(lib: &Library) -> CmdResult<Config> {
    let settings = lib.with(|s| s.settings())?;
    let choice: Choice = settings
        .get("assistant")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let provider = choice.provider.unwrap_or(Provider::Anthropic);
    let filled = |s: Option<String>| s.filter(|s| !s.trim().is_empty());
    let model = match provider {
        Provider::Anthropic => {
            filled(choice.anthropic_model).unwrap_or_else(|| assistant::DEFAULT_ANTHROPIC_MODEL.into())
        }
        Provider::Openai => filled(choice.openai_model).ok_or_else(|| CommandError::Invalid {
            message: "Choose a model for the OpenAI-compatible server in Settings ▸ AI agents.".into(),
            issues: vec![],
        })?,
    };
    let api_key = read_key(provider)?.unwrap_or_default();
    if api_key.is_empty() && provider == Provider::Anthropic {
        return Err(CommandError::Invalid {
            message: "Add your Anthropic API key in Settings ▸ AI agents to use the assistant.".into(),
            issues: vec![],
        });
    }
    Ok(Config {
        provider,
        model,
        base_url: filled(choice.openai_base_url),
        api_key,
    })
}

struct Client(reqwest::Client);

impl Http for Client {
    fn post_stream(
        &self,
        url: &str,
        headers: &[(&str, String)],
        body: &Value,
        on_data: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), HttpError> {
        let mut request = self.0.post(url).json(body).header("accept", "text/event-stream");
        for (name, value) in headers {
            request = request.header(*name, value);
        }
        tauri::async_runtime::block_on(async move {
            let mut response = request.send().await.map_err(|e| HttpError {
                status: None,
                message: if e.is_timeout() {
                    "it took too long to answer".into()
                } else {
                    e.to_string()
                },
            })?;
            let status = response.status();
            if !status.is_success() {
                let text = response.text().await.unwrap_or_default();
                // Providers put a readable reason in the body; keep it for the log.
                log::warn!(
                    "assistant: {status} from the provider: {}",
                    text.chars().take(500).collect::<String>()
                );
                return Err(HttpError {
                    status: Some(status.as_u16()),
                    message: text,
                });
            }
            let mut lines = SseLines::default();
            loop {
                let chunk = response.chunk().await.map_err(|e| HttpError {
                    status: Some(status.as_u16()),
                    message: e.to_string(),
                })?;
                let Some(chunk) = chunk else { break };
                if !lines.feed(&chunk, on_data) {
                    // Stopped: dropping the response closes the connection.
                    return Ok(());
                }
            }
            lines.finish(on_data);
            Ok(())
        })
    }
}

/// Splits a server-sent-events body into the payloads of its `data:` lines, across chunk edges.
#[derive(Default)]
struct SseLines {
    pending: Vec<u8>,
}

impl SseLines {
    /// Feeds the complete lines in `bytes`; false once `on_data` asks to stop.
    fn feed(&mut self, bytes: &[u8], on_data: &mut dyn FnMut(&str) -> bool) -> bool {
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            if !Self::line(&line, on_data) {
                return false;
            }
        }
        true
    }

    fn finish(&mut self, on_data: &mut dyn FnMut(&str) -> bool) {
        let rest = std::mem::take(&mut self.pending);
        Self::line(&rest, on_data);
    }

    fn line(line: &[u8], on_data: &mut dyn FnMut(&str) -> bool) -> bool {
        let line = String::from_utf8_lossy(line);
        let line = line.trim_end_matches(['\r', '\n']);
        match line.strip_prefix("data:") {
            Some(data) => on_data(data.strip_prefix(' ').unwrap_or(data)),
            None => true,
        }
    }
}

fn client() -> CmdResult<Client> {
    // Same TLS stack the updater uses; install its crypto provider if nothing has yet.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let inner = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(CommandError::internal)?;
    Ok(Client(inner))
}

/// Set by Stop; the running turn checks it between steps and while a reply streams in.
#[derive(Default)]
pub struct AssistantStop(Arc<AtomicBool>);

#[tauri::command]
pub fn assistant_stop(stop: State<'_, AssistantStop>) {
    stop.0.store(true, Ordering::SeqCst);
}

/// One message to the assistant about design `project_id`. `history` is the conversation so far,
/// as the last [`Turn`] returned it. Progress goes out as `assistant-event` while it works.
#[tauri::command]
pub async fn assistant_send(
    lib: State<'_, Library>,
    stop: State<'_, AssistantStop>,
    app: tauri::AppHandle,
    project_id: i64,
    history: Vec<Value>,
    text: String,
    image: Option<String>,
) -> CmdResult<Turn> {
    let config = config(&lib)?;
    let dir = lib.dir.clone();
    let http = client()?;
    let stop = Arc::clone(&stop.0);
    stop.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        // Its own connection, like an MCP agent's: the editor sees each change through the
        // library watcher and reloads it.
        let woodshop = Woodshop::new(Store::open(&dir)?);
        let mut emit = |event| {
            let _ = app.emit("assistant-event", event);
        };
        let stopped = || stop.load(Ordering::SeqCst);
        assistant::send(
            &woodshop,
            &http,
            &config,
            project_id,
            history,
            &Ask { text, image },
            &stopped,
            &mut emit,
        )
        .map_err(|message| CommandError::Io { message })
    })
    .await
    .map_err(CommandError::internal)?
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use serde_json::json;

    use super::*;

    /// A one-request HTTP server answering `status` with `body`; returns its URL and the request.
    fn stub(status: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/chat/completions", listener.local_addr().unwrap());
        let reply = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut buf = [0u8; 8192];
            // Read the head and the declared body.
            loop {
                let n = socket.read(&mut buf).unwrap();
                seen.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&seen);
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length = text[..head_end]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if seen.len() >= head_end + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            socket.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&seen).into_owned()
        });
        (url, handle)
    }

    fn stream(client: &Client, url: &str, headers: &[(&str, String)]) -> Result<Vec<String>, HttpError> {
        let mut seen = Vec::new();
        client.post_stream(url, headers, &json!({ "model": "m" }), &mut |d| {
            seen.push(d.to_string());
            true
        })?;
        Ok(seen)
    }

    #[test]
    fn posts_json_with_its_headers_and_reads_the_stream() {
        let body = "event: a\r\ndata: {\"n\":1}\r\n\r\n: keep-alive\ndata:{\"n\":2}\n\ndata: [DONE]";
        let (url, server) = stub("200 OK", body);
        let seen = stream(&client().unwrap(), &url, &[("authorization", "Bearer k".into())]).unwrap();
        assert_eq!(seen, [r#"{"n":1}"#, r#"{"n":2}"#, "[DONE]"]);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("post /v1/chat/completions"));
        assert!(request.contains("authorization: bearer k"));
        assert!(request.contains("accept: text/event-stream"));
        assert!(request.ends_with(r#"{"model":"m"}"#));
    }

    #[test]
    fn lines_split_across_chunks_come_out_whole() {
        let mut lines = SseLines::default();
        let mut seen = Vec::new();
        for piece in ["data: {\"a\"", ":1}\nda", "ta: x\n"] {
            lines.feed(piece.as_bytes(), &mut |d| {
                seen.push(d.to_string());
                true
            });
        }
        lines.finish(&mut |d| {
            seen.push(d.to_string());
            true
        });
        assert_eq!(seen, [r#"{"a":1}"#, "x"]);
        // Asked to stop, it stops at once, even mid-chunk.
        let mut first = Vec::new();
        let going = SseLines::default().feed(b"data: 1\ndata: 2\n", &mut |d| {
            first.push(d.to_string());
            false
        });
        assert!(!going);
        assert_eq!(first, ["1"]);
    }

    #[test]
    fn an_error_status_comes_back_with_its_code() {
        let (url, server) = stub("401 Unauthorized", r#"{"error":"bad key"}"#);
        let err = stream(&client().unwrap(), &url, &[]).unwrap_err();
        server.join().unwrap();
        assert_eq!(err.status, Some(401));
    }

    #[test]
    fn works_from_a_blocking_task_on_the_app_runtime() {
        // How assistant_send runs it: an async command hands the turn to spawn_blocking.
        let (url, server) = stub("200 OK", "data: ok\n");
        let seen = tauri::async_runtime::block_on(async move {
            tauri::async_runtime::spawn_blocking(move || stream(&client().unwrap(), &url, &[]))
                .await
                .unwrap()
        })
        .unwrap();
        server.join().unwrap();
        assert_eq!(seen, ["ok"]);
    }
}
