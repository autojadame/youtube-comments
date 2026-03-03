import axios from "axios";
import { config } from "../config.js";

export async function deepseekChat({ messages, maxTokens, temperature, model }) {
  if (!config.deepseek.apiKey) throw new Error("DEEPSEEK_API_KEY is not set");

  const url = `${config.deepseek.baseUrl}/chat/completions`;
  const body = {
    model: model || config.deepseek.model,
    messages,
    max_tokens: Number(maxTokens ?? config.deepseek.maxTokens),
    temperature: Number(temperature ?? config.deepseek.temperature),
    stream: false,
  };

  const res = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${config.deepseek.apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 60_000,
  });

  const content = res.data?.choices?.[0]?.message?.content;
  return (content || "").trim();
}

export async function generateCommentReply({ platform, channelTitle, videoTitle, authorName, commentText, langHint = "auto" }) {
  const sys = {
    role: "system",
    content:
      "You are a helpful assistant for a YouTube/Meta creator. " +
      "Write a short, friendly reply to a viewer comment. " +
      "Rules: (1) 1-2 sentences, (2) no hashtags, (3) no asking for likes/subscriptions, " +
      "(4) don't mention that you are AI or a bot, (5) if the comment is hateful, reply calmly or choose not to engage." ,
  };

  const context = [
    `Platform: ${platform}`,
    channelTitle ? `Channel: ${channelTitle}` : null,
    videoTitle ? `Video: ${videoTitle}` : null,
    authorName ? `Comment author: ${authorName}` : null,
    `Comment: ${commentText}`,
    "Reply in the same language as the comment (Spanish if unclear).",
  ].filter(Boolean).join("\n");

  const user = { role: "user", content: context };

  const reply = await deepseekChat({ messages: [sys, user] });
  return reply;
}
