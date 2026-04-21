/**
 * Builds an OpenAI-compatible image generation request body.
 * @param {object} cfg
 * @param {string} cfg.model
 * @param {string} cfg.imagePrompt
 * @param {string} [cfg.imageSize]
 * @param {number|string} [cfg.imageN]
 */
function buildImagesBody({ model, imagePrompt, imageSize, imageN }) {
  if (!imagePrompt) throw new Error("Missing required parameter: imagePrompt");
  const body = { model, prompt: imagePrompt };
  if (imageSize) body.size = imageSize;
  if (imageN) body.n = parseInt(imageN) || 1;
  return body;
}

module.exports = { buildImagesBody };
