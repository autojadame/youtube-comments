import express from "express";
import session from "express-session";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config.js";
import { openDb } from "./db.js";
import { flash, flashMiddleware } from "./utils/flash.js";

import { youtubeRoutes } from "./youtube/youtube.routes.js";
import { listYtConnections } from "./youtube/youtube.store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const db = openDb(process.env.DB_FILE || null);

// Security headers (keep permissive enough for OAuth redirects)
app.use(helmet({ contentSecurityPolicy: false }));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
  },
}));

app.use(flashMiddleware);

app.use((req, res, next) => {
  res.locals.appName = config.appName;
  next();
});

// Views
app.set("view engine", "ejs");
app.set("views", path.resolve(process.cwd(), "views"));

// Static
app.use("/public", express.static(path.resolve(process.cwd(), "public")));

// Routers
app.use("/youtube", youtubeRoutes(db, { flash }));

// Home
app.get("/", async (req, res) => {
  const ytConnected = !!req.session?.ytConnected;

  let connByLang = { en: null, es: null };
  let orgName = req.session?.orgName || null;
  let orgId = req.session?.orgId || null;


  // For YouTube: also show last saved connection if session not set
  let yt = null;
  if (ytConnected) {
    yt = {
      connected: true,
      channel_key: req.session?.ytChannelKey || null,
      channel_id: req.session?.ytSelectedChannelId || null,
      channel_title: null,
    };
  } else {
    const list = await listYtConnections(db);
    if (list?.length) {
      yt = {
        connected: false,
        last_saved: list[0],
      };
    }
  }

  res.render("landing", {
    appName: config.appName,
    title: null,
    yt: ytConnected ? {
      connected: true,
      channel_key: req.session?.ytChannelKey || "—",
      channel_id: req.session?.ytSelectedChannelId || "—",
      channel_title: (req.session?.ytChannels || []).find(c => c.id === req.session?.ytSelectedChannelId)?.title || null,
    } : { connected: false },

  });
});



// Static informational pages
app.get("/privacy", (req, res) => res.render("privacy", { appName: config.appName, title: "Privacy" }));
app.get("/tos", (req, res) => res.render("tos", { appName: config.appName, title: "Terms" }));
app.get("/contact", (req, res) => res.render("contact", { appName: config.appName, title: "Contact" }));
app.get("/data-deletion", (req, res) => res.render("data-deletion", { appName: config.appName, title: "Data deletion" }));

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`[app] listening on :${config.port}`);
});
