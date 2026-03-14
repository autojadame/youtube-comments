require("dotenv").config();

const { getDb } = require("./db/db");
const { logger } = require("./logger");
const { buildOAuthClient } = require("./youtube/oauth");
const { youtubeClient, listLatestThreadsForChannel, replyToComment } = require("./youtube/api");
const { deepseekChat } = require("./llm/deepseek");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 60);
const MAX_THREADS_PER_POLL = Number(process.env.MAX_THREADS_PER_POLL || 50);
const MAX_REPLIES_PER_POLL = Number(process.env.MAX_REPLIES_PER_POLL || 10);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function refreshAccessTokenIfNeeded(db, conn, oauthClientRow) {
  const now = Date.now();
  const expiry = conn.token_expiry ? Date.parse(conn.token_expiry) : 0;

  const redirectUri = `${BASE_URL.replace(/\/$/, "")}/oauth2/callback`;
  const oAuth2Client = buildOAuthClient({
    client_id: oauthClientRow.client_id,
    client_secret: oauthClientRow.client_secret,
    redirect_uri: redirectUri,
  });

  oAuth2Client.setCredentials({
    access_token: conn.access_token,
    refresh_token: conn.refresh_token,
    expiry_date: expiry || undefined,
    scope: conn.scope || undefined,
  });

  if (expiry && now < (expiry - 60_000)) {
    return oAuth2Client;
  }

  if (!conn.refresh_token) {
    throw new Error("Missing refresh_token. Reconnect OAuth (need prompt=consent once).");
  }

  const res = await oAuth2Client.refreshAccessToken();
  const tokens = res.credentials || {};
  if (tokens.access_token) {
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : conn.token_expiry;
    await db.run(
      "UPDATE youtube_connections SET access_token=?, token_expiry=?, updated_at=datetime('now') WHERE id=?",
      [tokens.access_token, tokenExpiry, conn.id]
    );
  }
  return oAuth2Client;
}

function extractTopLevelComment(thread) {
  const top = thread?.snippet?.topLevelComment;
  const c = top?.snippet;
  if (!top?.id || !c) return null;
  return {
    commentId: top.id,
    text: (c.textDisplay || c.textOriginal || "").trim(),
    authorChannelId: c?.authorChannelId?.value || null,
    publishedAt: c.publishedAt || null,
    videoId: thread?.snippet?.videoId || null,
  };
}

function shouldReplyToComment(comment, channelId) {
  if (!comment?.text) return false;
  if (comment.authorChannelId && comment.authorChannelId === channelId) return false;

  const t = comment.text.toLowerCase();
  if (t.includes("http://") || t.includes("https://")) return false;
  if (t.length < 2) return false;

  return true;
}

async function runOnce() {
  const db = await getDb();

  const connections = await db.all(
    "SELECT * FROM youtube_connections WHERE enabled = 1 ORDER BY id ASC"
  );

  for (const conn of connections) {
    const oauthClientRow = await db.get("SELECT * FROM oauth_clients WHERE id = ?", [conn.oauth_client_id]);
    if (!oauthClientRow) continue;

    try {
      const auth = await refreshAccessTokenIfNeeded(db, conn, oauthClientRow);
      const yt = youtubeClient(auth);

      const threads = await listLatestThreadsForChannel(yt, conn.channel_id, MAX_THREADS_PER_POLL);

      let repliedCount = 0;
      for (const thread of threads) {
        if (repliedCount >= MAX_REPLIES_PER_POLL) break;

        const comment = extractTopLevelComment(thread);
        if (!comment) continue;
        if (!shouldReplyToComment(comment, conn.channel_id)) continue;

        const already = await db.get(
          "SELECT 1 FROM youtube_replied_comments WHERE connection_id=? AND comment_id=?",
          [conn.id, comment.commentId]
        );
        if (already) continue;

        const lang = process.env.REPLY_LANGUAGE || "es";
        const system = defaultSystemPrompt(lang);
        const userPrompt = buildUserPrompt(lang, comment.text);

        const reply = await deepseekChat({ system, user: userPrompt });

        await replyToComment(yt, comment.commentId, reply);

        await db.run(
          `INSERT INTO youtube_replied_comments
           (connection_id, comment_id, video_id, author_channel_id, comment_published_at, reply_text)
           VALUES (?,?,?,?,?,?)`,
          [conn.id, comment.commentId, comment.videoId, comment.authorChannelId, comment.publishedAt, reply]
        );

        repliedCount += 1;
        await sleep(700);
      }

      await db.run(
        "UPDATE youtube_connections SET last_polled_at=datetime('now'), last_error=NULL, updated_at=datetime('now') WHERE id=?",
        [conn.id]
      );

      if (repliedCount > 0) {
        logger.info({ channel: conn.channel_id, repliedCount }, "Replied to comments");
      }
    } catch (e) {
      logger.error({ err: e.message, channel: conn.channel_id }, "Worker error");
      await db.run(
        "UPDATE youtube_connections SET last_error=?, updated_at=datetime('now') WHERE id=?",
        [e.message, conn.id]
      );
    }
  }
}

function defaultSystemPrompt(lang) {
  if (lang === "en") {
    return [
      "You are the owner of this YouTube channel replying to viewers.",
      "Write warm, human, concise replies (1-2 sentences).",
      "No links. No sales. No personal data requests.",
      "If hateful/trolling: either ignore or reply calmly without escalating.",
      "Output ONLY the reply text (no quotes, no labels).",
    ].join("\n");
  }
  return [
    "Eres el dueño de este canal de YouTube respondiendo a los espectadores.",
    "Responde con calidez, humano y breve (1-2 frases).",
    "Sin enlaces. Sin vender. Sin pedir datos personales.",
    "Si es odio/trolleo: ignora o responde con calma sin escalar.",
    "Devuelve SOLO el texto de la respuesta (sin comillas, sin etiquetas).",
  ].join("\n");
}

function buildUserPrompt(lang, commentText) {
  if (lang === "en") {
    return `Viewer comment:\n${commentText}\n\nReply:`;
  }
  return `Comentario del espectador:\n${commentText}\n\nRespuesta:`;
}

async function loop() {
  logger.info({ interval: POLL_INTERVAL_SECONDS }, "Worker started in loop mode");
  while (true) {
    await runOnce();
    await sleep(POLL_INTERVAL_SECONDS * 1000);
  }
}

async function main() {
  const loopMode = process.argv.includes("--loop");

  if (loopMode) {
    await loop();
    return;
  }

  logger.info("Worker started in single-run mode");
  await runOnce();
  logger.info("Worker finished");
}

main().catch((e) => {
  logger.error(e, "Worker crashed");
  process.exit(1);
});
