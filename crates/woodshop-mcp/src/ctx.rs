//! What every tool shares: the library, loading a design, the one path a change takes to disk
//! ([`Woodshop::apply`]), and rendering its outcome for the calling agent.

use std::sync::{Mutex, MutexGuard};

use serde_json::{Map, Value, json};
use woodshop_core::lint::{self, LintIssue};
use woodshop_core::spec::{self, Spec};
use woodshop_store::{Author, Project, Store, StoreError};

/// A tool's answer: a JSON payload, or an error sentence the agent can act on.
pub type Outcome = Result<Value, String>;

pub struct Woodshop {
    store: Mutex<Store>,
}

/// A design as the tools read it: the row, and its draft as plain JSON (already migrated to the
/// current spec version when the store read it).
pub struct Loaded {
    pub project: Project,
    pub draft: Value,
}

impl Loaded {
    pub fn id(&self) -> i64 {
        self.project.id
    }

    pub fn name(&self) -> &str {
        &self.project.name
    }

    pub fn spec(&self) -> &Spec {
        &self.project.draft
    }
}

/// Why a change was not written.
pub enum Rejected {
    /// Schema errors, or buildability problems the change introduced.
    Invalid(Vec<String>),
    Message(String),
}

/// A written change: the new spec, plus buildability problems that did not block it.
pub struct Applied {
    pub spec: Spec,
    pub advisories: Vec<String>,
}

