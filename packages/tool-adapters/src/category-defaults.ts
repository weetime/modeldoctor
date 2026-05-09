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
export const VEGETA_CATEGORY_DEFAULTS = {
  chat: { apiType: "chat" },
  audio: { apiType: "chat-audio" },
  embeddings: { apiType: "embeddings" },
  rerank: { apiType: "rerank" },
  image: { apiType: "images" },
} as const satisfies Record<ModalityCategory, { apiType: VegetaParams["apiType"] }>;

export const GENAI_PERF_CATEGORY_DEFAULTS = {
  chat: { endpointType: "chat" },
  audio: { unsupported: true },
  embeddings: { endpointType: "embeddings" },
  rerank: { endpointType: "rankings" },
  image: { unsupported: true },
} as const satisfies Record<
  ModalityCategory,
  { endpointType: GenaiPerfParams["endpointType"] } | { unsupported: true }
>;

export const GUIDELLM_CATEGORY_DEFAULTS = {
  chat: { apiType: "chat" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
} as const satisfies Record<
  ModalityCategory,
  { apiType: GuidellmParams["apiType"] } | { unsupported: true }
>;

/**
 * prefix-cache-probe targets any chat-compatible vLLM endpoint; the modality
 * category doesn't restrict which connections are compatible. All categories
 * are supported — the only actual gate is `prometheusUrl` presence, which the
 * form checks separately and surfaces as a blocking alert.
 */
export const PREFIX_CACHE_PROBE_CATEGORY_DEFAULTS = {
  chat: {},
  audio: {},
  embeddings: {},
  rerank: {},
  image: {},
} as const satisfies Record<ModalityCategory, Record<string, never>>;
