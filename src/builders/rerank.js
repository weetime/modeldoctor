/**
 * Builds a rerank request body (texts split by newline).
 * @param {object} cfg
 * @param {string} cfg.model
 * @param {string} cfg.rerankQuery
 * @param {string} cfg.rerankTexts - newline-separated texts
 */
function buildRerankBody({ model, rerankQuery, rerankTexts }) {
  if (!rerankQuery || !rerankTexts) {
    throw new Error("Missing required parameters: rerankQuery, rerankTexts");
  }
  const texts = rerankTexts
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return { model, query: rerankQuery, texts };
}

module.exports = { buildRerankBody };
