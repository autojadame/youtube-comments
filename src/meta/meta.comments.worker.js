import axios from "axios";
import { config } from "../config.js";
import { generateCommentReply } from "../llm/deepseek.js";
import {
  listAllMetaConnections,
  getMetaCommentState,
  upsertMetaCommentState,
  recordMetaCommentAction,
  getMetaCommentAction,
  markMetaCommentDone,
  markMetaCommentFailed,
} from "./meta.store.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function baseUrl() {
  return `https://graph.facebook.com/${config.meta.graphVersion}`;
}

async function graphGet(path, params) {
  const url = `${baseUrl()}${path}`;
  const res = await axios.get(url, { params, timeout: 60_000 });
  return res.data;
}

async function graphPostParams(path, params) {
  const url = `${baseUrl()}${path}`;
  const res = await axios.post(url, null, { params, timeout: 60_000 });
  return res.data;
}

function parseIsoOrNull(s) {
  const t = Date.parse(String(s || ""));
  return Number.isFinite(t) ? t : null;
}

function pickNewest(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = parseIsoOrNull(a);
  const tb = parseIsoOrNull(b);
  if (ta === null) return b;
  if (tb === null) return a;
  return tb > ta ? b : a;
}

function sanitizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export async function runMetaCommentBot(db) {
  const rows = await listAllMetaConnections(db);
  if (!rows.length) {
    console.log("[meta] no connections");
    return;
  }

  // Deduplicate pages and ig users across EN/ES mappings
  const fbPages = new Map();
  const igUsers = new Map();

  for (const r of rows) {
    if (r.page_id && r.page_token) {
      fbPages.set(String(r.page_id), {
        pageId: String(r.page_id),
        token: String(r.page_token),
        orgName: r.org_name || r.org_id || null,
      });
    }
    if (r.ig_user_id && r.long_user_token) {
      igUsers.set(String(r.ig_user_id), {
        igUserId: String(r.ig_user_id),
        token: String(r.long_user_token),
        igUsername: r.ig_username || null,
        orgName: r.org_name || r.org_id || null,
      });
    }
  }

  console.log(`[meta] running fb_pages=${fbPages.size} ig_users=${igUsers.size}`);

  // -----------------------------
  // Facebook Pages: reply + like
  // -----------------------------
  for (const { pageId, token, orgName } of fbPages.values()) {
    let state = await getMetaCommentState(db, { platform: "fb", assetId: pageId });
    const lastSeenTs = state?.last_seen_ts || null;
    const lastSeenT = lastSeenTs ? parseIsoOrNull(lastSeenTs) : null;

    let newestSeen = lastSeenTs;
    let done = 0;

    try {
      const feed = await graphGet(`/${pageId}/feed`, {
        access_token: token,
        fields: "id,created_time",
        limit: 8,
      });

      const posts = feed?.data || [];
      for (const p of posts) {
        if (done >= config.worker.maxRepliesPerRun) break;
        const postId = String(p.id || "");
        if (!postId) continue;

        const comments = await graphGet(`/${postId}/comments`, {
          access_token: token,
          fields: "id,message,created_time,from",
          limit: 50,
        });

        const arr = comments?.data || [];
        for (const c of arr) {
          if (done >= config.worker.maxRepliesPerRun) break;
          const commentId = c?.id ? String(c.id) : null;
          const createdTime = c?.created_time ? String(c.created_time) : null;
          const createdT = createdTime ? parseIsoOrNull(createdTime) : null;

          newestSeen = pickNewest(newestSeen, createdTime);

          if (!commentId) continue;
          if (lastSeenT !== null && createdT !== null && createdT <= lastSeenT) continue;

          const text = sanitizeText(c?.message || "");
          if (!text) continue;

          const existing = await getMetaCommentAction(db, commentId);
          if (existing?.status === "done") continue;

          await recordMetaCommentAction(db, {
            commentId,
            platform: "fb",
            assetId: pageId,
            postId,
            createdTime,
            username: c?.from?.name ? String(c.from.name) : null,
            text: text.slice(0, 4000),
          });

          // Reply
          const replyText = await generateCommentReply({
            platform: "facebook",
            channelTitle: orgName,
            videoTitle: null,
            authorName: c?.from?.name || null,
            commentText: text,
          });

          const finalReply = sanitizeText(replyText).slice(0, 750);
          if (!finalReply) {
            await markMetaCommentFailed(db, commentId, "empty_reply");
            continue;
          }

          try {
            const rr = await graphPostParams(`/${commentId}/comments`, {
              access_token: token,
              message: finalReply,
            });
            const replyId = rr?.id ? String(rr.id) : null;

            // Like the original comment (Page like)
            try {
              await graphPostParams(`/${commentId}/likes`, { access_token: token });
            } catch {
              // non-fatal
            }

            await markMetaCommentDone(db, commentId, { replied: true, liked: true, replyId });
            done += 1;
            console.log(`[meta][fb] replied (${done}) page=${pageId} comment=${commentId}`);
          } catch (e) {
            const msg = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 1200) : (e?.message || String(e));
            await markMetaCommentFailed(db, commentId, msg);
            console.log(`[meta][fb] failed page=${pageId} comment=${commentId} err=${msg}`);
          }

          await sleep(config.worker.replyCooldownSeconds * 1000);
        }
      }

      if (newestSeen && newestSeen !== lastSeenTs) {
        await upsertMetaCommentState(db, { platform: "fb", assetId: pageId, lastSeenTs: newestSeen });
      }

      console.log(`[meta][fb] done page=${pageId} replied=${done} newestSeen=${newestSeen || "—"}`);

    } catch (e) {
      console.log(`[meta][fb] error page=${pageId}`, e?.message || String(e));
    }
  }

  // -----------------------------
  // Instagram: reply only
  // -----------------------------
  for (const { igUserId, token, igUsername, orgName } of igUsers.values()) {
    let state = await getMetaCommentState(db, { platform: "ig", assetId: igUserId });
    const lastSeenTs = state?.last_seen_ts || null;
    const lastSeenT = lastSeenTs ? parseIsoOrNull(lastSeenTs) : null;

    let newestSeen = lastSeenTs;
    let done = 0;

    try {
      const media = await graphGet(`/${igUserId}/media`, {
        access_token: token,
        fields: "id,timestamp",
        limit: 8,
      });

      const items = media?.data || [];
      for (const m of items) {
        if (done >= config.worker.maxRepliesPerRun) break;
        const mediaId = m?.id ? String(m.id) : null;
        if (!mediaId) continue;

        const comments = await graphGet(`/${mediaId}/comments`, {
          access_token: token,
          fields: "id,text,timestamp,username",
          limit: 50,
        });

        const arr = comments?.data || [];
        for (const c of arr) {
          if (done >= config.worker.maxRepliesPerRun) break;

          const commentId = c?.id ? String(c.id) : null;
          const ts = c?.timestamp ? String(c.timestamp) : null;
          const t = ts ? parseIsoOrNull(ts) : null;

          newestSeen = pickNewest(newestSeen, ts);

          if (!commentId) continue;
          if (lastSeenT !== null && t !== null && t <= lastSeenT) continue;

          const text = sanitizeText(c?.text || "");
          if (!text) continue;

          const existing = await getMetaCommentAction(db, commentId);
          if (existing?.status === "done") continue;

          await recordMetaCommentAction(db, {
            commentId,
            platform: "ig",
            assetId: igUserId,
            mediaId,
            createdTime: ts,
            username: c?.username ? String(c.username) : null,
            text: text.slice(0, 4000),
          });

          const replyText = await generateCommentReply({
            platform: "instagram",
            channelTitle: igUsername || orgName,
            videoTitle: null,
            authorName: c?.username || null,
            commentText: text,
          });

          const finalReply = sanitizeText(replyText).slice(0, 750);
          if (!finalReply) {
            await markMetaCommentFailed(db, commentId, "empty_reply");
            continue;
          }

          try {
            // Reply to IG comment: POST /{ig-comment-id}/replies?message=...
            const rr = await graphPostParams(`/${commentId}/replies`, {
              access_token: token,
              message: finalReply,
            });
            const replyId = rr?.id ? String(rr.id) : null;

            // IG "like" for comments is not exposed in official IG Graph API.
            await markMetaCommentDone(db, commentId, { replied: true, liked: false, replyId });
            done += 1;
            console.log(`[meta][ig] replied (${done}) ig=${igUsername || igUserId} comment=${commentId}`);

          } catch (e) {
            const msg = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 1200) : (e?.message || String(e));
            await markMetaCommentFailed(db, commentId, msg);
            console.log(`[meta][ig] failed ig=${igUsername || igUserId} comment=${commentId} err=${msg}`);
          }

          await sleep(config.worker.replyCooldownSeconds * 1000);
        }
      }

      if (newestSeen && newestSeen !== lastSeenTs) {
        await upsertMetaCommentState(db, { platform: "ig", assetId: igUserId, lastSeenTs: newestSeen });
      }

      console.log(`[meta][ig] done ig=${igUsername || igUserId} replied=${done} newestSeen=${newestSeen || "—"}`);

    } catch (e) {
      console.log(`[meta][ig] error ig=${igUsername || igUserId}`, e?.message || String(e));
    }
  }
}
