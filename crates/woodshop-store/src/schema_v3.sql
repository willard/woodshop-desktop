-- v3: 3D models imported for props (spec 1.22), as GLB files, kept once each by the SHA-256 of
-- their bytes however many designs show them. In the database so a backup carries them.
CREATE TABLE models (
    hash       TEXT    PRIMARY KEY,
    glb        BLOB    NOT NULL,
    bytes      INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
