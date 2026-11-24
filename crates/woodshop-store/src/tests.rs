use super::*;
use woodshop_core::spec::starter::{StarterOptions, minimal};

fn spec(name: &str) -> Spec {
    let mut s = minimal(name, &StarterOptions::default());
    spec::fill_defaults(&mut s);
    s
}

#[test]
fn creates_lists_and_reads_projects() {
    let store = Store::open_in_memory().unwrap();
    let a = store.create_project("  Bench  ", &spec("Bench")).unwrap();
    assert_eq!(a.name, "Bench");
    assert_eq!(a.draft, spec("Bench"));
    let list = store.list_projects(false).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].part_count, 1);
    assert!(matches!(
        store.create_project("   ", &spec("x")),
        Err(StoreError::EmptyName)
    ));
}

#[test]
fn draft_writes_are_guarded_against_stale_bases() {
    let store = Store::open_in_memory().unwrap();
    let p = store.create_project("Box", &spec("Box")).unwrap();

    let mut edited = p.draft.clone();
    edited.parts[0].size.l = 30.0;
    let t1 = store.save_draft(p.id, &edited, Some(p.draft_updated_at)).unwrap();
    assert!(t1 > p.draft_updated_at);

    // A second writer still holding the original timestamp is refused, and told what won.
    match store.save_draft(p.id, &p.draft, Some(p.draft_updated_at)) {
        Err(StoreError::Conflict {
            draft,
            draft_updated_at,
        }) => {
            assert_eq!(draft_updated_at, t1);
            assert_eq!(draft.parts[0].size.l, 30.0);
        }
        other => panic!("expected conflict, got {other:?}"),
    }
    // Forcing (no base) always writes.
    store.save_draft(p.id, &p.draft, None).unwrap();
}

#[test]
fn versions_are_append_only_and_restore_keeps_a_restore_point() {
    let store = Store::open_in_memory().unwrap();
    let p = store.create_project("Shelf", &spec("Shelf")).unwrap();
    let (v1, _) = store
        .create_version(p.id, &p.draft, Some("First"), Author::User)
        .unwrap();

    let mut edited = p.draft.clone();
    edited.name = "Shelf v2".into();
    store.save_draft(p.id, &edited, None).unwrap();

    let (restored, _) = store.restore_version(p.id, v1.id).unwrap();
    assert_eq!(restored.name, "Shelf");
    let versions = store.list_versions(p.id).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].label.as_deref(), Some("Before restore"));
    assert_eq!(store.get_version_spec(p.id, versions[0].id).unwrap().name, "Shelf v2");

    // Snapshotting an unchanged draft does not duplicate the latest version.
    store.snapshot_draft(p.id, "again", Author::Mcp).unwrap();
    store.snapshot_draft(p.id, "again", Author::Mcp).unwrap();
    assert_eq!(store.list_versions(p.id).unwrap().len(), 3);
}

#[test]
fn trash_restore_and_forever() {
    let store = Store::open_in_memory().unwrap();
    let p = store.create_project("Desk", &spec("Desk")).unwrap();
    assert!(
        store.delete_project_forever(p.id).is_err(),
        "only trashed projects can be purged"
    );
    store.trash_project(p.id).unwrap();
    assert!(store.list_projects(false).unwrap().is_empty());
    assert_eq!(store.list_projects(true).unwrap().len(), 1);
    store.restore_project(p.id).unwrap();
    store.trash_project(p.id).unwrap();
    store.delete_project_forever(p.id).unwrap();
    assert!(matches!(store.get_project(p.id), Err(StoreError::ProjectNotFound(_))));
}

#[test]
fn notes_pin_to_the_top() {
    let store = Store::open_in_memory().unwrap();
    let p = store.create_project("Table", &spec("Table")).unwrap();
    let a = store.create_note(p.id, "glue up first").unwrap();
    let b = store.create_note(p.id, "buy clamps").unwrap();
    store.update_note(a.id, None, Some(true)).unwrap();
    let notes = store.list_notes(p.id).unwrap();
    assert_eq!(notes.iter().map(|n| n.id).collect::<Vec<_>>(), [a.id, b.id]);
    store.delete_note(b.id).unwrap();
    assert_eq!(store.list_notes(p.id).unwrap().len(), 1);
}

#[test]
fn settings_round_trip() {
    let store = Store::open_in_memory().unwrap();
    store.set_setting("units", &serde_json::json!("mm")).unwrap();
    store.set_setting("kerf", &serde_json::json!(0.125)).unwrap();
    let s = store.settings().unwrap();
    assert_eq!(s["units"], "mm");
    assert_eq!(s["kerf"], 0.125);
    store.set_setting("units", &Value::Null).unwrap();
    assert!(!store.settings().unwrap().contains_key("units"));
}

