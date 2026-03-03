// src/api/internal.routes.js
import express from "express";
import path from "path";
import fs from "fs/promises";

import { config } from "../config.js";
import { getConnection, enqueuePublishJob } from "../meta/meta.store.js";
import { canonicalVideoFilename } from "../utils/filename.js";

const VIDEOS_DIR = process.env.VIDEOS_DIR
  ? path.resolve(process.env.VIDEOS_DIR)
  : path.resolve(process.cwd(), "videos");

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export function internalRoutes(db) {
  const r = express.Router();

  function requireApiKey(req, res, next) {
    const k = (req.header("X-Api-Key") || "").trim();
    if (!config.internalApiKey || k !== config.internalApiKey) {
      console.log("[AUTH] unauthorized", {
        ip: req.ip,
        path: req.path,
        hasKey: !!k,
      });
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  }

  // -----------------------
  // Connection lookup
  // -----------------------
  r.post("/meta/connection", requireApiKey, express.json(), async (req, res) => {
    const { org_id, lang } = req.body || {};
    if (!org_id || !["en", "es"].includes(lang)) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }

    const row = await getConnection(db, org_id, lang);
    if (!row) return res.status(404).json({ ok: false, error: "not_connected" });

    return res.json({ ok: true, data: row });
  });

  /**
   * Devuelve el long-lived USER token guardado en SQLite por "channel".
   * Ej: /api/meta/oauth/token?channel=luxverbien
   */
  r.get("/meta/oauth/token", requireApiKey, (req, res) => {
    const channel = String(req.query.channel || "").trim().toLowerCase();
    if (!channel) return res.status(400).json({ ok: false, error: "channel required" });

    console.log("[OAUTH] token get", { channel });

    db.get(
      "SELECT access_token, obtained_at, expires_in FROM meta_tokens WHERE channel = ?",
      [channel],
      (err, row) => {
        if (err) {
          console.log("[OAUTH] token get db_error", { channel, err: String(err) });
          return res.status(500).json({ ok: false, error: "db_error", details: String(err) });
        }
        if (!row) {
          console.log("[OAUTH] token get not_found", { channel });
          return res.status(404).json({ ok: false, error: "no_token_for_channel" });
        }
        console.log("[OAUTH] token get ok", { channel, obtained_at: row.obtained_at, expires_in: row.expires_in });
        return res.json({ ok: true, ...row });
      }
    );
  });

  // OAuth exchange/refresh desde el servidor (IP del VPS)
  r.post("/meta/oauth/exchange", requireApiKey, express.json(), async (req, res) => {
    const user_token = (req.body?.user_token || "").trim();
    if (!user_token) return res.status(400).json({ ok: false, error: "user_token required" });

    if (!config.meta.appId || !config.meta.appSecret) {
      return res.status(500).json({ ok: false, error: "META_APP_ID / META_APP_SECRET not set" });
    }

    console.log("[OAUTH] exchange start", { token_len: user_token.length });

    const url = new URL("https://graph.facebook.com/oauth/access_token");
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", config.meta.appId);
    url.searchParams.set("client_secret", config.meta.appSecret);
    url.searchParams.set("fb_exchange_token", user_token);

    try {
      const rr = await fetch(url.toString(), { method: "GET" });
      const text = await rr.text();
      console.log("[OAUTH] exchange response", { status: rr.status, ok: rr.ok, body_prefix: text.slice(0, 200) });

      if (!rr.ok) {
        return res.status(rr.status).type("application/json").send(text);
      }
      return res.status(200).type("application/json").send(text);
    } catch (e) {
      console.log("[OAUTH] exchange error", { err: String(e) });
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -----------------------
  // Publish enqueue (VPS job)
  // -----------------------
  r.post("/meta/publish", requireApiKey, express.json(), async (req, res) => {
    const channel = String(req.body?.channel || "").trim().toLowerCase(); // luxverbien
    const video_filename_raw = String(req.body?.video_filename || "").trim(); // en_Génesis_....mp4
    const caption = String(req.body?.caption || "").trim();
    const title = String(req.body?.title || "").trim() || null;
    const publish_at = Number(req.body?.publish_at || req.body?.publish_unix || 0);

    if (!channel || !video_filename_raw || !caption) {
      return res.status(400).json({ ok: false, error: "channel, video_filename, caption required" });
    }

    // (3) Validar que el channel está conectado (meta_connections.channel)
    const conn = await new Promise((resolve, reject) => {
      db.get(
        `SELECT page_id, page_token, ig_user_id
         FROM meta_connections
         WHERE lower(trim(channel)) = ?
         LIMIT 1`,
        [channel],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    if (!conn?.page_id || !conn?.page_token) {
      return res.status(400).json({ ok: false, error: "channel_not_connected", details: { channel } });
    }

    // (1) Nombre canónico único
    const video_filename = canonicalVideoFilename(video_filename_raw);

    const baseUrl = config.baseUrl || "https://meta.safeblocklab.com";
    const video_url = `${baseUrl.replace(/\/$/, "")}/videos/${encodeURIComponent(video_filename)}`;

    const now = Math.floor(Date.now() / 1000);
    const isScheduled = publish_at && publish_at > (now + 60);
    const effective_publish_at = isScheduled ? publish_at : now;

    // Precheck: verify file exists on server
    const localPath = path.join(VIDEOS_DIR, video_filename);
    const exists = await fileExists(localPath);

    if (!exists) {
      return res.status(400).json({
        ok: false,
        error: "video_file_missing_on_server",
        details: { video_filename, localPath },
      });
    }

    const job = await enqueuePublishJob(db, {
      channel,
      platform: "fb_ig",
      video_filename,
      video_url,
      title,
      caption,
      publish_at: effective_publish_at,
    });

    return res.json({
      ok: true,
      scheduled: !!isScheduled,
      job_id: job.id,
      video_filename,
      video_url,
      publish_at: effective_publish_at,
    });
  });

  return r;
}
