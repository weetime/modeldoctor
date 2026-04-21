// Multimodal chat request builders.
// Both send to /v1/chat/completions but with different payload shapes.

/**
 * Chat with image+text input (vision). Returns text.
 * @param {object} cfg
 * @param {string} cfg.model
 * @param {string} cfg.prompt      - user text question
 * @param {string} cfg.imageUrl    - http(s) URL or data URL (data:image/...;base64,...)
 * @param {number} [cfg.maxTokens]
 * @param {number} [cfg.temperature]
 * @param {string} [cfg.systemPrompt]
 */
function buildChatVisionBody({ model, prompt, imageUrl, maxTokens, temperature, systemPrompt }) {
  if (!prompt) throw new Error("Missing required parameter: prompt");
  if (!imageUrl) throw new Error("Missing required parameter: imageUrl");

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: [{ type: "text", text: systemPrompt }] });
  }
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text", text: prompt },
    ],
  });
  return {
    model,
    messages,
    max_tokens: parseInt(maxTokens) || 256,
    temperature: parseFloat(temperature) || 0.0,
  };
}

/**
 * Chat with text input, returns audio (TTS via omni/multimodal LLM).
 * Uses modalities=["audio"] which for vllm-omni means text + audio.
 * @param {object} cfg
 * @param {string} cfg.model
 * @param {string} cfg.prompt
 * @param {string} [cfg.systemPrompt]
 */
function buildChatAudioBody({ model, prompt, systemPrompt }) {
  if (!prompt) throw new Error("Missing required parameter: prompt");

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: [{ type: "text", text: systemPrompt }] });
  }
  messages.push({ role: "user", content: [{ type: "text", text: prompt }] });

  return {
    model,
    messages,
    modalities: ["audio"],
  };
}

module.exports = { buildChatVisionBody, buildChatAudioBody };
