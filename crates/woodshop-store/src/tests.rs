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
    let p = store.create_project("Planter", &spec("Planter")).unwrap();
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
