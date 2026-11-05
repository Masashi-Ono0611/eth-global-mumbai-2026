CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  page TEXT NOT NULL,
  anchor TEXT NOT NULL,
  anchor_text TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX comments_page ON comments (page, created_at);
