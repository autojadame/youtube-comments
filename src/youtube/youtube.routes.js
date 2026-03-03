import express from "express";
import { config } from "../config.js";
import { makeState, buildAuthUrl, exchangeCodeForTokens, listMyChannels } from "./youtube.oauth.js";
import { upsertYtConnection, listYtConnections } from "./youtube.store.js";

function slugifyOrgId(name) {
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || null;
}

function normalizeChannelKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_\-]+/g, "")
    .slice(0, 60);
}

export function youtubeRoutes(db, { flash }) {
  const r = express.Router();

  r.get("/connect", async (req, res) => {
    if (!config.youtube.clientId || !config.youtube.clientSecret || !config.youtube.redirectUri) {
      return res.status(500).send("Missing YouTube OAuth config");
    }
    const state = makeState();
    req.session.ytState = state;
    const url = buildAuthUrl({ state });
    return res.redirect(url);
  });

  r.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      flash(req, "error", `YouTube OAuth error: ${error}`);
      return res.redirect("/");
    }
    if (!code || !state || state !== req.session.ytState) {
      flash(req, "error", "Invalid OAuth state/code.");
      return res.redirect("/");
    }

    try {
      const tok = await exchangeCodeForTokens(String(code));
      const accessToken = tok.access_token;
      const refreshToken = tok.refresh_token;
      const expiresIn = tok.expires_in ?? null;

      if (!accessToken) throw new Error("No access_token returned");
      if (!refreshToken) {
        // This can happen if the user already granted offline access earlier.
        // We force prompt=consent, but some environments still won't return.
        throw new Error(
          "No refresh_token returned. Revoke app access in Google Account and reconnect, or ensure prompt=consent + access_type=offline."
        );
      }

      const channels = await listMyChannels(accessToken);

      req.session.ytAccessToken = accessToken;
      req.session.ytRefreshToken = refreshToken;
      req.session.ytExpiresIn = expiresIn;
      req.session.ytObtainedAt = Math.floor(Date.now() / 1000);
      req.session.ytChannels = channels;

      // If single channel, preselect.
      if (channels.length === 1) {
        req.session.ytSelectedChannelId = channels[0].id;
      }

      return res.redirect("/youtube/select-channel");

    } catch (e) {
      flash(req, "error", `OAuth exchange failed: ${e.message}`);
      return res.redirect("/");
    }
  });

  r.get("/select-channel", async (req, res) => {
    const channels = req.session?.ytChannels || null;
    if (!channels) {
      // Allow view of stored connections even if not in OAuth session
      const list = await listYtConnections(db);
      return res.status(200).send(
        `<pre>Not in OAuth session. Stored YouTube connections:\n${JSON.stringify(list, null, 2)}\n\nStart OAuth at /youtube/connect</pre>`
      );
    }

    return res.render("youtube/select-channel", {
      appName: config.appName,
      channels,
      selectedChannelId: req.session?.ytSelectedChannelId || null,
      orgName: req.session?.ytOrgName || null,
      channelKey: req.session?.ytChannelKey || null,
      autoReply: req.session?.ytAutoReply !== undefined ? !!req.session.ytAutoReply : true,
    });
  });

  r.post("/confirm", express.urlencoded({ extended: false }), async (req, res) => {
    const accessToken = req.session?.ytAccessToken || null;
    const refreshToken = req.session?.ytRefreshToken || null;
    const obtainedAt = req.session?.ytObtainedAt ?? null;
    const expiresIn = req.session?.ytExpiresIn ?? null;
    const channels = req.session?.ytChannels || null;

    if (!accessToken || !refreshToken || !channels) {
      flash(req, "error", "Missing session. Start with /youtube/connect");
      return res.redirect("/");
    }

    const orgName = String(req.body?.org_name || "").trim() || null;
    const orgId = orgName ? slugifyOrgId(orgName) : null;

    const channelKey = normalizeChannelKey(req.body?.channel_key);
    const ytChannelId = String(req.body?.yt_channel_id || "").trim();
    const autoReply = !!req.body?.auto_reply;

    if (!channelKey) {
      flash(req, "error", "Channel key is required.");
      return res.redirect("/youtube/select-channel");
    }
    if (!ytChannelId) {
      flash(req, "error", "You must select a YouTube channel.");
      return res.redirect("/youtube/select-channel");
    }

    const ch = channels.find((c) => String(c.id) === ytChannelId);
    const ytChannelTitle = ch?.title || ytChannelId;

    try {
      await upsertYtConnection(db, {
        ytChannelId,
        ytChannelTitle,
        channelKey,
        orgName,
        orgId,
        refreshToken,
        accessToken,
        obtainedAt,
        expiresIn,
        enabled: 1,
        autoReply: autoReply ? 1 : 0,
        autoHeart: 0,
      });

      req.session.ytConnected = true;
      req.session.ytSelectedChannelId = ytChannelId;
      req.session.ytChannelKey = channelKey;
      req.session.ytOrgName = orgName;

      flash(req, "success", `YouTube connected: ${ytChannelTitle} (key=${channelKey})`);
      return res.redirect("/");

    } catch (e) {
      flash(req, "error", `Save failed: ${e.message}`);
      return res.redirect("/youtube/select-channel");
    }
  });

  r.post("/logout", (req, res) => {
    // Remove only YouTube session fields
    if (req.session) {
      delete req.session.ytState;
      delete req.session.ytAccessToken;
      delete req.session.ytRefreshToken;
      delete req.session.ytExpiresIn;
      delete req.session.ytObtainedAt;
      delete req.session.ytChannels;
      delete req.session.ytSelectedChannelId;
      delete req.session.ytConnected;
      delete req.session.ytChannelKey;
      delete req.session.ytOrgName;
    }
    flash(req, "success", "YouTube disconnected (session cleared). Stored DB connection remains for the worker.");
    return res.redirect("/");
  });

  return r;
}
