const fs = require("fs");
const path = require("path");
const { buildChatVisionBody } = require("../builders/multimodal");

const CAT_JPG_B64 = fs
  .readFileSync(path.join(__dirname, "assets/cat.jpg"))
  .toString("base64");

/**
 * Image+text probe: sends a cat photo and asserts the reply recognizes it as a cat.
 */
async function runImageProbe({ apiUrl, apiKey, model, extraHeaders = {} }) {
  const body = buildChatVisionBody({
    model,
    imageUrl: `data:image/jpeg;base64,${CAT_JPG_B64}`,
    prompt: "What animal is in this image? Answer with one word.",
    maxTokens: 16,
    temperature: 0,
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
  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Non-empty reply", pass: content.trim().length > 0 },
    { name: "Reply mentions 'cat'", pass: /cat|kitten|feline|猫/i.test(content) },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: { content, imagePreviewB64: CAT_JPG_B64, imageMime: "image/jpeg" },
  };
}

module.exports = { runImageProbe };
