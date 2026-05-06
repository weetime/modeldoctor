import type { ModalityCategory } from "@modeldoctor/contracts";
import type { GenaiPerfParams } from "./genai-perf/schema.js";
import type { GuidellmParams } from "./guidellm/schema.js";
import type { VegetaParams } from "./vegeta/schema.js";

/**
 * Per-tool default for "given a connection of this ModalityCategory, what
 * apiType/endpointType is the closest match?". Forms `useWatch` the
 * connectionId and apply this mapping to keep the user out of the
 * "default chat against an embedding endpoint → 100% errors" trap.
 *
 * `{ unsupported: true }` is the explicit signal for "this tool does not
 * speak this modality" — the form renders an inline warning instead of
 * silently picking a wrong fallback.
 */
export const VEGETA_CATEGORY_DEFAULTS: Record<
  ModalityCategory,
  { apiType: VegetaParams["apiType"] }
> = {
  chat: { apiType: "chat" },
  audio: { apiType: "chat-audio" },
  embeddings: { apiType: "embeddings" },
  rerank: { apiType: "rerank" },
  image: { apiType: "images" },
};

export const GENAI_PERF_CATEGORY_DEFAULTS: Record<
  ModalityCategory,
  { endpointType: GenaiPerfParams["endpointType"] } | { unsupported: true }
> = {
  chat: { endpointType: "chat" },
  audio: { unsupported: true },
  embeddings: { endpointType: "embeddings" },
  rerank: { endpointType: "rankings" },
  image: { unsupported: true },
};

export const GUIDELLM_CATEGORY_DEFAULTS: Record<
  ModalityCategory,
  { apiType: GuidellmParams["apiType"] } | { unsupported: true }
> = {
  chat: { apiType: "chat" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
};
