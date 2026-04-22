/**
 * Builds a rerank request body (texts split by newline).
 *
 * Ported verbatim from the legacy CJS builder (src/builders/rerank.js).
 */

export interface RerankBodyConfig {
  model: string;
  rerankQuery?: string;
  /** Newline-separated texts. */
  rerankTexts?: string;
}

export function buildRerankBody({
  model,
  rerankQuery,
  rerankTexts,
}: RerankBodyConfig): Record<string, unknown> {
  if (!rerankQuery || !rerankTexts) {
    throw new Error("Missing required parameters: rerankQuery, rerankTexts");
  }
  const texts = rerankTexts
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return { model, query: rerankQuery, texts };
}
