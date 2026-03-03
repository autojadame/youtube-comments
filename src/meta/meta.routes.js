// src/meta/meta.routes.js
import express from "express";
import { config } from "../config.js";
import {
  makeState,
  buildAuthUrl,
  exchangeCodeForShortToken,
  exchangeShortForLongToken,
  getMe,
} from "./meta.oauth.js";
import { graphGet } from "./meta.graph.js";
import {
  upsertConnection,
  upsertMetaToken,
  getConnectionsByOrgId,
} from "./meta.store.js";

function slugifyOrgId(name) {
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "org";
}

function normalizeChannel(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "")
    .slice(0, 40);
}

export function metaRoutes(db, { flash }) {
  const r = express.Router();

  // ---------------------------
  // CONNECT (recommended flow)
  // ---------------------------
  r.get("/connect", (req, res) => {
    if (!config.meta.appId || !config.meta.appSecret || !config.meta.redirectUri) {
      return res.status(500).send("Missing Meta config");
    }

    const state = makeState();
    req.session.metaState = state;

    // No org/lang here. Those are configured in select-assets.
    const url = buildAuthUrl({ state });
    return res.redirect(url);
  });

  // Back-compat: old links
  r.get("/connect/:orgId/:lang", (req, res) => {
    const { orgId, lang } = req.params;
    if (!orgId || !["en", "es"].includes(lang)) return res.status(400).send("Bad orgId/lang");
    if (!config.meta.appId || !config.meta.appSecret || !config.meta.redirectUri) {
      return res.status(500).send("Missing Meta config");
    }

    const state = makeState();
    req.session.metaState = state;

    // Defaults (optional)
    req.session.orgId = String(orgId || "").trim();
    req.session.lang = String(lang || "").trim();

    const url = buildAuthUrl({ state });
    return res.redirect(url);
  });

  // ---------------------------
  // OAUTH callback
  // ---------------------------
  r.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      flash(req, "error", `Meta OAuth error: ${error}`);
      return res.redirect("/");
    }
    if (!code || !state || state !== req.session.metaState) {
      flash(req, "error", "Invalid OAuth state/code.");
      return res.redirect("/");
    }

    try {
      const short = await exchangeCodeForShortToken(code);
      const shortToken = short.access_token;

      const longr = await exchangeShortForLongToken(shortToken);
      const longToken = longr.access_token;
      const expiresIn = longr.expires_in ?? null;

      const me = await getMe(longToken);

      req.session.longUserToken = longToken;
      req.session.longUserTokenExpiresIn = expiresIn;

      req.session.fbUserId = me.id;
      req.session.fbUserName = me.name;
      req.session.fbUserPic = me.picture?.data?.url || null;

      return res.redirect("/meta/select-assets");
    } catch (e) {
      return res.status(500).send(`OAuth exchange failed: ${e.message}`);
    }
  });

  // ---------------------------
  // SELECT-ASSETS (mapping UI)
  // Supports editing by org query: /meta/select-assets?org=<org_id>
  // ---------------------------
  r.get("/select-assets", async (req, res) => {
    const longUserToken = req.session?.longUserToken || null;
    if (!longUserToken) {
      flash(req, "error", "Not connected. Please connect to Facebook first.");
      return res.redirect("/");
    }

    // Which org are we editing?
    const orgFromQuery = String(req.query?.org || "").trim();
    const orgId = orgFromQuery || String(req.session?.orgId || "").trim() || null;

    // Load existing mappings if orgId is known (for proper EN/ES init on edit)
    let connByLang = { en: null, es: null };
    let orgName = String(req.session?.orgName || "").trim() || null;

    if (orgId) {
      try {
        const rows = await getConnectionsByOrgId(db, orgId);
        for (const row of rows) {
          if (row.lang === "en") connByLang.en = row;
          if (row.lang === "es") connByLang.es = row;
        }
        // prefer stored org_name if present
        orgName = rows.find(r => r.org_name)?.org_name || orgName;
      } catch (e) {
        console.log("[select-assets] getConnectionsByOrgId failed (non-fatal):", e?.message || String(e));
      }
    }

    // List pages from Meta
    try {
      const pagesResp = await graphGet("/me/accounts", {
        access_token: longUserToken,
        fields: "id,name,access_token",
        limit: 200,
      });

      // IMPORTANT: do not expose access_token to the template
      const list = (pagesResp?.data || []).map((p) => ({
        id: String(p.id),
        name: String(p.name || ""),
        // Optional info (filled below)
        ig_user_id: null,
        ig_username: null,
        // keep token only in memory for enrichment, then drop
        _page_token: p.access_token || null,
      }));

      // Optional enrichment: IG id/username per page (best-effort, non-blocking)
      // If you consider it too slow, remove this block.
      for (const item of list) {
        try {
          if (!item._page_token) continue;

          const pageInfo = await graphGet(`/${item.id}`, {
            access_token: item._page_token,
            fields: "instagram_business_account",
          });

          const igId = pageInfo?.instagram_business_account?.id
            ? String(pageInfo.instagram_business_account.id)
            : null;

          item.ig_user_id = igId;

          if (igId) {
            try {
              const igInfo = await graphGet(`/${igId}`, {
                access_token: longUserToken,
                fields: "username",
              });
              item.ig_username = igInfo?.username ? String(igInfo.username) : null;
            } catch {
              item.ig_username = null;
            }
          }
        } catch {
          // ignore
        }
      }

      // Build initial values for template (THIS FIXES: EN always disabled on edit)
      const enEnabledInit = !!connByLang.en;
      const esEnabledInit = !!connByLang.es;

      const enPageIdInit = connByLang.en?.page_id ? String(connByLang.en.page_id) : "";
      const esPageIdInit = connByLang.es?.page_id ? String(connByLang.es.page_id) : "";

      const enChannelInit = connByLang.en?.channel ? String(connByLang.en.channel) : "";
      const esChannelInit = connByLang.es?.channel ? String(connByLang.es.channel) : "";

      // Remove tokens before rendering
      const pages = list.map(({ _page_token, ...rest }) => rest);

      // Keep orgId in session when editing
      if (orgId) req.session.orgId = orgId;

      return res.render("meta/select-assets", {
        is_connected: true,

        // IMPORTANT: always pass these to avoid EJS ReferenceError
        orgId,
        orgName,
        lang: req.session?.lang || null, // just a default hint if you want it

        pages,

        // init values used by your JS/template
        enEnabledInit,
        esEnabledInit,
        enPageIdInit,
        esPageIdInit,
        enChannelInit,
        esChannelInit,
      });
    } catch (e) {
      return res.status(500).send(`Failed listing pages: ${e.message}`);
    }
  });

  // ---------------------------
  // CONFIRM (save EN and/or ES)
  // ---------------------------
  r.post("/confirm", express.urlencoded({ extended: false }), async (req, res) => {
    const longUserToken = req.session?.longUserToken || null;
    const longUserTokenExpiresIn = req.session?.longUserTokenExpiresIn ?? null;
    const fbUserId = req.session?.fbUserId || null;

    if (!longUserToken) {
      flash(req, "error", "Missing session. Start with /meta/connect");
      return res.redirect("/");
    }

    const orgName = String(req.body?.org_name || "").trim();
    if (!orgName) {
      flash(req, "error", "Organization name is required.");
      return res.redirect("/meta/select-assets");
    }

    // orgId: from session (editing), or derived from orgName
    let orgId = String(req.session?.orgId || "").trim();
    if (!orgId) orgId = slugifyOrgId(orgName);

    req.session.orgId = orgId;
    req.session.orgName = orgName;

    // Enabled flags (checkbox: present when checked)
    const enEnabled = !!req.body?.en_enabled;
    const esEnabled = !!req.body?.es_enabled;

    const enPageId = String(req.body?.en_page_id || "").trim();
    const esPageId = String(req.body?.es_page_id || "").trim();

    const enChannel = normalizeChannel(req.body?.en_channel);
    const esChannel = normalizeChannel(req.body?.es_channel);

    // Validate: at least one
    if (!enEnabled && !esEnabled) {
      flash(req, "error", "Enable at least one language (EN or ES).");
      return res.redirect("/meta/select-assets");
    }

    // Validate per language
    if (enEnabled) {
      if (!enPageId) {
        flash(req, "error", "English enabled: please select a Facebook Page.");
        return res.redirect("/meta/select-assets");
      }
      if (!enChannel) {
        flash(req, "error", "English enabled: please set a channel key.");
        return res.redirect("/meta/select-assets");
      }
    }
    if (esEnabled) {
      if (!esPageId) {
        flash(req, "error", "Spanish enabled: please select a Facebook Page.");
        return res.redirect("/meta/select-assets");
      }
      if (!esChannel) {
        flash(req, "error", "Spanish enabled: please set a channel key.");
        return res.redirect("/meta/select-assets");
      }
    }

    try {
      // Fetch pages again to get the real page access_token
      const pagesResp = await graphGet("/me/accounts", {
        access_token: longUserToken,
        fields: "id,name,access_token",
        limit: 200,
      });
      const arr = pagesResp?.data || [];

      async function saveOne({ lang, pageId, channel }) {
        const page = arr.find((p) => String(p.id) === String(pageId));
        if (!page || !page.access_token) {
          throw new Error(`Page token not found for page_id=${pageId}. Reconnect and accept permissions.`);
        }

        const pageToken = page.access_token;

        // Detect IG business account linked
        const pageInfo = await graphGet(`/${pageId}`, {
          access_token: pageToken,
          fields: "instagram_business_account",
        });

        const igUserId = pageInfo?.instagram_business_account?.id
          ? String(pageInfo.instagram_business_account.id)
          : null;

        // Best-effort username
        let igUsername = null;
        if (igUserId) {
          try {
            const igInfo = await graphGet(`/${igUserId}`, {
              access_token: longUserToken,
              fields: "username",
            });
            igUsername = igInfo?.username ? String(igInfo.username) : null;
          } catch (e) {
            console.log("[IG] username fetch failed (non-fatal):", e?.message || String(e));
          }
        }

        await upsertConnection(db, {
          orgId,
          orgName, // <- new
          lang,
          channel,
          fbUserId: String(fbUserId || ""),
          longUserToken,
          pageId: String(pageId),
          pageToken,
          igUserId,
          igUsername, // <- new (if column exists)
        });

        await upsertMetaToken(db, {
          channel,
          accessToken: longUserToken,
          expiresIn: longUserTokenExpiresIn,
        });

        return {
          lang,
          channel,
          pageName: page.name,
          pageId: String(pageId),
          igUserId: igUserId || null,
          igUsername: igUsername || null,
        };
      }

      const saved = [];
      if (enEnabled) saved.push(await saveOne({ lang: "en", pageId: enPageId, channel: enChannel }));
      if (esEnabled) saved.push(await saveOne({ lang: "es", pageId: esPageId, channel: esChannel }));

      // Store preferred default lang for UX only
      if (enEnabled && !esEnabled) req.session.lang = "en";
      else if (esEnabled && !enEnabled) req.session.lang = "es";
      else req.session.lang = null;

      const summary = saved
        .map((x) => `${x.lang.toUpperCase()}: channel="${x.channel}" page="${x.pageName}" IG=${x.igUsername ? "@" + x.igUsername : (x.igUserId || "—")}`)
        .join(" · ");

      flash(req, "success", `Saved mappings for org="${orgName}" (org_id=${orgId}). ${summary}`);
      return res.redirect("/");
    } catch (e) {
      return res.status(500).send(`Confirm failed: ${e.message}`);
    }
  });

  return r;
}
