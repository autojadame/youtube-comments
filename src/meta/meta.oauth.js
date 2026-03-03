import crypto from "crypto";
import { config } from "../config.js";
import { graphGet } from "./meta.graph.js";

export function buildAuthUrl({ state }) {
  const params = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: config.meta.redirectUri,
    state,
    response_type: "code",
    scope: config.meta.scopes.join(","),
  });

  if (config.meta.loginConfigId) {
    params.set("config_id", config.meta.loginConfigId);
  }

  return `https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForShortToken(code) {
  return graphGet("/oauth/access_token", {
    client_id: config.meta.appId,
    redirect_uri: config.meta.redirectUri,
    client_secret: config.meta.appSecret,
    code,
  });
}

export async function exchangeShortForLongToken(shortToken) {
  // short -> long
  return graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: shortToken,
  });
}

export async function getMe(userToken) {
  return graphGet("/me", { fields: "id,name,picture.width(96).height(96)",access_token: userToken });
}

export function makeState() {
  return crypto.randomBytes(24).toString("hex");
}
