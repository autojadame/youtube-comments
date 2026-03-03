import cron from "node-cron";
import { openDb } from "./db.js";
import { config } from "./config.js";
import { runYouTubeCommentBot } from "./youtube/youtube.worker.js";
import { runMetaCommentBot } from "./meta/meta.comments.worker.js";

const db = openDb(process.env.DB_FILE || null);

const locks = { yt: false, meta: false };

async function safeRun(label, key, fn) {
  if (locks[key]) {
    console.log(`[worker] ${label} skipped (already running)`);
    return;
  }
  locks[key] = true;
  try {
    await fn();
  } catch (e) {
    console.log(`[worker] ${label} error`, e?.message || String(e));
  } finally {
    locks[key] = false;
  }
}

console.log(`[worker] starting. ytCron="${config.worker.youtubeCron}" metaCron="${config.worker.metaCron}"`);

// Run once at startup
safeRun("youtube", "yt", () => runYouTubeCommentBot(db));
safeRun("meta", "meta", () => runMetaCommentBot(db));

cron.schedule(config.worker.youtubeCron, () => {
  safeRun("youtube", "yt", () => runYouTubeCommentBot(db));
});

cron.schedule(config.worker.metaCron, () => {
  safeRun("meta", "meta", () => runMetaCommentBot(db));
});
