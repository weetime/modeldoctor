const { buildChatAudioBody } = require("../builders/multimodal");
const { isValidWav } = require("../utils/wav");

/**
 * Text→audio probe: asserts the response contains a valid WAV payload in some choice.
 * Exercises the full thinker+talker+code2wav pipeline for omni models.
 */
async function runAudioProbe({ apiUrl, apiKey, model, extraHeaders = {} }) {
  const body = buildChatAudioBody({
    model,
    prompt: "Say the word hello.",
    systemPrompt: "You are Qwen, a virtual human capable of generating text and speech.",
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

  // Audio sits in a dedicated choice (choices[i].message.audio.data); iterate all.
  let audioB64 = null;
  let textReply = null;
  for (const choice of data.choices || []) {
    const m = choice.message || {};
    if (!audioB64 && m.audio && m.audio.data) audioB64 = m.audio.data;
    if (!textReply && m.content) textReply = m.content;
  }

  let wavOk = false;
  let wavBytes = 0;
  if (audioB64) {
    const buf = Buffer.from(audioB64, "base64");
    wavBytes = buf.length;
    wavOk = isValidWav(buf);
  }

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Audio choice returned", pass: !!audioB64 },
    { name: "Audio payload > 1 KB", pass: wavBytes > 1024, info: `${wavBytes} bytes` },
    { name: "Valid WAV header (RIFF/WAVE)", pass: wavOk },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      numChoices: data.choices?.length || 0,
      textReply,
      audioBytes: wavBytes,
      audioB64, // frontend decodes this for the <audio> player
    },
  };
}

module.exports = { runAudioProbe };
