/**
 * Builds an OpenAI-compatible embeddings request body.
 * @param {object} cfg
 * @param {string} cfg.model
 * @param {string} cfg.embeddingInput
 */
function buildEmbeddingsBody({ model, embeddingInput }) {
  if (!embeddingInput) throw new Error("Missing required parameter: embeddingInput");
  return { model, input: embeddingInput };
}

module.exports = { buildEmbeddingsBody };
