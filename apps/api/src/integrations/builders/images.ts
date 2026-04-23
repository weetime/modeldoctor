/**
 * Builds an OpenAI-compatible image generation request body.
 *
 * Ported verbatim from the legacy CJS builder (src/builders/images.js).
 * `imageSize` and `imageN` are only added when truthy; `imageN` is coerced
 * via `parseInt(imageN) || 1` to match the old behaviour (zero / NaN → 1).
 */

export interface ImagesBodyConfig {
  model: string;
  imagePrompt?: string;
  imageSize?: string;
  imageN?: number | string;
}

export function buildImagesBody({
  model,
  imagePrompt,
  imageSize,
  imageN,
}: ImagesBodyConfig): Record<string, unknown> {
  if (!imagePrompt) throw new Error("Missing required parameter: imagePrompt");
  const body: Record<string, unknown> = { model, prompt: imagePrompt };
  if (imageSize) body.size = imageSize;
  if (imageN) body.n = Number.parseInt(imageN as string) || 1;
  return body;
}
