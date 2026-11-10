//! Bring a web-app account's projects into a desktop library: drafts, version history, notes,
//! thumbnails, original dates and trash state. Every spec goes through the same migrate-and-
//! validate path as a `.woodshop` import; one that no longer validates is reported and left out.
//!
//! ```text
//! psql … -v email=you@example.com -f scripts/export-laravel.sql > laravel-projects.json
//! cargo run -p woodshop-store --example import_laravel -- \
//!     laravel-projects.json ../woodshop/storage/app/public "<library dir>" [--dry-run]
//! ```
//!
//! Safe to re-run: a project already in the library with the same name and creation time is
//! skipped. Quit the app first, or it will pick the new projects up on its next refresh.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;
use woodshop_core::spec::{self, Spec};
use woodshop_store::{ArchivedNote, ArchivedVersion, Author, ProjectArchive, Store};

#[derive(Deserialize)]
struct Dump {
    email: String,
    projects: Vec<LaravelProject>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaravelProject {
    id: i64,
    name: String,
    draft: Option<Value>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    deleted_at: Option<i64>,
    thumbnail_path: Option<String>,
    versions: Vec<LaravelVersion>,
    notes: Vec<LaravelNote>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaravelVersion {
    label: Option<String>,
    created_by: String,
    created_at: Option<i64>,
    spec: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaravelNote {
    body: String,
    pinned: bool,
    created_at: Option<i64>,
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let [dump, storage, library] = paths.as_slice() else {
        return Err("usage: import_laravel <dump.json> <laravel storage/app/public> <library dir> [--dry-run]".into());
    };
    let dump: Dump = serde_json::from_slice(&std::fs::read(dump)?)?;
    let storage = PathBuf::from(storage);
    let store = Store::open(Path::new(library.as_str()))?;

    let mut existing: Vec<(String, i64)> = store
        .list_projects(false)?
        .into_iter()
        .chain(store.list_projects(true)?)
        .map(|p| (p.name, p.created_at))
        .collect();

    println!(
        "{} project(s) from {}{}",
        dump.projects.len(),
        dump.email,
        if dry_run { " (dry run)" } else { "" }
    );
    let (mut imported, mut skipped, mut dropped_versions) = (0, 0, 0);
    for project in dump.projects {
        let label = format!("#{} \"{}\"", project.id, project.name);
        let now = woodshop_store::now_ms();
        let created_at = project.created_at.unwrap_or(now);
        if existing.contains(&(project.name.clone(), created_at)) {
            println!("  skip    {label}: already in the library");
            skipped += 1;
            continue;
        }

        // History first: the draft falls back to the newest version that still validates.
        let mut versions = Vec::new();
        for v in project.versions {
            match spec::parse(v.spec) {
                Ok(spec) => versions.push(ArchivedVersion {
                    label: v.label,
                    created_by: Author::parse(&v.created_by),
                    created_at: v.created_at.unwrap_or(created_at),
                    spec,
                }),
                Err(e) => {
                    dropped_versions += 1;
                    println!(
                        "  warn    {label}: dropped a version that no longer validates ({})",
                        first(&e.messages())
                    );
                }
            }
        }
        let draft: Spec = match project.draft.map(spec::parse) {
            Some(Ok(spec)) => spec,
            other => {
                if let Some(Err(e)) = other {
                    println!(
                        "  warn    {label}: draft no longer validates ({})",
                        first(&e.messages())
                    );
                }
                match versions.first() {
                    Some(v) => {
                        println!("  note    {label}: using its newest saved version as the draft");
                        v.spec.clone()
                    }
                    None => {
                        println!("  skip    {label}: nothing to import (no valid draft or version)");
                        skipped += 1;
                        continue;
                    }
                }
            }
        };
        let thumbnail = project.thumbnail_path.and_then(|p| std::fs::read(storage.join(p)).ok());
        let notes = project
            .notes
            .into_iter()
            .map(|n| ArchivedNote {
                body: n.body,
                pinned: n.pinned,
                created_at: n.created_at.unwrap_or(created_at),
            })
            .collect();

        let summary = format!(
            "{} part(s), {} version(s){}{}",
            draft.parts.len(),
            versions.len(),
            if thumbnail.is_some() { ", thumbnail" } else { "" },
            if project.deleted_at.is_some() { ", in trash" } else { "" }
        );
        if !dry_run {
            let archive = ProjectArchive {
                name: project.name.clone(),
                draft,
                versions,
                notes,
                thumbnail,
            };
            let new = store.import_archive(archive)?;
            store.set_project_dates(
                new.id,
                created_at,
                project.updated_at.unwrap_or(created_at),
                project.deleted_at,
            )?;
        }
        existing.push((project.name, created_at));
        println!("  import  {label}: {summary}");
        imported += 1;
    }
    println!("{imported} imported, {skipped} skipped, {dropped_versions} invalid version(s) left out");
    Ok(())
}

fn first(messages: &[String]) -> &str {
    messages.first().map(String::as_str).unwrap_or("invalid")
}
