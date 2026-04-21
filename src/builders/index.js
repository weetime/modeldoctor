const { buildChatBody } = require("./chat");
const { buildEmbeddingsBody } = require("./embeddings");
const { buildRerankBody } = require("./rerank");
const { buildImagesBody } = require("./images");
const { buildChatVisionBody, buildChatAudioBody } = require("./multimodal");

const VALID_API_TYPES = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
];

/**
 * Dispatches to the builder matching apiType. Throws on invalid or missing fields.
 * @param {string} apiType
 * @param {object} cfg - Full config forwarded from the request body.
 * @returns {object} OpenAI-compatible request body.
 */
function buildRequestBody(apiType, cfg) {
  switch (apiType) {
    case "chat":
      return buildChatBody(cfg);
    case "embeddings":
      return buildEmbeddingsBody(cfg);
    case "rerank":
      return buildRerankBody(cfg);
    case "images":
      return buildImagesBody(cfg);
    case "chat-vision":
      return buildChatVisionBody(cfg);
    case "chat-audio":
      return buildChatAudioBody(cfg);
    default:
      throw new Error(`Unknown apiType: ${apiType}`);
  }
}

module.exports = { buildRequestBody, VALID_API_TYPES };
