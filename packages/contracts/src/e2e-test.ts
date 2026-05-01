import { z } from "zod";

// All probe identifiers, matching the 5 model-service categories below.
// Each id is dash-separated and explicitly names the wire shape (e.g. "rerank-tei"
// vs "rerank-cohere") so naming is unambiguous when a category contains
// multiple probes that hit different protocols.
export const ProbeNameSchema = z.enum([
  // chat (LLM)
  "chat-text",
  "chat-vision",
  // audio
  "tts",
  "asr",
  "chat-audio-omni",
  // embeddings
  "embeddings-openai",
  "embeddings-tei",
  // rerank
  "rerank-tei",
  "rerank-cohere",
  // image
  "image-gen",
]);
export type ProbeName = z.infer<typeof ProbeNameSchema>;

import { ModalityCategorySchema } from "./modality.js";

// Alias kept for backwards-compatible naming inside e2e-probe code paths.
export const ProbeCategorySchema = ModalityCategorySchema;
export type ProbeCategory = z.infer<typeof ProbeCategorySchema>;

/**
 * Category → probe ids. Iteration order in the array determines display
 * order in the UI, so don't rearrange casually.
 */
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

export const ProbeCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  info: z.string().optional(),
});
export type ProbeCheck = z.infer<typeof ProbeCheckSchema>;

export const ProbeResultSchema = z.object({
  pass: z.boolean(),
  latencyMs: z.number().nullable(),
  checks: z.array(ProbeCheckSchema),
  details: z.object({
    content: z.string().optional(),
    usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
    imagePreviewB64: z.string().optional(),
    imageMime: z.string().optional(),
    audioB64: z.string().optional(),
    audioBytes: z.number().optional(),
    numChoices: z.number().optional(),
    textReply: z.string().optional(),
    error: z.string().optional(),
    // Embeddings-specific
    embeddingDims: z.number().optional(),
    embeddingSample: z.array(z.number()).optional(),
    // Rerank-specific
    rerankResults: z.array(z.object({ index: z.number(), score: z.number() })).optional(),
    // Image-gen-specific
    imageGenUrl: z.string().optional(),
    imageGenB64: z.string().optional(),
  }),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

// Convention: `apiBaseUrl` is the origin (scheme://host[:port][/proxy-prefix]),
// without `/v1/...` path tail. Each probe constructs its target URL by
// appending its OpenAI-compatible default path OR an explicit pathOverride
// supplied per probe.
export const E2ETestRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  probes: z.array(ProbeNameSchema).min(1),
  // Per-probe path override (path tail starting with "/"). Missing keys fall
  // back to PROBE_DEFAULT_PATHS. Treats the value as opaque — the probe is
  // responsible for prepending apiBaseUrl.
  pathOverride: z.record(ProbeNameSchema, z.string()).optional(),
});
export type E2ETestRequest = z.infer<typeof E2ETestRequestSchema>;

export const E2ETestResponseSchema = z.object({
  runId: z.string(),
  success: z.boolean(),
  results: z.array(ProbeResultSchema.extend({ probe: ProbeNameSchema })),
  error: z.string().optional(),
});
export type E2ETestResponse = z.infer<typeof E2ETestResponseSchema>;
