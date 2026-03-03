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
    // safety / anti-spam
    maxRepliesPerRun: Number(process.env.MAX_REPLIES_PER_RUN || 30),
    replyCooldownSeconds: Number(process.env.REPLY_COOLDOWN_SECONDS || 2),
  }
};
