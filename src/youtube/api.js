const { google } = require("googleapis");

function youtubeClient(auth) {
  return google.youtube({ version: "v3", auth });
}

async function fetchMyChannel(youtube) {
  const res = await youtube.channels.list({ part: ["id", "snippet"], mine: true });
  const item = res?.data?.items?.[0];
  if (!item?.id) throw new Error("Could not fetch channel (channels.list mine=true returned empty).");
  return { channelId: item.id, title: item.snippet?.title || "" };
}

async function listLatestThreadsForChannel(youtube, channelId, maxResults) {
  const res = await youtube.commentThreads.list({
    part: ["snippet", "replies"],
    allThreadsRelatedToChannelId: channelId,
    order: "time",
    maxResults: maxResults || 50,
    textFormat: "plainText",
  });
  return res?.data?.items || [];
}

async function replyToComment(youtube, parentCommentId, text) {
  const res = await youtube.comments.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        parentId: parentCommentId,
        textOriginal: text,
      },
    },
  });
  return res?.data;
}

module.exports = {
  youtubeClient,
  fetchMyChannel,
  listLatestThreadsForChannel,
  replyToComment,
};
