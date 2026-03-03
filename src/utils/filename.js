import crypto from "crypto";

/**
 * Creates a safe, canonical filename for videos uploaded to the server.
 * - strips path traversal
 * - normalizes whitespace
 * - preserves extension
 * - appends a short random suffix (to avoid collisions)
 */
export function canonicalVideoFilename(input) {
  const raw = String(input || "").trim();
  const base = raw.split(/[\\/]/).pop() || "video";

  const m = base.match(/^(.*?)(\.[a-z0-9]{2,5})?$/i);
  const name = (m?.[1] || "video")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "video";

  const ext = (m?.[2] || ".mp4").toLowerCase();
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${name}_${suffix}${ext}`;
}
