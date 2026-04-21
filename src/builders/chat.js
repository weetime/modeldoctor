/**
 * Builds an OpenAI-compatible chat completion request body.
 * @param {object} cfg
 * @param {string} cfg.model
 * @param {string} cfg.prompt
 * @param {number} [cfg.maxTokens]
 * @param {number} [cfg.temperature]
 * @param {boolean} [cfg.stream]
 */
function buildChatBody({ model, prompt, maxTokens, temperature, stream }) {
  if (!prompt) throw new Error("Missing required parameter: prompt");
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: parseInt(maxTokens) || 1000,
    temperature: parseFloat(temperature) || 0.7,
    stream: !!stream,
  };
}

module.exports = { buildChatBody };
