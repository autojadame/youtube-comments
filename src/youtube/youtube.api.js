import axios from "axios";

const BASE = "https://www.googleapis.com/youtube/v3";

export async function ytGet(path, accessToken, params = {}) {
  const url = `${BASE}${path}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
  });
  return res.data;
}

export async function ytPost(path, accessToken, params = {}, body = {}) {
  const url = `${BASE}${path}`;
  const res = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
  });
  return res.data;
}

export async function listCommentThreadsForChannel(accessToken, {
  channelId,
  pageToken = null,
  maxResults = 50,
  order = "time",
}) {
  const params = {
    part: "snippet,replies",
    allThreadsRelatedToChannelId: channelId,
    maxResults,
    order,
    textFormat: "plainText",
  };
  if (pageToken) params.pageToken = pageToken;

  return ytGet("/commentThreads", accessToken, params);
}

export async function replyToComment(accessToken, { parentId, message }) {
  // comments.insert creates a reply to an existing comment
  // part must be snippet
  const params = { part: "snippet" };
  const body = {
    snippet: {
      parentId,
      textOriginal: message,
    },
  };
  return ytPost("/comments", accessToken, params, body);
}

export async function getVideoTitle(accessToken, videoId) {
  const data = await ytGet("/videos", accessToken, {
    part: "snippet",
    id: videoId,
    maxResults: 1,
  });
  const it = data?.items?.[0];
  return it?.snippet?.title ? String(it.snippet.title) : null;
}
