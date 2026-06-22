import { z } from "zod";

const nameSchema = z.string().min(1).max(120);
const baseUrlSchema = z.string().url().max(500);
const modelSchema = z.string().min(1).max(200);
const apiKeySchema = z.string().min(1).max(500);

/**
 * Public view of a workspace-wide LLM-judge provider (apiKey omitted, replaced
 * by a masked preview). Multiple providers may exist; at most one is the
 * default. The service guarantees `isDefault === true` implies `enabled === true`.
 */
export const llmJudgeProviderPublicSchema = z.object({
  id: z.string(),
  name: nameSchema,
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  /** Masked key, e.g. "sk-...abcd". Empty string when no key is stored. */
  apiKeyPreview: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LlmJudgeProviderPublic = z.infer<typeof llmJudgeProviderPublicSchema>;

export const createLlmJudgeProviderSchema = z.object({
  name: nameSchema,
  baseUrl: baseUrlSchema,
  /** Required on create. */
  apiKey: apiKeySchema,
  model: modelSchema,
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type CreateLlmJudgeProvider = z.infer<typeof createLlmJudgeProviderSchema>;

/**
 * Patch semantics: every field optional. Omit `apiKey` (or send it absent) to
 * keep the previously-saved key. `name`/`baseUrl`/`model` keep their stored
 * value when omitted.
 */
export const updateLlmJudgeProviderSchema = createLlmJudgeProviderSchema.partial();
export type UpdateLlmJudgeProvider = z.infer<typeof updateLlmJudgeProviderSchema>;

export const listLlmJudgeProvidersResponseSchema = z.object({
  items: z.array(llmJudgeProviderPublicSchema),
});
export type ListLlmJudgeProvidersResponse = z.infer<typeof listLlmJudgeProvidersResponseSchema>;

export const testLlmJudgeRequestSchema = z.object({
  baseUrl: z.string().url(),
  /** Omit to test using a saved key. When omitted, `id` resolves which row's key to use. */
  apiKey: apiKeySchema.optional(),
  model: z.string().min(1),
  /** Existing provider id whose saved key should be used when `apiKey` is omitted. */
  id: z.string().optional(),
});
export type TestLlmJudgeRequest = z.infer<typeof testLlmJudgeRequestSchema>;

export const testLlmJudgeResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type TestLlmJudgeResponse = z.infer<typeof testLlmJudgeResponseSchema>;
