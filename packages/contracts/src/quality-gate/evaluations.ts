import { z } from "zod";
import { judgeConfigSchema } from "./judge-config.js";

export const evaluationSampleSchema = z.object({
  id: z.string().min(1).max(64),
  idx: z.number().int().nonnegative(),
  prompt: z.string().min(1).max(8000),
  expected: z.string().max(8000),
  judgeConfig: judgeConfigSchema,
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type EvaluationSample = z.infer<typeof evaluationSampleSchema>;

// Request shape: `id` and `idx` are assigned server-side via assignIds(), so
// callers can omit them. The persisted/response shape (evaluationSampleSchema)
// keeps both required.
export const evaluationSampleInputSchema = evaluationSampleSchema.extend({
  id: z.string().max(64).optional(),
  idx: z.number().int().nonnegative().optional(),
});
export type EvaluationSampleInput = z.infer<typeof evaluationSampleInputSchema>;

export const evaluationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  version: z.number().int().positive(),
  samples: z.array(evaluationSampleSchema),
  totalSamples: z.number().int().nonnegative(),
  // Official built-in evaluations (seeded by the platform). Read-only — users
  // cannot modify name/description/samples or delete; they can run against
  // them and duplicate them as a starting point for their own evaluations.
  isOfficial: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const createEvaluationRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  samples: z.array(evaluationSampleInputSchema).min(1).max(500),
});
export type CreateEvaluationRequest = z.infer<typeof createEvaluationRequestSchema>;

export const updateEvaluationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  samples: z.array(evaluationSampleInputSchema).min(1).max(500).optional(),
});
export type UpdateEvaluationRequest = z.infer<typeof updateEvaluationRequestSchema>;

export const listEvaluationsResponseSchema = z.object({
  items: z.array(evaluationSchema),
});
export type ListEvaluationsResponse = z.infer<typeof listEvaluationsResponseSchema>;

// Import payload (JSON form) — same as samples; id/idx assigned server-side.
export const importEvaluationJsonSchema = z.object({
  format: z.literal("json"),
  payload: z.array(evaluationSampleInputSchema).min(1).max(500),
});
// CSV import: columns prompt | expected | judgeKind | judgeConfig(JSON) | tags(comma)
// The CSV parser turns rows into the same EvaluationSample shape before validation.
export const importEvaluationCsvSchema = z.object({
  format: z.literal("csv"),
  payload: z.string().min(1).max(2_000_000),
});
export const importEvaluationRequestSchema = z.discriminatedUnion("format", [
  importEvaluationJsonSchema,
  importEvaluationCsvSchema,
]);
export type ImportEvaluationRequest = z.infer<typeof importEvaluationRequestSchema>;
