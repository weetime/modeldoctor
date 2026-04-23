/**
 * Request body builder dispatch.
 *
 * Ported verbatim from the legacy CJS builder (src/builders/index.js).
 * Order of VALID_API_TYPES is preserved so any downstream consumer that
 * iterates this list stays stable.
 */

import { buildChatBody } from "./chat.js";
import { buildEmbeddingsBody } from "./embeddings.js";
import { buildImagesBody } from "./images.js";
import { buildChatAudioBody, buildChatVisionBody } from "./multimodal.js";
import { buildRerankBody } from "./rerank.js";

export { buildChatBody } from "./chat.js";
export { buildEmbeddingsBody } from "./embeddings.js";
export { buildRerankBody } from "./rerank.js";
export { buildImagesBody } from "./images.js";
export { buildChatVisionBody, buildChatAudioBody } from "./multimodal.js";

export const VALID_API_TYPES = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
] as const;

export type ApiType = (typeof VALID_API_TYPES)[number];

/**
 * Dispatches to the builder matching apiType. Throws on invalid or missing fields.
 * The cfg object is the full request body forwarded from the HTTP layer.
 */
export function buildRequestBody(
  apiType: ApiType,
  cfg: Record<string, unknown>,
): Record<string, unknown> {
  // The builders each declare a stricter config interface. We accept a loose
  // Record here because the HTTP boundary gives us a JSON object; the individual
  // builders validate the fields they need and throw on missing required ones
  // (preserving the legacy behaviour). Cast via `unknown` so TS does not require
  // structural overlap.
  switch (apiType) {
    case "chat":
      return buildChatBody(cfg as unknown as Parameters<typeof buildChatBody>[0]);
    case "embeddings":
      return buildEmbeddingsBody(cfg as unknown as Parameters<typeof buildEmbeddingsBody>[0]);
    case "rerank":
      return buildRerankBody(cfg as unknown as Parameters<typeof buildRerankBody>[0]);
    case "images":
      return buildImagesBody(cfg as unknown as Parameters<typeof buildImagesBody>[0]);
    case "chat-vision":
      return buildChatVisionBody(cfg as unknown as Parameters<typeof buildChatVisionBody>[0]);
    case "chat-audio":
      return buildChatAudioBody(cfg as unknown as Parameters<typeof buildChatAudioBody>[0]);
    default: {
      const exhaustive: never = apiType;
      throw new Error(`Unknown apiType: ${String(exhaustive)}`);
    }
  }
}
