const { logger } = require("../logger");

/**
 * DeepSeek Chat Completions
 * POST https://api.deepseek.com/chat/completions
 * Docs: https://api-docs.deepseek.com/api/create-chat-completion
 */
async function deepseekChat({ system, user, model }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY in .env");

  const body = {
    model: model || process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ],
    temperature: 0.7,
    max_tokens: 300,
  };

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    logger.error({ status: res.status, txt }, "DeepSeek API error");
    throw new Error(`DeepSeek API error: ${res.status} ${txt}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  return content.trim();
}

module.exports = { deepseekChat };
