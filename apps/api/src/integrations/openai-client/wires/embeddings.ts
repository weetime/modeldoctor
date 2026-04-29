export interface BuildEmbeddingsBodyInput {
  model: string;
  input: string | string[];
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export function buildEmbeddingsBody({
  model,
  input,
  encodingFormat,
  dimensions,
}: BuildEmbeddingsBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model, input };
  if (encodingFormat !== undefined) body.encoding_format = encodingFormat;
  if (dimensions !== undefined) body.dimensions = dimensions;
  return body;
}

export interface ParsedEmbeddingsResponse {
  embeddings: number[][];
  usage: { prompt_tokens?: number; total_tokens?: number } | undefined;
}

export function parseEmbeddingsResponse(json: unknown): ParsedEmbeddingsResponse {
  const j = (json ?? {}) as {
    data?: { embedding?: unknown }[];
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const embeddings = (j.data ?? [])
    .map((d) => (Array.isArray(d.embedding) ? (d.embedding as number[]) : null))
    .filter((v): v is number[] => v !== null);
  return { embeddings, usage: j.usage };
}
