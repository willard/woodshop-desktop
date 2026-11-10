-- v1: the project library. Specs are stored as JSON text, migrated on read by woodshop-core.
CREATE TABLE projects (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    draft            TEXT    NOT NULL,
    spec_version     TEXT    NOT NULL,
    part_count       INTEGER NOT NULL DEFAULT 0,
    draft_updated_at INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    thumbnail_at     INTEGER,
    deleted_at       INTEGER
);
CREATE INDEX projects_recent ON projects (deleted_at, draft_updated_at DESC);

-- Append-only snapshots.
CREATE TABLE versions (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    spec         TEXT    NOT NULL,
    spec_version TEXT    NOT NULL,
    created_by   TEXT    NOT NULL CHECK (created_by IN ('user', 'mcp')),
    label        TEXT,
    created_at   INTEGER NOT NULL
);
CREATE INDEX versions_by_project ON versions (project_id, created_at DESC, id DESC);

CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX notes_by_project ON notes (project_id, pinned DESC, updated_at DESC);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
