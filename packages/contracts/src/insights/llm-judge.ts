import { z } from "zod";

// Public (no apiKey)
export const llmJudgeProviderPublicSchema = z.object({
  id: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LlmJudgeProviderPublic = z.infer<typeof llmJudgeProviderPublicSchema>;

export const upsertLlmJudgeProviderSchema = z.object({
  baseUrl: z.string().url().max(500),
  /** Omit (or send empty string) to keep the previously-saved key on update. Required on first create. */
  apiKey: z.string().min(1).max(500).optional(),
  model: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
});
export type UpsertLlmJudgeProvider = z.infer<typeof upsertLlmJudgeProviderSchema>;

export const testLlmJudgeRequestSchema = z.object({
  baseUrl: z.string().url(),
  /** Omit to test using the previously-saved key. */
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1),
});
export type TestLlmJudgeRequest = z.infer<typeof testLlmJudgeRequestSchema>;

export const testLlmJudgeResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type TestLlmJudgeResponse = z.infer<typeof testLlmJudgeResponseSchema>;
