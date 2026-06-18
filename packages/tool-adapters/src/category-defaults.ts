import type { ModalityCategory } from "@modeldoctor/contracts";
import type { AiperfParams } from "./aiperf/schema.js";
import type { EvalscopeParams } from "./evalscope/schema.js";
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
 * evalscope perf supports chat/completions and completions; the schema's
 * `apiPath` enum gates the rest. Embedding / rerank / image / audio are out
 * of scope for the inference + engine-kv-cache scenarios where evalscope
 * is offered, so they get `unsupported` markers like guidellm.
 */
export const EVALSCOPE_CATEGORY_DEFAULTS = {
  chat: { apiPath: "/v1/chat/completions" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
} as const satisfies Record<
  ModalityCategory,
  { apiPath: EvalscopeParams["apiPath"] } | { unsupported: true }
>;

/**
 * AIPerf currently targets chat/completions only in this app. Embedding /
 * rerank / image / audio are out of scope for the inference scenario where
 * AIPerf is offered — same posture as evalscope / guidellm.
 */
export const AIPERF_CATEGORY_DEFAULTS = {
  chat: { endpointType: "chat" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
} as const satisfies Record<
  ModalityCategory,
  { endpointType: AiperfParams["endpointType"] } | { unsupported: true }
>;