#[test]
fn archives_round_trip_through_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    // Your own build steps (1.18) travel with the design.
    let mut planter = spec("Planter");
    let first = planter.parts[0].id.clone();
    planter.meta.as_mut().unwrap().build_steps = Some(vec![woodshop_core::spec::BuildStep {
        heading: "Glue it up".into(),
        part_ids: vec![first],
        note: Some("Clamp overnight.".into()),
    }]);
    let p = store.create_project("Planter", &planter).unwrap();
    store.create_version(p.id, &p.draft, Some("v1"), Author::User).unwrap();
    store.create_note(p.id, "cedar only").unwrap();
    let png = b"\x89PNG\r\n\x1a\nfake".to_vec();
    store.save_thumbnail(p.id, &png).unwrap();

    let archive = store.export_archive(p.id).unwrap();
    let mut buf = std::io::Cursor::new(Vec::new());
    archive.write(&mut buf).unwrap();
    buf.set_position(0);
    let read = ProjectArchive::read(buf).unwrap();
    assert_eq!(read, archive);

    let imported = store.import_archive(read).unwrap();
    assert_ne!(imported.id, p.id);
    assert_eq!(store.list_versions(imported.id).unwrap().len(), 1);
    assert_eq!(store.list_notes(imported.id).unwrap()[0].body, "cedar only");
    assert_eq!(std::fs::read(store.thumbnail_path(imported.id).unwrap()).unwrap(), png);
    let steps = imported.draft.meta.unwrap().build_steps.unwrap();
    assert_eq!(steps[0].heading, "Glue it up");
    assert_eq!(steps[0].note.as_deref(), Some("Clamp overnight."));

    // Shared to the gallery: the design and its picture, not the history or the notes.
    let shared = store.export_archive(p.id).unwrap().for_sharing();
    assert!(shared.versions.is_empty() && shared.notes.is_empty());
    assert_eq!(shared.draft, archive.draft);
    assert_eq!(shared.thumbnail.as_deref(), Some(&png[..]));

    // Zipped with its 3D plan for a gallery post, the design opens as any `.woodshop` file does.
    let mut design = std::io::Cursor::new(Vec::new());
    shared.write(&mut design).unwrap();
    let mut bundle = std::io::Cursor::new(Vec::new());
    crate::write_bundle(
        &mut bundle,
        &[
            ("Rack.woodshop", design.get_ref()),
            ("Rack 3D plan.html", b"<!DOCTYPE html>"),
        ],
    )
    .unwrap();
    bundle.set_position(0);
    let mut zip = zip::ZipArchive::new(bundle).unwrap();
    assert_eq!(zip.file_names().collect::<Vec<_>>().len(), 2);
    let mut inner = Vec::new();
    std::io::Read::read_to_end(&mut zip.by_name("Rack.woodshop").unwrap(), &mut inner).unwrap();
    assert_eq!(ProjectArchive::read(std::io::Cursor::new(inner)).unwrap(), shared);
}

#[test]
fn a_second_connection_sees_writes_via_data_version() {
    let dir = tempfile::tempdir().unwrap();
    let app = Store::open(dir.path()).unwrap();
    let mcp = Store::open(dir.path()).unwrap();
    let p = app.create_project("Rack", &spec("Rack")).unwrap();
    let before = app.data_version().unwrap();
    mcp.save_draft(p.id, &p.draft, None).unwrap();
    assert_ne!(app.data_version().unwrap(), before);
}

#[test]
fn imported_projects_keep_their_original_dates() {
    let store = Store::open_in_memory().unwrap();
    let p = store.create_project("Old bench", &spec("Old bench")).unwrap();
    store.set_project_dates(p.id, 1_000, 2_000, Some(3_000)).unwrap();
    let back = store.get_project(p.id).unwrap();
    assert_eq!(
        (back.created_at, back.draft_updated_at, back.deleted_at),
        (1_000, 2_000, Some(3_000))
    );
    assert_eq!(store.list_projects(true).unwrap().len(), 1, "trashed as it was");
    assert!(matches!(
        store.set_project_dates(99, 1, 1, None),
        Err(StoreError::ProjectNotFound(99))
    ));
}

#[test]
fn a_backup_holds_every_project_and_opens_on_its_own() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let a = store.create_project("Bench", &spec("Bench")).unwrap();
    store
        .create_version(a.id, &spec("Bench"), Some("first"), Author::User)
        .unwrap();
    store.create_project("Shelf", &spec("Shelf")).unwrap();

    let file = dir.path().join("backup.db");
    store.backup_to(&file).unwrap();
    store.backup_to(&file).unwrap(); // replacing an older backup is fine

    let copy = Store::open_file(&file).unwrap();
    let names: Vec<_> = copy.list_projects(false).unwrap().into_iter().map(|p| p.name).collect();
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"Bench".to_string()));
    assert_eq!(copy.list_versions(a.id).unwrap().len(), 1);
}

