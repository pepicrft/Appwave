-- Drop project_type column since it can be inferred from path
-- SQLite doesn't support DROP COLUMN directly, so we recreate the table

CREATE TABLE projects_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    last_opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO projects_new (id, path, name, last_opened_at, created_at)
SELECT id, path, name, last_opened_at, created_at FROM projects;

DROP TABLE projects;

ALTER TABLE projects_new RENAME TO projects;
