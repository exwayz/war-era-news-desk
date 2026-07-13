CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  posted_by TEXT NOT NULL DEFAULT '',
  upvotes INTEGER NOT NULL DEFAULT 0,
  upvoters TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_posted_by ON messages(posted_by);
