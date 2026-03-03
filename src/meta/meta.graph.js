// src/meta/meta.graph.js
import axios from "axios";
import { config } from "../config.js";

function baseUrl() {
  return `https://graph.facebook.com/${config.meta.graphVersion}`;
}

export async function graphGet(path, params) {
  const url = `${baseUrl()}${path}`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * POST JSON a Graph API (application/json).
 * Uso típico: endpoints que aceptan JSON directo.
 */
export async function graphPost(path, body, params = undefined) {
  const url = `${baseUrl()}${path}`;
  const res = await axios.post(url, body, { params });
  return res.data;
}
