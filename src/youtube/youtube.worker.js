import { config } from "../config.js";
import { refreshAccessToken } from "./youtube.oauth.js";
import { listCommentThreadsForChannel, replyToComment, getVideoTitle } from "./youtube.api.js";
import {
  listEnabledYtConnections,
  tokenExpiredSoon,
  updateYtTokenCache,
  getYtCommentAction,
  insertYtCommentAction,
  markYtCommentReplied,
  markYtCommentFailed,
  updateYtLastScan,
} from "./youtube.store.js";
import { generateCommentReply } from "../llm/deepseek.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseIso(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function pickNewestIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = parseIso(a);
  const tb = parseIso(b);
  if (ta === null) return b;
  if (tb === null) return a;
  return tb > ta ? b : a;
}

function sanitizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function shouldSkipComment(text) {
  const t = sanitizeText(text);
  if (!t) return true;
  if (t.length < 2) return true;
  // very naive link-only spam check
  const onlyLinks = t.replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, "").trim();
  if (!onlyLinks) return true;
  return false;
}

export async function runYouTubeCommentBot(db) {
  const conns = await listEnabledYtConnections(db);
  if (!conns.length) {
    console.log("[yt] no enabled connections");
    return;
  }

  console.log(`[yt] running for ${conns.length} connection(s)`);

  for (const conn0 of conns) {
    const ytChannelId = conn0.yt_channel_id;
    let conn = conn0;

    try {
      if (tokenExpiredSoon(conn)) {
        console.log(`[yt] refreshing token for ${ytChannelId} (${conn.channel_key})`);
        const rr = await refreshAccessToken(conn.refresh_token);
        if (!rr?.access_token) throw new Error("refresh did not return access_token");
        await updateYtTokenCache(db, ytChannelId, { accessToken: rr.access_token, expiresIn: rr.expires_in });
        conn = { ...conn, access_token: rr.access_token, obtained_at: Math.floor(Date.now()/1000), expires_in: rr.expires_in };
      }

      if (!conn.auto_reply) {
        console.log(`[yt] auto_reply disabled for ${ytChannelId}`);
        continue;
      }

      const lastScanIso = conn.last_scan_published_at || null;
      const lastScanT = lastScanIso ? parseIso(lastScanIso) : null;
      let newestSeenIso = lastScanIso;

      let pageToken = null;
      let repliedCount = 0;
      let stop = false;

      while (!stop) {
        const data = await listCommentThreadsForChannel(conn.access_token, {
          channelId: ytChannelId,
          pageToken,
          maxResults: 50,
          order: "time",
        });

        const items = data?.items || [];
        pageToken = data?.nextPageToken || null;

        for (const th of items) {
          const top = th?.snippet?.topLevelComment;
          const commentId = top?.id ? String(top.id) : null;
          const sn = top?.snippet || {};

          if (!commentId) continue;

          const publishedAt = sn.publishedAt ? String(sn.publishedAt) : null;
          const publishedT = publishedAt ? parseIso(publishedAt) : null;

          newestSeenIso = pickNewestIso(newestSeenIso, publishedAt);

          // Since order=time (newest first), once we reach older than last scan, we can stop.
          if (lastScanT !== null && publishedT !== null && publishedT <= lastScanT) {
            stop = true;
            break;
          }

          // Skip own comments
          const authorChannelId = sn.authorChannelId?.value ? String(sn.authorChannelId.value) : null;
          if (authorChannelId && authorChannelId === ytChannelId) continue;

          const commentText = sn.textOriginal || sn.textDisplay || "";
          if (shouldSkipComment(commentText)) continue;

          // Idempotency: record if new
          const existing = await getYtCommentAction(db, commentId);
          if (!existing) {
            await insertYtCommentAction(db, {
              commentId,
              ytChannelId,
              videoId: sn.videoId ? String(sn.videoId) : null,
              authorName: sn.authorDisplayName ? String(sn.authorDisplayName) : null,
              authorChannelId,
              publishedAt,
              text: sanitizeText(commentText).slice(0, 4000),
            });
          } else {
            if (existing.status === "replied") continue;
            if (existing.status === "failed") continue;
          }

          // Generate reply
          let videoTitle = null;
          try {
            if (sn.videoId) {
              videoTitle = await getVideoTitle(conn.access_token, String(sn.videoId));
            }
          } catch {
            videoTitle = null;
          }

          const replyText = await generateCommentReply({
            platform: "youtube",
            channelTitle: conn.yt_channel_title,
            videoTitle,
            authorName: sn.authorDisplayName,
            commentText: sanitizeText(commentText),
          });

          const finalReply = sanitizeText(replyText).slice(0, 9500);
          if (!finalReply) {
            await markYtCommentFailed(db, commentId, "empty_reply");
            continue;
          }

          // Post reply
          try {
            const rr = await replyToComment(conn.access_token, { parentId: commentId, message: finalReply });
            const replyId = rr?.id ? String(rr.id) : null;
            await markYtCommentReplied(db, commentId, { replyCommentId: replyId, repliedAtIso: new Date().toISOString() });

            repliedCount += 1;
            console.log(`[yt] replied (${repliedCount}) channel=${conn.channel_key} comment=${commentId}`);
          } catch (e) {
            const msg = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 1200) : (e?.message || String(e));
            await markYtCommentFailed(db, commentId, msg);
            console.log(`[yt] reply failed channel=${conn.channel_key} comment=${commentId} err=${msg}`);
          }

          if (repliedCount >= config.worker.maxRepliesPerRun) {
            stop = true;
            break;
          }

          await sleep(config.worker.replyCooldownSeconds * 1000);
        }

        if (!pageToken) break;
      }

      // Persist scan cursor even if no replies (so we don't rescan forever)
      if (newestSeenIso && newestSeenIso !== lastScanIso) {
        await updateYtLastScan(db, ytChannelId, newestSeenIso);
      }

      console.log(`[yt] done channel=${conn.channel_key} replied=${repliedCount} newestSeen=${newestSeenIso || "—"}`);

    } catch (e) {
      console.log(`[yt] error on channel=${conn0.channel_key}:`, e?.message || String(e));
    }
  }
}
