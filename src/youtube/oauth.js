const { google } = require("googleapis");

function parseClientSecretJson(jsonObj) {
  // Google provides either { web: {...} } or { installed: {...} }
  const cfg = jsonObj.web || jsonObj.installed;
  if (!cfg) throw new Error("Invalid client secret JSON (expected .web or .installed)");

  const client_id = cfg.client_id;
  const client_secret = cfg.client_secret;
  const redirect_uris = cfg.redirect_uris || [];

  if (!client_id || !client_secret) throw new Error("client_id/client_secret missing in JSON");
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    throw new Error("redirect_uris missing/empty in JSON");
  }

  return { client_id, client_secret, redirect_uris };
}

function buildOAuthClient({ client_id, client_secret, redirect_uri }) {
  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
}

module.exports = { parseClientSecretJson, buildOAuthClient };
