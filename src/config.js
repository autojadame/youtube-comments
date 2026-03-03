import dotenv from "dotenv";

dotenv.config();

function required(name, fallback = null) {
  const v = process.env[name] ?? fallback;
  return (v === undefined || v === null || String(v).trim() === "") ? null : String(v).trim();
}

export const config = {
  appName: process.env.APP_NAME || "SafeBlockLab Social Bot",
  baseUrl: required("BASE_URL"),
  port: Number(process.env.PORT || 3000),
  sessionSecret: required("SESSION_SECRET") || "dev-secret-change-me",
  internalApiKey: required("INTERNAL_API_KEY") || null,

  // DeepSeek
  deepseek: {
    apiKey: required("DEEPSEEK_API_KEY"),
    baseUrl: (required("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, ""),
    model: required("DEEPSEEK_MODEL") || "deepseek-chat",
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 300),
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.7),
  },

  // Meta (Facebook / Instagram) — kept compatible with your existing project
  meta: {
    graphVersion: required("META_GRAPH_VERSION") || "v25.0",
    appId: required("META_APP_ID"),
    appSecret: required("META_APP_SECRET"),
    redirectUri: required("META_REDIRECT_URI"),
    loginConfigId: required("META_LOGIN_CONFIG_ID"),
    scopes: (required("META_SCOPES")
      ? required("META_SCOPES").split(",").map(s => s.trim()).filter(Boolean)
      : [
          // publishing
          "pages_manage_posts",
          "pages_read_engagement",
          "pages_manage_metadata",
          // comments
          "pages_manage_engagement",
          "instagram_manage_comments"
        ]),
  },

  // YouTube
  youtube: {
    clientId: required("YOUTUBE_CLIENT_ID"),
    clientSecret: required("YOUTUBE_CLIENT_SECRET"),
    redirectUri: required("YOUTUBE_REDIRECT_URI"),
    // Minimal scope for replying to comments (also grants broader manage perms)
    scopes: (required("YOUTUBE_SCOPES")
      ? required("YOUTUBE_SCOPES").split(",").map(s => s.trim()).filter(Boolean)
      : ["https://www.googleapis.com/auth/youtube.force-ssl"]),
  },

  // Worker tuning
  worker: {
    // how often to poll (cron format)
    youtubeCron: process.env.YT_CRON || "*/2 * * * *", // every 2 minutes
    metaCron: process.env.META_CRON || "*/5 * * * *", // every 5 minutes
    // safety / anti-spam
    maxRepliesPerRun: Number(process.env.MAX_REPLIES_PER_RUN || 30),
    replyCooldownSeconds: Number(process.env.REPLY_COOLDOWN_SECONDS || 2),
  }
};
