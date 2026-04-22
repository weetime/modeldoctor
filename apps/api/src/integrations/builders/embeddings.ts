/**
 * Builds an OpenAI-compatible embeddings request body.
 *
 * Ported verbatim from the legacy CJS builder (src/builders/embeddings.js).
 */

export interface EmbeddingsBodyConfig {
  model: string;
  embeddingInput?: string;
}

export function buildEmbeddingsBody({
  model,
  embeddingInput,
}: EmbeddingsBodyConfig): Record<string, unknown> {
  if (!embeddingInput)
    throw new Error("Missing required parameter: embeddingInput");
  return { model, input: embeddingInput };
}
