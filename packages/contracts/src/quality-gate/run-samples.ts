import { z } from "zod";
import { sampleDeltaSchema } from "./runs.js";

export const endpointCallResultSchema = z.object({
  rawAnswer: z.string(),
  latencyMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type EndpointCallResult = z.infer<typeof endpointCallResultSchema>;

export const judgeOutcomeSchema = z.object({
  passed: z.boolean(),
  score: z.number().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});
export type JudgeOutcome = z.infer<typeof judgeOutcomeSchema>;

export const sampleResultSchema = z.object({
  call: endpointCallResultSchema,
  judge: judgeOutcomeSchema,
});
export type SampleResult = z.infer<typeof sampleResultSchema>;

export const runSampleSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sampleId: z.string(),
  sampleIdx: z.number().int().nonnegative(),
  resultA: sampleResultSchema,
  resultB: sampleResultSchema.nullable(),
  delta: sampleDeltaSchema,
  createdAt: z.string().datetime(),
});
export type RunSample = z.infer<typeof runSampleSchema>;

export const sampleFilterSchema = z.enum([
  "all",
  "regression",
  "improvement",
  "both-pass",
  "both-fail",
]);
export type SampleFilter = z.infer<typeof sampleFilterSchema>;

export const listRunSamplesQuerySchema = z.object({
  filter: sampleFilterSchema.default("all"),
  sortBy: z.enum(["idx", "delta", "judgeScore"]).default("idx"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListRunSamplesQuery = z.infer<typeof listRunSamplesQuerySchema>;

export const listRunSamplesResponseSchema = z.object({
  items: z.array(runSampleSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListRunSamplesResponse = z.infer<typeof listRunSamplesResponseSchema>;
