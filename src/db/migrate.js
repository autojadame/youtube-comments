require("dotenv").config();
const { getDb } = require("./db");

async function migrate() {
  const db = await getDb();

  await db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS youtube_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oauth_client_id INTEGER NOT NULL,
  connection_key TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  channel_title TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TEXT,
  scope TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_polled_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(oauth_client_id) REFERENCES oauth_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_replied_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL,
  comment_id TEXT NOT NULL,
  video_id TEXT,
  author_channel_id TEXT,
  comment_published_at TEXT,
  reply_text TEXT,
  replied_at TEXT DEFAULT (datetime('now')),
  UNIQUE(connection_id, comment_id),
  FOREIGN KEY(connection_id) REFERENCES youtube_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_replied_connection ON youtube_replied_comments(connection_id);
  `);

  console.log("OK: migrations applied.");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
