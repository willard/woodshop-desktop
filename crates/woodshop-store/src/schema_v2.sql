-- v2: the design assistant's conversation about each project, as the chat panel saved it (the
-- messages it shows and the provider's own message list). Gone with the project.
CREATE TABLE assistant_chats (
    project_id INTEGER PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
    chat       TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
);