#[test]
fn an_assistant_chat_is_kept_per_project_and_goes_with_it() {
    let store = Store::open_in_memory().unwrap();
    let p = store.create_project("Box", &spec("Box")).unwrap();
    assert_eq!(store.assistant_chat(p.id).unwrap(), None);
    let chat =
        serde_json::json!({ "provider": "anthropic", "messages": [{ "from": "you", "text": "Hi" }], "history": [] });
    store.set_assistant_chat(p.id, &chat).unwrap();
    assert_eq!(store.assistant_chat(p.id).unwrap(), Some(chat.clone()));
    let next = serde_json::json!({ "provider": "anthropic", "messages": [], "history": [] });
    store.set_assistant_chat(p.id, &next).unwrap();
    assert_eq!(store.assistant_chat(p.id).unwrap(), Some(next));
    store.set_assistant_chat(p.id, &Value::Null).unwrap();
    assert_eq!(store.assistant_chat(p.id).unwrap(), None);

    // No chat for a project that isn't there, and none left behind when one is deleted.
    assert!(store.set_assistant_chat(p.id + 1, &chat).is_err());
    store.set_assistant_chat(p.id, &chat).unwrap();
    store.trash_project(p.id).unwrap();
    store.delete_project_forever(p.id).unwrap();
    let left: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM assistant_chats", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn a_library_from_the_first_schema_is_brought_up_to_date() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(MIGRATIONS[0]).unwrap();
    conn.pragma_update(None, "user_version", 1).unwrap();
    let store = Store::init(conn, None).unwrap();
    let version: i64 = store
        .conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, MIGRATIONS.len() as i64);
    let p = store.create_project("Box", &spec("Box")).unwrap();
    store.set_assistant_chat(p.id, &serde_json::json!({})).unwrap();
}

/// The smallest thing `check_glb` takes: a GLB header and a little padding.
fn glb(tag: u8) -> Vec<u8> {
    let mut bytes = b"glTF".to_vec();
    bytes.extend(2u32.to_le_bytes());
    bytes.extend(24u32.to_le_bytes());
    bytes.extend([tag; 12]);
    bytes
}

fn with_model(name: &str, hash: &str) -> Spec {
    let mut s = spec(name);
    s.models = Some(vec![woodshop_core::spec::ImportedModel {
        id: "m_box".into(),
        name: "Box".into(),
        hash: hash.into(),
        size: woodshop_core::spec::ModelSize {
            l: 10.0,
            w: 8.0,
            h: 6.0,
        },
        bytes: 24,
        source: None,
        license: None,
    }]);
    s.props = Some(vec![woodshop_core::spec::Prop {
        id: "pr_box".into(),
        item: None,
        model: Some("m_box".into()),
        name: None,
        pos: [0.0, 0.0, 20.0],
        rot: None,
        color: None,
        accent: None,
    }]);
    s
}

#[test]
fn models_are_kept_once_by_hash_and_must_be_glb() {
    let store = Store::open_in_memory().unwrap();
    let hash = store.put_model(&glb(1)).unwrap();
    assert_eq!(hash.len(), 64);
    assert_eq!(store.put_model(&glb(1)).unwrap(), hash);
    assert_ne!(store.put_model(&glb(2)).unwrap(), hash);
    assert_eq!(store.model(&hash).unwrap(), Some(glb(1)));
    assert_eq!(store.model(&"0".repeat(64)).unwrap(), None);
    assert!(
        store.put_model(b"solid cube\nendsolid").is_err(),
        "an STL is converted first"
    );
    assert!(store.put_model(&vec![0u8; 13_000_000]).is_err());
}

#[test]
fn a_woodshop_file_carries_the_models_its_design_shows() {
    let store = Store::open_in_memory().unwrap();
    let hash = store.put_model(&glb(7)).unwrap();
    let old = store.put_model(&glb(8)).unwrap();
    let p = store.create_project("Rack", &with_model("Rack", &old)).unwrap();
    store
        .create_version(p.id, &p.draft, Some("old box"), Author::User)
        .unwrap();
    store.save_draft(p.id, &with_model("Rack", &hash), None).unwrap();

    let archive = store.export_archive(p.id).unwrap();
    let mut hashes: Vec<&str> = archive.models.iter().map(|(h, _)| h.as_str()).collect();
    hashes.sort_unstable();
    let mut want = vec![hash.as_str(), old.as_str()];
    want.sort_unstable();
    assert_eq!(hashes, want, "the draft's and the history's");

    let mut buf = std::io::Cursor::new(Vec::new());
    archive.clone().for_sharing().write(&mut buf).unwrap();
    buf.set_position(0);
    let shared = ProjectArchive::read(buf).unwrap();
    assert_eq!(
        shared.models,
        vec![(hash.clone(), glb(7))],
        "a shared file carries the draft's only"
    );

    // Into a library that has never seen it.
    let other = Store::open_in_memory().unwrap();
    let mut tampered = shared.clone();
    tampered.models.push(("f".repeat(64), glb(9)));
    other.import_archive(tampered).unwrap();
    assert_eq!(other.model(&hash).unwrap(), Some(glb(7)));
    assert_eq!(
        other.model(&"f".repeat(64)).unwrap(),
        None,
        "a file that doesn't match its hash is left out"
    );
}
