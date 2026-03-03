require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");

const { getDb } = require("./db/db");
const { logger } = require("./logger");
const { parseClientSecretJson, buildOAuthClient } = require("./youtube/oauth");
const { youtubeClient, fetchMyChannel } = require("./youtube/api");
const { randomKey } = require("./utils/crypto");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REQUIRED_REDIRECT = `${BASE_URL.replace(/\/$/, "")}/oauth2/callback`;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" },
}));

function flash(req, type, message) {
  req.session.flash = { type, message };
}
function consumeFlash(req) {
  const f = req.session.flash;
  req.session.flash = null;
  return f;
}
function render(req, res, view, locals = {}) {
  const flashMsg = consumeFlash(req);
  res.render(view, { ...locals, flash: flashMsg }, (err, html) => {
    if (err) {
      logger.error(err, "render error");
      return res.status(500).send("Render error");
    }
    res.render("_layout", { title: locals.title, body: html, flash: flashMsg });
  });
}

async function getLatestOAuthClient(db) {
  return db.get("SELECT * FROM oauth_clients ORDER BY id DESC LIMIT 1");
}

app.get("/", async (req, res) => {
  const db = await getDb();
  const connections = await db.all("SELECT * FROM youtube_connections ORDER BY id DESC LIMIT 20");
  render(req, res, "index", { title: "Inicio", connections });
});

app.get("/privacy", (req, res) => render(req, res, "privacy", { title: "Privacy" }));
app.get("/tos", (req, res) => render(req, res, "tos", { title: "ToS" }));

// Step 1: upload client secret JSON
app.get("/setup", async (req, res) => {
  const db = await getDb();
  const oauthClient = await getLatestOAuthClient(db);
  let redirectOk = false;
  if (oauthClient) {
    try {
      const redirects = JSON.parse(oauthClient.redirect_uris_json);
      redirectOk = redirects.includes(REQUIRED_REDIRECT);
    } catch {}
  }
  render(req, res, "setup", { title: "Setup OAuth", oauthClient, requiredRedirect: REQUIRED_REDIRECT, redirectOk });
});

app.post("/setup", upload.single("client_secret"), async (req, res) => {
  try {
    const db = await getDb();
    if (!req.file) throw new Error("Missing file upload");
    const jsonText = req.file.buffer.toString("utf-8");
    const jsonObj = JSON.parse(jsonText);
    const { client_id, client_secret, redirect_uris } = parseClientSecretJson(jsonObj);
    const name = (req.body.name || "").trim() || null;

    await db.run(
      "INSERT INTO oauth_clients (name, client_id, client_secret, redirect_uris_json) VALUES (?,?,?,?)",
      [name, client_id, client_secret, JSON.stringify(redirect_uris)]
    );

    flash(req, "ok", "OAuth guardado. Ahora conecta el canal.");
    res.redirect("/setup");
  } catch (e) {
    logger.error(e, "setup failed");
    flash(req, "error", `Error en setup: ${e.message}`);
    res.redirect("/setup");
  }
});

// Step 2: connect channel
app.get("/connect", async (req, res) => {
  const db = await getDb();
  const oauthClient = await getLatestOAuthClient(db);
  let redirectOk = false;
  if (oauthClient) {
    try {
      const redirects = JSON.parse(oauthClient.redirect_uris_json);
      redirectOk = redirects.includes(REQUIRED_REDIRECT);
    } catch {}
  }
  render(req, res, "connect", { title: "Conectar canal", oauthClient, requiredRedirect: REQUIRED_REDIRECT, redirectOk });
});

app.get("/oauth2/authorize", async (req, res) => {
  const db = await getDb();
  const clientId = Number(req.query.client_id || 0);
  const oauthClientRow = await db.get("SELECT * FROM oauth_clients WHERE id = ?", [clientId]);
  if (!oauthClientRow) {
    flash(req, "error", "OAuth client not found. Upload JSON in /setup first.");
    return res.redirect("/connect");
  }

  const redirects = JSON.parse(oauthClientRow.redirect_uris_json);
  if (!redirects.includes(REQUIRED_REDIRECT)) {
    flash(req, "error", "Redirect URI no autorizado en tu OAuth. Ve a /setup.");
    return res.redirect("/connect");
  }

  req.session.oauth_client_id = oauthClientRow.id;

  const oAuth2Client = buildOAuthClient({
    client_id: oauthClientRow.client_id,
    client_secret: oauthClientRow.client_secret,
    redirect_uri: REQUIRED_REDIRECT,
  });

  const scopes = [
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ];

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    include_granted_scopes: true,
  });

  return res.redirect(url);
});

