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
