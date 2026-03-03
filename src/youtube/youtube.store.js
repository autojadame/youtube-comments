function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export async function upsertYtConnection(db, {
  ytChannelId,
  ytChannelTitle = null,
  channelKey,
  orgName = null,
  orgId = null,
  googleUserId = null,
  googleEmail = null,
  refreshToken,
  accessToken = null,
  obtainedAt = null,
  expiresIn = null,
  enabled = 1,
  autoReply = 1,
  autoHeart = 0,
}) {
  if (!ytChannelId) throw new Error("ytChannelId required");
  if (!channelKey) throw new Error("channelKey required");
  if (!refreshToken) throw new Error("refreshToken required");

  const sql = `
    INSERT INTO yt_connections (
      yt_channel_id, yt_channel_title, channel_key, org_name, org_id,
      google_user_id, google_email,
      refresh_token, access_token, obtained_at, expires_in,
      enabled, auto_reply, auto_heart,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(yt_channel_id) DO UPDATE SET
      yt_channel_title = excluded.yt_channel_title,
      channel_key      = excluded.channel_key,
      org_name         = excluded.org_name,
      org_id           = excluded.org_id,
      google_user_id   = excluded.google_user_id,
      google_email     = excluded.google_email,
      refresh_token    = excluded.refresh_token,
      access_token     = excluded.access_token,
      obtained_at      = excluded.obtained_at,
      expires_in       = excluded.expires_in,
      enabled          = excluded.enabled,
      auto_reply       = excluded.auto_reply,
      auto_heart       = excluded.auto_heart,
      updated_at       = datetime('now')
  `;

  await db.runAsync(sql, [
    ytChannelId,
    ytChannelTitle,
    channelKey,
    orgName,
    orgId,
    googleUserId,
    googleEmail,
    refreshToken,
    accessToken,
    obtainedAt,
    expiresIn,
    enabled ? 1 : 0,
    autoReply ? 1 : 0,
    autoHeart ? 1 : 0,
  ]);

  return { ok: true };
}

export async function listYtConnections(db) {
  return db.allAsync(
    `SELECT yt_channel_id, yt_channel_title, channel_key, org_name, enabled, auto_reply, auto_heart, last_scan_published_at, updated_at
     FROM yt_connections
     ORDER BY updated_at DESC`
  );
}

export async function getYtConnection(db, ytChannelId) {
  return db.getAsync(
    `SELECT * FROM yt_connections WHERE yt_channel_id = ?`,
    [ytChannelId]
  );
}

export async function getYtConnectionByKey(db, channelKey) {
  return db.getAsync(
    `SELECT * FROM yt_connections WHERE channel_key = ?`,
    [String(channelKey || "").trim()]
  );
}

export async function listEnabledYtConnections(db) {
  return db.allAsync(
    `SELECT * FROM yt_connections WHERE enabled = 1 ORDER BY updated_at DESC`
  );
}

export async function updateYtTokenCache(db, ytChannelId, { accessToken, expiresIn }) {
  const obtainedAt = nowUnix();
  await db.runAsync(
    `UPDATE yt_connections
     SET access_token=?, obtained_at=?, expires_in=?, updated_at=datetime('now')
     WHERE yt_channel_id=?`,
    [accessToken, obtainedAt, expiresIn ?? null, ytChannelId]
  );
}

export function tokenExpiredSoon(row, skewSeconds = 60) {
  if (!row?.access_token || !row?.obtained_at || !row?.expires_in) return true;
  const exp = Number(row.obtained_at) + Number(row.expires_in);
  return (nowUnix() + skewSeconds) >= exp;
}

export async function getYtCommentAction(db, commentId) {
  return db.getAsync(
    `SELECT * FROM yt_comment_actions WHERE comment_id = ?`,
    [commentId]
  );
}

export async function insertYtCommentAction(db, {
  commentId,
  ytChannelId,
  videoId = null,
  authorName = null,
  authorChannelId = null,
  publishedAt = null,
  text = null,
}) {
  const sql = `
    INSERT OR IGNORE INTO yt_comment_actions (
      comment_id, yt_channel_id, video_id, author_name, author_channel_id, published_at, text,
      status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
  `;

  await db.runAsync(sql, [
    commentId,
    ytChannelId,
    videoId,
    authorName,
    authorChannelId,
    publishedAt,
    text,
  ]);
}

export async function markYtCommentReplied(db, commentId, {
  replyCommentId,
  repliedAtIso,
}) {
  await db.runAsync(
    `UPDATE yt_comment_actions
     SET status='replied', reply_comment_id=?, replied_at=?, updated_at=datetime('now')
     WHERE comment_id=?`,
    [replyCommentId || null, repliedAtIso || new Date().toISOString(), commentId]
  );
}

export async function markYtCommentFailed(db, commentId, error) {
  await db.runAsync(
    `UPDATE yt_comment_actions
     SET status='failed', error=?, updated_at=datetime('now')
     WHERE comment_id=?`,
    [String(error || "unknown"), commentId]
  );
}

export async function updateYtLastScan(db, ytChannelId, lastPublishedAtIso) {
  await db.runAsync(
    `UPDATE yt_connections
     SET last_scan_published_at=?, updated_at=datetime('now')
     WHERE yt_channel_id=?`,
    [lastPublishedAtIso || null, ytChannelId]
  );
}
