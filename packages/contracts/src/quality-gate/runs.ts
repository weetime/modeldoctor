import { z } from "zod";
import { evaluationSampleSchema } from "./evaluations.js";

export const runStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const gateResultSchema = z.enum(["PASSED", "WARNING", "FAILED"]);
export type GateResult = z.infer<typeof gateResultSchema>;

export const sampleDeltaSchema = z.enum([
  "REGRESSION",
  "IMPROVEMENT",
  "BOTH_PASS",
  "BOTH_FAIL",
  "NA",
]);
export type SampleDelta = z.infer<typeof sampleDeltaSchema>;

export const gateConfigSchema = z
  .object({
    passRateMin: z.number().min(0).max(1).optional(),
    regressionMax: z.number().int().nonnegative().optional(),
    judgeScoreMin: z.number().min(0).max(5).optional(),
  })
  .refine((c) => c.passRateMin != null || c.regressionMax != null || c.judgeScoreMin != null, {
    message: "gateConfig requires at least one threshold",
  });
export type GateConfig = z.infer<typeof gateConfigSchema>;

export const aggregateMetricsSchema = z.object({
  passRateA: z.number().min(0).max(1),
  passRateB: z.number().min(0).max(1).optional(),
  judgeAvgA: z.number().optional(),
  judgeAvgB: z.number().optional(),
  regressionCount: z.number().int().nonnegative().optional(),
  improvementCount: z.number().int().nonnegative().optional(),
  bothPassCount: z.number().int().nonnegative(),
  bothFailCount: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  judgeCallCount: z.number().int().nonnegative(),
});
export type AggregateMetrics = z.infer<typeof aggregateMetricsSchema>;

export const connectionRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  baseUrl: z.string(),
});
export type ConnectionRef = z.infer<typeof connectionRefSchema>;

export const evaluationRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type EvaluationRef = z.infer<typeof evaluationRefSchema>;

export const evaluationRunSchema = z.object({
  id: z.string(),
  userId: z.string(),
  evaluationId: z.string(),
  evaluationVersion: z.number().int().positive(),
  evaluationSnapshot: z.object({ samples: z.array(evaluationSampleSchema) }),
  evaluation: evaluationRefSchema.nullable(),
  endpointAId: z.string(),
  endpointBId: z.string().nullable(),
  endpointA: connectionRefSchema.nullable(),
  endpointB: connectionRefSchema.nullable(),
  gateConfig: gateConfigSchema,
  status: runStatusSchema,
  gateResult: gateResultSchema.nullable(),
  aggregateMetrics: aggregateMetricsSchema.nullable(),
  processedSamples: z.number().int().nonnegative(),
  totalSamples: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  baselineRunIdAtExecution: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export const createRunRequestSchema = z
  .object({
    evaluationId: z.string(),
    endpointAId: z.string(),
    endpointBId: z.string().optional(),
    baselineRunIdOverride: z.string().nullable().optional(),
    gateConfig: gateConfigSchema,
  })
  .refine((r) => r.endpointBId == null || r.endpointBId !== r.endpointAId, {
    message: "validation.endpointABMustDiffer",
    path: ["endpointBId"],
  })
  .refine((r) => !(r.endpointBId != null && r.baselineRunIdOverride != null), {
    message: "validation.runDualVsBaselineExclusive",
    path: ["baselineRunIdOverride"],
  });
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const listRunsQuerySchema = z.object({
  status: runStatusSchema.optional(),
  evaluationId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(evaluationRunSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
