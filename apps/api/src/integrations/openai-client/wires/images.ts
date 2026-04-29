export interface BuildImagesBodyInput {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  seed?: number;
}

export function buildImagesBody(input: BuildImagesBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt };
  if (input.size !== undefined) body.size = input.size;
  if (input.n !== undefined) body.n = input.n;
  if (input.responseFormat !== undefined) body.response_format = input.responseFormat;
  if (input.seed !== undefined) body.seed = input.seed;
  return body;
}

export interface ImageArtifact {
  url: string | undefined;
  b64Json: string | undefined;
}

export function parseImagesResponse(json: unknown): ImageArtifact[] {
  const j = (json ?? {}) as { data?: { url?: string; b64_json?: string }[] };
  return (j.data ?? []).map((d) => ({ url: d.url, b64Json: d.b64_json }));
}
