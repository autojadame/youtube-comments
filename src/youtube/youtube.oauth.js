import crypto from "crypto";
import axios from "axios";
import { config } from "../config.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function makeState() {
  return crypto.randomBytes(24).toString("hex");
}

export function buildAuthUrl({ state }) {
  if (!config.youtube.clientId || !config.youtube.redirectUri) {
    throw new Error("Missing YOUTUBE_CLIENT_ID / YOUTUBE_REDIRECT_URI");
  }

  const params = new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: config.youtube.redirectUri,
    response_type: "code",
    scope: config.youtube.scopes.join(" "),
    state,
    access_type: "offline",
    include_granted_scopes: "true",
    // Ensures refresh_token is returned on initial connect (and when user already consented)
    prompt: "consent",
  });

  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  if (!config.youtube.clientId || !config.youtube.clientSecret || !config.youtube.redirectUri) {
    throw new Error("Missing YouTube OAuth config");
  }

  const body = new URLSearchParams({
    code,
    client_id: config.youtube.clientId,
    client_secret: config.youtube.clientSecret,
    redirect_uri: config.youtube.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data;
}

export async function refreshAccessToken(refreshToken) {
  if (!config.youtube.clientId || !config.youtube.clientSecret) {
    throw new Error("Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    client_id: config.youtube.clientId,
    client_secret: config.youtube.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data;
}

export async function listMyChannels(accessToken) {
  const url = "https://www.googleapis.com/youtube/v3/channels";
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      part: "id,snippet",
      mine: "true",
      maxResults: 50,
    },
  });

  const items = res.data?.items || [];
  return items.map((it) => ({
    id: String(it.id),
    title: String(it.snippet?.title || it.id),
    thumbnail: it.snippet?.thumbnails?.default?.url || null,
  }));
}
