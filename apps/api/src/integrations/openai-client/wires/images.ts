export interface BuildImagesBodyInput {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  seed?: number;
}

export function buildPlaygroundImagesBody(input: BuildImagesBodyInput): Record<string, unknown> {
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

export interface BuildPlaygroundImagesEditFormDataInput {
  image: { buffer: Buffer; originalname: string; mimetype: string };
  mask: { buffer: Buffer; originalname: string; mimetype: string };
  model: string;
  prompt: string;
  n?: number;
  size?: string;
}

/**
 * Build the multipart body for OpenAI's `/images/edits` endpoint. The
 * `image` part may be PNG/JPEG/WebP; the `mask` MUST be a PNG with an
 * alpha channel — pixels with alpha=0 are the area to be inpainted.
 */
export function buildPlaygroundImagesEditFormData({
  image,
  mask,
  model,
  prompt,
  n,
  size,
}: BuildPlaygroundImagesEditFormDataInput): FormData {
  const form = new FormData();
  const imageAB = image.buffer.buffer.slice(
    image.buffer.byteOffset,
    image.buffer.byteOffset + image.buffer.byteLength,
  ) as ArrayBuffer;
  const maskAB = mask.buffer.buffer.slice(
    mask.buffer.byteOffset,
    mask.buffer.byteOffset + mask.buffer.byteLength,
  ) as ArrayBuffer;
  form.append("image", new Blob([imageAB], { type: image.mimetype }), image.originalname);
  form.append("mask", new Blob([maskAB], { type: mask.mimetype }), mask.originalname);
  form.append("prompt", prompt);
  form.append("model", model);
  if (n !== undefined) form.append("n", String(n));
  if (size?.trim()) form.append("size", size);
  return form;
}