impl Woodshop {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
        }
    }

    pub fn store(&self) -> MutexGuard<'_, Store> {
        // A panic mid-tool leaves nothing half-written (every write is one transaction), so a
        // poisoned lock is still safe to use.
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn load(&self, id: i64) -> Result<Loaded, String> {
        self.load_or(id, &format!("No design #{id} was found in your library."))
    }

    /// For the editing tools, whose not-found message names what they need.
    pub fn load_editable(&self, id: i64) -> Result<Loaded, String> {
        self.load_or(
            id,
            &format!("No design #{id} with an editable draft was found in your library."),
        )
    }

    fn load_or(&self, id: i64, not_found: &str) -> Result<Loaded, String> {
        match self.store().get_project(id) {
            Ok(project) if project.deleted_at.is_none() => {
                let draft = spec::to_value(&project.draft);
                Ok(Loaded { project, draft })
            }
            Ok(_) | Err(StoreError::ProjectNotFound(_)) => Err(not_found.to_owned()),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Apply a deterministic change to a design's draft. The schema is ALWAYS enforced — a
    /// malformed spec is never written. The buildability linter either blocks too or is advisory:
    ///
    /// - `require_buildable` (edits like resize/delete): the change may not INTRODUCE a linter
    ///   error. Problems already there don't block, so a work in progress stays editable.
    /// - otherwise (authoring like add_part): a new part is legitimately floating until connected,
    ///   so linter errors come back as advisories.
    ///
    /// On success the outgoing draft is kept as a restore point (by `mcp`) and the draft advances.
    pub fn apply(
        &self,
        loaded: &Loaded,
        label: &str,
        require_buildable: bool,
        mutate: impl FnOnce(&mut Value),
    ) -> Result<Applied, Rejected> {
        let mut next = loaded.draft.clone();
        mutate(&mut next);
        let next = spec::parse(next).map_err(|e| Rejected::Invalid(e.messages()))?;

        let after = lint_errors(&next);
        if require_buildable {
            let introduced = introduced(&after, &lint_errors(loaded.spec()));
            if !introduced.is_empty() {
                return Err(Rejected::Invalid(messages(&introduced)));
            }
        }

        let store = self.store();
        let written = store
            .snapshot_draft(loaded.id(), label, Author::Mcp)
            .and_then(|()| store.save_draft(loaded.id(), &next, Some(loaded.project.draft_updated_at)));
        match written {
            Ok(_) => Ok(Applied {
                advisories: if require_buildable {
                    Vec::new()
                } else {
                    messages(&after)
                },
                spec: next,
            }),
            Err(StoreError::Conflict { .. }) => Err(Rejected::Message(
                "The design was saved from the editor while this change was being made, so it was not \
                 applied. Read it again with get_design and retry."
                    .into(),
            )),
            Err(e) => Err(Rejected::Message(e.to_string())),
        }
    }

    /// Turn a change's outcome into the tool response. `summary` says what changed in plain words;
    /// a rejection explains exactly why, so the agent can adjust.
    pub fn render(&self, result: Result<Applied, Rejected>, loaded: &Loaded, summary: &str) -> Outcome {
        match result {
            Ok(applied) => {
                let mut payload = json!({
                    "projectId": loaded.id(),
                    "name": loaded.name(),
                    "summary": summary,
                    "partCount": applied.spec.parts.len(),
                });
                // Authoring can leave the design transiently unbuildable (a part not yet connected);
                // say what to fix next without failing the write.
                if !applied.advisories.is_empty() {
                    let first: Vec<&str> = applied.advisories.iter().take(5).map(String::as_str).collect();
                    payload["summary"] = format!(
                        "{summary} Note: the design is not yet buildable — {}.",
                        first.join("; ")
                    )
                    .into();
                    payload["advisories"] = json!(applied.advisories);
                }
                Ok(payload)
            }
            Err(Rejected::Invalid(errors)) => {
                let first: Vec<&str> = errors.iter().take(5).map(String::as_str).collect();
                Err(format!(
                    "That change would make the design unbuildable, so it was not applied. Problems: {}.",
                    first.join("; ")
                ))
            }
            Err(Rejected::Message(message)) => Err(message),
        }
    }
}

fn lint_errors(spec: &Spec) -> Vec<LintIssue> {
    lint::lint(spec).into_iter().filter(LintIssue::is_error).collect()
}

/// The problems in `after` that were not already in `before`. Compared by identity — the rule and
/// the part/op/joint it names — never by message text: several messages quote a neighbour, so an
/// edit elsewhere can reword a problem it did not cause. Matched by count, so a second problem of
/// the same kind on the same part still counts as introduced.
fn introduced(after: &[LintIssue], before: &[LintIssue]) -> Vec<LintIssue> {
    let mut remaining: Vec<String> = before.iter().map(LintIssue::identity).collect();
    after
        .iter()
        .filter(|issue| {
            let identity = issue.identity();
            match remaining.iter().position(|r| *r == identity) {
                Some(i) => {
                    remaining.swap_remove(i);
                    false
                }
                None => true,
            }
        })
        .cloned()
        .collect()
}

/// Distinct messages, in order.
fn messages(issues: &[LintIssue]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for issue in issues {
        if !out.contains(&issue.message) {
            out.push(issue.message.clone());
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Reading and editing the draft as JSON

/// The element of `spec[collection]` whose `id` is `id`.
pub fn find<'a>(spec: &'a Value, collection: &str, id: &str) -> Option<&'a Value> {
    spec[collection].as_array()?.iter().find(|item| item["id"] == id)
}

/// Every `id` in `spec[collection]`, skipping elements without one.
pub fn ids(spec: &Value, collection: &str) -> Vec<String> {
    spec[collection]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Apply `f` to the one element of `spec[collection]` with this id.
pub fn map_one(spec: &mut Value, collection: &str, id: &str, f: impl FnOnce(&mut Map<String, Value>)) {
    if let Some(item) = spec[collection]
        .as_array_mut()
        .and_then(|items| items.iter_mut().find(|item| item["id"] == id))
        .and_then(Value::as_object_mut)
    {
        f(item);
    }
}

/// Append to `spec[collection]`, creating it when absent.
pub fn push(spec: &mut Value, collection: &str, item: Value) {
    match spec[collection].as_array_mut() {
        Some(items) => items.push(item),
        None => spec[collection] = json!([item]),
    }
}

pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

/// A fresh, schema-valid slug id (`^[a-z][a-z0-9_]{1,39}$`) derived from `from`, unique against
/// `taken`. Used when authoring so the agent needn't invent ids.
pub fn unique_id(taken: &[String], prefix: &str, from: &str) -> String {
    let mut slug = String::new();
    for c in from.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            slug.push(c);
        } else if !slug.ends_with('_') {
            slug.push('_');
        }
    }
    let slug = slug.trim_matches('_');
    let mut base = format!("{prefix}{}", if slug.is_empty() { "x" } else { slug });
    base.truncate(36);
    let mut id = base.clone();
    let mut n = 1;
    while taken.contains(&id) {
        id = format!("{base}_{n}");
        n += 1;
    }
    id
}

/// Drop the `null` members of an object, as the web server's payloads left them out.
pub fn compact(mut value: Value) -> Value {
    if let Some(map) = value.as_object_mut() {
        map.retain(|_, v| !v.is_null());
    }
    value
}

/// `1` → "", otherwise "s".
pub fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// A float as it reads in a sentence: 24 → "24", 0.75 → "0.75".
pub fn num(n: f64) -> String {
    woodshop_core::geometry::frame::php_float(n)
}

/// Milliseconds since the epoch as an ISO-8601 UTC timestamp.
pub fn iso8601(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        ms.rem_euclid(1000)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_ids_are_slugs() {
        assert_eq!(unique_id(&[], "p_", "Front Left Leg!"), "p_front_left_leg");
        assert_eq!(unique_id(&["p_shelf".into()], "p_", "Shelf"), "p_shelf_1");
        assert_eq!(unique_id(&[], "mat_", "  "), "mat_x");
        assert_eq!(unique_id(&[], "p_", &"a".repeat(60)).len(), 36);
    }

    #[test]
    fn formats_timestamps() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso8601(1_790_000_000_123), "2026-09-21T14:13:20.123Z");
    }
}
