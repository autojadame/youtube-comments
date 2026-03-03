// src/meta/meta.store.js

export function getConnectionsByOrgId(db, orgId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT org_id, org_name, lang, channel, page_id, ig_user_id, ig_username, updated_at
       FROM meta_connections
       WHERE org_id = ?
       ORDER BY lang ASC`,
      [orgId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

export function upsertConnection(db, {
  orgId,
  orgName = null,
  lang,
  channel,
  fbUserId,
  longUserToken,
  pageId,
  pageToken,
  igUserId = null,
  igUsername = null,
}) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO meta_connections (
        org_id, org_name, lang, channel,
        fb_user_id, long_user_token,
        page_id, page_token,
        ig_user_id, ig_username,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(org_id, lang) DO UPDATE SET
        org_name        = excluded.org_name,
        channel         = excluded.channel,
        fb_user_id      = excluded.fb_user_id,
        long_user_token = excluded.long_user_token,
        page_id         = excluded.page_id,
        page_token      = excluded.page_token,
        ig_user_id      = excluded.ig_user_id,
        ig_username     = excluded.ig_username,
        updated_at      = datetime('now')
    `;

    const params = [
      orgId, orgName, lang, channel,
      fbUserId, longUserToken,
      pageId, pageToken,
      igUserId, igUsername,
    ];

    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ ok: true });
    });
  });
}

export function getConnection(db, orgId, lang) {
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT org_id, lang, fb_user_id, long_user_token, page_id, page_token, ig_user_id, ig_username, created_at, updated_at, channel
      FROM meta_connections
      WHERE org_id=? AND lang=?
      `,
      [orgId, lang],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}


/**
 * Guarda/actualiza el long-lived user token asociado a un "channel" (nombre de Page).
 * channel se guarda normalizado (lowercase + trim).
 */
export async function upsertMetaToken(db, { channel, accessToken, expiresIn }) {
  if (!channel) throw new Error("channel required");
  if (!accessToken) throw new Error("accessToken required");

  const obtainedAt = Math.floor(Date.now() / 1000);
  const normChannel = channel.trim().toLowerCase();

  await db.run(
    `INSERT INTO meta_tokens (channel, access_token, obtained_at, expires_in)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(channel) DO UPDATE SET
       access_token=excluded.access_token,
       obtained_at=excluded.obtained_at,
       expires_in=excluded.expires_in`,
    [normChannel, accessToken, obtainedAt, expiresIn ?? null]
  );

  return { channel: normChannel, obtainedAt, expiresIn: expiresIn ?? null };
}
export function enqueuePublishJob(db, job) {
  const now = Math.floor(Date.now() / 1000);
  const {
    channel, platform, video_filename, video_url, title, caption, publish_at,
  } = job;

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO meta_publish_jobs
       (channel, platform, video_filename, video_url, title, caption, publish_at, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [
        channel.trim().toLowerCase(),
        platform,
        video_filename,
        video_url,
        title || null,
        caption || "",
        Number(publish_at),
        now,
        now,
      ],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      }
    );
  });
}

export function markExpiredOldJobs(db, olderThanUnix) {
  const now = Math.floor(Date.now() / 1000);
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE meta_publish_jobs
       SET status='expired', updated_at=?
       WHERE status IN ('pending','processing')
         AND publish_at < ?`,
      [now, olderThanUnix],
      (err) => (err ? reject(err) : resolve(true))
    );
  });
}

export function listActiveJobFiles(db, activeSinceUnix) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT DISTINCT video_filename
       FROM meta_publish_jobs
       WHERE status IN ('pending','processing')
         AND publish_at >= ?`,
      [activeSinceUnix],
      (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.video_filename)))
    );
  });
}

// ------------------------------------------------------------
// NEW: helpers for comment bot
// ------------------------------------------------------------
export function listAllMetaConnections(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT org_id, org_name, lang, channel, page_id, page_token, ig_user_id, ig_username, long_user_token, updated_at
       FROM meta_connections
       ORDER BY updated_at DESC`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

export function upsertMetaCommentState(db, { platform, assetId, lastSeenTs }) {
  return db.runAsync(
    `INSERT INTO meta_comment_state (platform, asset_id, last_seen_ts, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(platform, asset_id) DO UPDATE SET
       last_seen_ts=excluded.last_seen_ts,
       updated_at=datetime('now')`,
    [platform, assetId, lastSeenTs || null]
  );
}

export async function getMetaCommentState(db, { platform, assetId }) {
  return db.getAsync(
    `SELECT platform, asset_id, last_seen_ts FROM meta_comment_state WHERE platform=? AND asset_id=?`,
    [platform, assetId]
  );
}

export async function recordMetaCommentAction(db, row) {
  const {
    commentId,
    platform,
    assetId,
    postId = null,
    mediaId = null,
    username = null,
    createdTime = null,
    text = null,
  } = row;

  await db.runAsync(
    `INSERT OR IGNORE INTO meta_comment_actions
     (comment_id, platform, asset_id, post_id, media_id, username, created_time, text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
    [commentId, platform, assetId, postId, mediaId, username, createdTime, text]
  );
}

export async function getMetaCommentAction(db, commentId) {
  return db.getAsync(
    `SELECT * FROM meta_comment_actions WHERE comment_id=?`,
    [commentId]
  );
}

export async function markMetaCommentDone(db, commentId, { replied = false, liked = false, replyId = null }) {
  await db.runAsync(
    `UPDATE meta_comment_actions
     SET replied=?, liked=?, reply_id=?, status='done', updated_at=datetime('now')
     WHERE comment_id=?`,
    [replied ? 1 : 0, liked ? 1 : 0, replyId, commentId]
  );
}

export async function markMetaCommentFailed(db, commentId, error) {
  await db.runAsync(
    `UPDATE meta_comment_actions
     SET status='failed', error=?, updated_at=datetime('now')
     WHERE comment_id=?`,
    [String(error || "unknown").slice(0, 1200), commentId]
  );
}