app.get("/oauth2/callback", async (req, res) => {
  try {
    const db = await getDb();
    const code = req.query.code;
    if (!code) throw new Error("Missing code in callback");

    const oauthClientId = req.session.oauth_client_id;
    const oauthClientRow = await db.get("SELECT * FROM oauth_clients WHERE id = ?", [oauthClientId]);
    if (!oauthClientRow) throw new Error("OAuth client not found in session. Go to /connect.");

    const oAuth2Client = buildOAuthClient({
      client_id: oauthClientRow.client_id,
      client_secret: oauthClientRow.client_secret,
      redirect_uri: REQUIRED_REDIRECT,
    });

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const yt = youtubeClient(oAuth2Client);
    const { channelId, title } = await fetchMyChannel(yt);

    // Store connection
    const connectionKey = randomKey(18);
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;

    await db.run(
      `INSERT INTO youtube_connections
       (oauth_client_id, connection_key, channel_id, channel_title, access_token, refresh_token, token_expiry, scope)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        oauthClientRow.id,
        connectionKey,
        channelId,
        title,
        tokens.access_token || null,
        tokens.refresh_token || null,
        tokenExpiry,
        (tokens.scope || null),
      ]
    );

    const manageUrl = `${BASE_URL.replace(/\/$/, "")}/manage/${connectionKey}`;

    render(req, res, "connected", {
      title: "Conectado",
      channelId,
      channelTitle: title,
      manageUrl,
    });
  } catch (e) {
    logger.error(e, "oauth callback failed");
    flash(req, "error", `OAuth callback error: ${e.message}`);
    res.redirect("/connect");
  }
});

// Manage
app.get("/manage/:key", async (req, res) => {
  const db = await getDb();
  const key = req.params.key;
  const conn = await db.get("SELECT * FROM youtube_connections WHERE connection_key = ?", [key]);
  if (!conn) return res.status(404).send("Not found");

  const settings = {
    reply_language: process.env.REPLY_LANGUAGE || "es",
    system_prompt: defaultSystemPrompt(process.env.REPLY_LANGUAGE || "es"),
  };
  const sessKey = `settings_${conn.id}`;
  if (req.session[sessKey]) Object.assign(settings, req.session[sessKey]);

  const recent = await db.all(
    "SELECT comment_id, reply_text, replied_at FROM youtube_replied_comments WHERE connection_id = ? ORDER BY id DESC LIMIT 10",
    [conn.id]
  );

  render(req, res, "manage", { title: "Gestionar", conn, settings, recent });
});

app.post("/manage/:key/toggle", async (req, res) => {
  const db = await getDb();
  const key = req.params.key;
  const conn = await db.get("SELECT * FROM youtube_connections WHERE connection_key = ?", [key]);
  if (!conn) return res.status(404).send("Not found");

  const next = conn.enabled ? 0 : 1;
  await db.run(
    "UPDATE youtube_connections SET enabled = ?, updated_at = datetime('now') WHERE id = ?",
    [next, conn.id]
  );
  flash(req, "ok", next ? "Bot activado" : "Bot desactivado");
  res.redirect(`/manage/${key}`);
});

app.post("/manage/:key/settings", async (req, res) => {
  const db = await getDb();
  const key = req.params.key;
  const conn = await db.get("SELECT * FROM youtube_connections WHERE connection_key = ?", [key]);
  if (!conn) return res.status(404).send("Not found");

  const reply_language = (req.body.reply_language || "es").toLowerCase() === "en" ? "en" : "es";
  const system_prompt = (req.body.system_prompt || "").trim() || defaultSystemPrompt(reply_language);

  const sessKey = `settings_${conn.id}`;
  req.session[sessKey] = { reply_language, system_prompt };
  flash(req, "ok", "Ajustes guardados (session).");
  res.redirect(`/manage/${key}`);
});

function defaultSystemPrompt(lang) {
  if (lang === "en") {
    return [
      "You are the creator of this YouTube channel replying to viewers.",
      "Write warm, human, concise replies (1-2 sentences).",
      "Avoid emojis spam; at most 1 emoji.",
      "Never ask for personal data. No links. No marketing.",
      "If the comment is hateful, reply calmly or ignore.",
    ].join("\n");
  }
  return [
    "Eres el creador de este canal de YouTube respondiendo a los espectadores.",
    "Responde de forma cálida, humana y breve (1-2 frases).",
    "Evita exceso de emojis; como mucho 1 emoji.",
    "No pidas datos personales. No enlaces. No vendas nada.",
    "Si el comentario es odio/troll, responde con calma o no respondas.",
  ].join("\n");
}

app.listen(PORT, () => {
  logger.info({ PORT, BASE_URL }, "Server listening");
});
