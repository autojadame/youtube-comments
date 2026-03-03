PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- META (existing tables used by your current project)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_tokens (
  channel      TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  obtained_at  INTEGER NOT NULL,
  expires_in   INTEGER
);

CREATE TABLE IF NOT EXISTS meta_connections (
  org_id         TEXT NOT NULL,
  org_name       TEXT,
  lang           TEXT NOT NULL CHECK(lang IN ('en','es')),
  channel        TEXT NOT NULL,
  fb_user_id     TEXT,
  long_user_token TEXT NOT NULL,
  page_id        TEXT NOT NULL,
  page_token     TEXT NOT NULL,
  ig_user_id     TEXT,
  ig_username    TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, lang)
);

CREATE TABLE IF NOT EXISTS meta_publish_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT NOT NULL,
  platform      TEXT NOT NULL,
  video_filename TEXT NOT NULL,
  video_url     TEXT NOT NULL,
  title         TEXT,
  caption       TEXT,
  publish_at    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_jobs_status_publish
  ON meta_publish_jobs(status, publish_at);

-- ------------------------------------------------------------
-- META comment bot support (new)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_comment_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  platform     TEXT NOT NULL CHECK(platform IN ('fb','ig')),
  asset_id     TEXT NOT NULL,
  last_seen_ts TEXT,
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(platform, asset_id)
);

CREATE TABLE IF NOT EXISTS meta_comment_actions (
  comment_id   TEXT PRIMARY KEY,
  platform     TEXT NOT NULL CHECK(platform IN ('fb','ig')),
  asset_id     TEXT NOT NULL,
  post_id      TEXT,
  media_id     TEXT,
  username     TEXT,
  created_time TEXT,
  text         TEXT,
  replied      INTEGER NOT NULL DEFAULT 0,
  liked        INTEGER NOT NULL DEFAULT 0,
  reply_id     TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  error        TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_comment_actions_status
  ON meta_comment_actions(status, platform);

-- ------------------------------------------------------------
-- YOUTUBE comment bot support (new)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yt_connections (
  yt_channel_id     TEXT PRIMARY KEY,
  yt_channel_title  TEXT,
  channel_key       TEXT NOT NULL,
  org_name          TEXT,
  org_id            TEXT,
  google_user_id    TEXT,
  google_email      TEXT,

  refresh_token     TEXT NOT NULL,
  access_token      TEXT,
  obtained_at       INTEGER,
  expires_in        INTEGER,

  enabled           INTEGER NOT NULL DEFAULT 1,
  auto_reply        INTEGER NOT NULL DEFAULT 1,
  auto_heart        INTEGER NOT NULL DEFAULT 0,

  last_scan_published_at TEXT,

  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),

  UNIQUE(channel_key)
);

CREATE TABLE IF NOT EXISTS yt_comment_actions (
  comment_id        TEXT PRIMARY KEY,
  yt_channel_id     TEXT NOT NULL,
  video_id          TEXT,
  author_name       TEXT,
  author_channel_id TEXT,
  published_at      TEXT,
  text              TEXT,
  reply_comment_id  TEXT,
  replied_at        TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  error             TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (yt_channel_id) REFERENCES yt_connections(yt_channel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_yt_comment_actions_status
  ON yt_comment_actions(status, yt_channel_id);
