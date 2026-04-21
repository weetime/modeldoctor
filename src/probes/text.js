const { buildChatBody } = require("../builders/chat");

/**
 * Text-only probe: sends a deterministic prompt and asserts the reply contains a marker.
 * @param {{ apiUrl:string, apiKey:string, model:string, extraHeaders?:object }} ctx
 */
async function runTextProbe({ apiUrl, apiKey, model, extraHeaders = {} }) {
  const body = buildChatBody({
    model,
    prompt: "Reply with exactly: OK-TEXT-123",
    maxTokens: 32,
    temperature: 0,
    stream: false,
  });
  const t0 = Date.now();
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { status: res.status, body: rawText.slice(0, 500) },
    };
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Reply contains marker OK-TEXT-123", pass: content.includes("OK-TEXT-123") },
    { name: "completion_tokens > 0", pass: (usage.completion_tokens || 0) > 0, info: `tokens=${usage.completion_tokens}` },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: { content, usage, model: data?.model },
  };
}

module.exports = { runTextProbe };
