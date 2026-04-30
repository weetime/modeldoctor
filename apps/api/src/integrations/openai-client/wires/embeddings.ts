export interface BuildEmbeddingsBodyInput {
  model: string;
  input: string | string[];
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export function buildPlaygroundEmbeddingsBody({
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

// OpenAI returns `embedding` as a base64 string when `encoding_format=base64`:
// little-endian float32 bytes. Decode back to number[] so callers can stay
// format-agnostic.
function decodeBase64Embedding(s: string): number[] {
  const buf = Buffer.from(s, "base64");
  const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(floats);
}

export function parseEmbeddingsResponse(json: unknown): ParsedEmbeddingsResponse {
  const j = (json ?? {}) as {
    data?: { embedding?: unknown }[];
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const embeddings = (j.data ?? [])
    .map((d) => {
      if (Array.isArray(d.embedding)) return d.embedding as number[];
      if (typeof d.embedding === "string") return decodeBase64Embedding(d.embedding);
      return null;
    })
    .filter((v): v is number[] => v !== null);
  return { embeddings, usage: j.usage };
}
