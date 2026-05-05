import type { ModalityCategory, ProbeName } from "@modeldoctor/contracts";

export type {
  ProbeName,
  ProbeCheck,
  ProbeResult,
  DiagnosticsRunResponse,
} from "@modeldoctor/contracts";

/**
 * The diagnostics page groups probes by ModalityCategory. The contracts
 * package owns the category enum (it's also used by Connection.category);
 * the probe→category mapping is presentational and lives here.
 *
 * Iteration order in the array determines display order in the UI; do not
 * rearrange casually.
 */
export type ProbeCategory = ModalityCategory;

export const PROBES_BY_CATEGORY: Record<ProbeCategory, readonly ProbeName[]> = {
  chat: ["chat-text", "chat-vision"],
  audio: ["tts", "asr", "chat-audio-omni"],
  embeddings: ["embeddings-openai", "embeddings-tei"],
  rerank: ["rerank-tei", "rerank-cohere"],
  image: ["image-gen"],
} as const;

/**
 * Default OpenAI-compatible (or community-standard) path each probe hits
 * when the user does not supply an override. Source-of-truth for the path
 * shown in the UI's editable field.
 */
export const PROBE_DEFAULT_PATHS: Record<ProbeName, string> = {
  "chat-text": "/v1/chat/completions",
  "chat-vision": "/v1/chat/completions",
  "chat-audio-omni": "/v1/chat/completions",
  tts: "/v1/audio/speech",
  asr: "/v1/audio/transcriptions",
  "embeddings-openai": "/v1/embeddings",
  "embeddings-tei": "/embed",
  "rerank-tei": "/rerank",
  "rerank-cohere": "/v1/rerank",
  "image-gen": "/v1/images/generations",
};
