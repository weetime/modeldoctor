import { z } from "zod";

/**
 * OpenAI-compatible chat message. Content is either a plain string OR an
 * array of typed content parts (used for multimodal — image_url, input_audio
 * — added in Phase 2).
 */
export const ChatMessageContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string() }),
  }),
  z.object({
    type: z.literal("input_audio"),
    input_audio: z.object({ data: z.string(), format: z.string() }),
  }),
]);
export type ChatMessageContentPart = z.infer<typeof ChatMessageContentPartSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([z.string(), z.array(ChatMessageContentPartSchema)]),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatParamsSchema = z
  .object({
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
  })
  .partial();
export type ChatParams = z.infer<typeof ChatParamsSchema>;

/**
 * Phase 1 request to POST /api/playground/chat (non-streaming).
 *
 * Note: there's no separate `systemMessage` field — callers prepend
 * `{ role: "system", content: ... }` to `messages` directly. This keeps
 * the wire shape closer to OpenAI's native chat-completions API and
 * removes a layer of frontend-side message-array rebuilding.
 */
export const PlaygroundChatRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  /** Override the default `/v1/chat/completions` path tail. */
  pathOverride: z.string().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  params: ChatParamsSchema.default({}),
});
export type PlaygroundChatRequest = z.infer<typeof PlaygroundChatRequestSchema>;

export const PlaygroundChatResponseSchema = z.object({
  success: z.boolean(),
  /** Assistant's reply text. Present iff success === true. */
  content: z.string().optional(),
  /** Error message. Present iff success === false. */
  error: z.string().optional(),
  /** End-to-end wall-clock duration of the upstream call. */
  latencyMs: z.number(),
  /** Raw OpenAI usage block (if returned). */
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});
export type PlaygroundChatResponse = z.infer<typeof PlaygroundChatResponseSchema>;

// ─── Embeddings ───────────────────────────────────────────────────────────

export const PlaygroundEmbeddingsRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  encodingFormat: z.enum(["float", "base64"]).optional(),
  dimensions: z.number().int().positive().optional(),
});
export type PlaygroundEmbeddingsRequest = z.infer<typeof PlaygroundEmbeddingsRequestSchema>;

export const PlaygroundEmbeddingsResponseSchema = z.object({
  success: z.boolean(),
  embeddings: z.array(z.array(z.number())).optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});
export type PlaygroundEmbeddingsResponse = z.infer<typeof PlaygroundEmbeddingsResponseSchema>;

// ─── Rerank ──────────────────────────────────────────────────────────────

export const PlaygroundRerankRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  query: z.string().min(1),
  documents: z.array(z.string().min(1)).min(1),
  topN: z.number().int().positive().optional(),
  returnDocuments: z.boolean().optional(),
  wire: z.enum(["cohere", "tei"]).default("cohere"),
});
export type PlaygroundRerankRequest = z.infer<typeof PlaygroundRerankRequestSchema>;

export const PlaygroundRerankResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(z.object({ index: z.number().int(), score: z.number() })).optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
});
export type PlaygroundRerankResponse = z.infer<typeof PlaygroundRerankResponseSchema>;

// ─── Images ──────────────────────────────────────────────────────────────

export const PlaygroundImagesRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  prompt: z.string().min(1),
  size: z.string().optional(),
  n: z.number().int().positive().optional(),
  responseFormat: z.enum(["url", "b64_json"]).optional(),
  seed: z.number().int().optional(),
});
export type PlaygroundImagesRequest = z.infer<typeof PlaygroundImagesRequestSchema>;

export const PlaygroundImagesResponseSchema = z.object({
  success: z.boolean(),
  artifacts: z
    .array(
      z.object({
        url: z.string().optional(),
        b64Json: z.string().optional(),
      }),
    )
    .optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
});
export type PlaygroundImagesResponse = z.infer<typeof PlaygroundImagesResponseSchema>;
