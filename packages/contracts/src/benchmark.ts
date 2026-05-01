import { z } from "zod";

// ============================================================
// Enums
// ============================================================

export const BenchmarkApiTypeSchema = z.enum(["chat", "completion"]);
export type BenchmarkApiType = z.infer<typeof BenchmarkApiTypeSchema>;

export const BenchmarkProfileSchema = z.enum([
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
]);
export type BenchmarkProfile = z.infer<typeof BenchmarkProfileSchema>;

export const BenchmarkDatasetSchema = z.enum(["random", "sharegpt"]);
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;

export const BenchmarkStateSchema = z.enum([
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type BenchmarkState = z.infer<typeof BenchmarkStateSchema>;

// ============================================================
// Metrics
// ============================================================

export const LatencyDistributionSchema = z.object({
  mean: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
});
export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>;

export const BenchmarkMetricsSummarySchema = z.object({
  ttft: LatencyDistributionSchema,
  itl: LatencyDistributionSchema,
  e2eLatency: LatencyDistributionSchema,
  requestsPerSecond: z.object({ mean: z.number() }),
  outputTokensPerSecond: z.object({ mean: z.number() }),
  inputTokensPerSecond: z.object({ mean: z.number() }),
  totalTokensPerSecond: z.object({ mean: z.number() }),
  concurrency: z.object({ mean: z.number(), max: z.number() }),
  requests: z.object({
    total: z.number().int(),
    success: z.number().int(),
    error: z.number().int(),
    incomplete: z.number().int(),
  }),
});
export type BenchmarkMetricsSummary = z.infer<typeof BenchmarkMetricsSummarySchema>;

// ============================================================
// Create request (POST /api/benchmarks body)
// ============================================================

export const CreateBenchmarkRequestSchema = z
  .object({
    connectionId: z.string().min(1),
    name: z.string().min(1).max(128),
    description: z.string().max(2048).optional(),
    profile: BenchmarkProfileSchema,
    apiType: BenchmarkApiTypeSchema,
    datasetName: BenchmarkDatasetSchema,
    datasetInputTokens: z.number().int().min(1).optional(),
    datasetOutputTokens: z.number().int().min(1).optional(),
    datasetSeed: z.number().int().optional(),
    requestRate: z.number().int().min(0).default(0),
    totalRequests: z.number().int().min(1).max(100_000).default(1000),
  })
  .superRefine((data, ctx) => {
    if (data.datasetName === "random") {
      if (data.datasetInputTokens === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datasetInputTokens"],
          message: "Required when datasetName is 'random'",
        });
      }
      if (data.datasetOutputTokens === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datasetOutputTokens"],
          message: "Required when datasetName is 'random'",
        });
      }
    }
  });
export type CreateBenchmarkRequest = z.infer<typeof CreateBenchmarkRequestSchema>;

// ============================================================
// Read responses
// ============================================================

export const BenchmarkRunSummarySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  profile: BenchmarkProfileSchema,
  apiType: BenchmarkApiTypeSchema,
  /** Base URL of the OpenAI-compatible endpoint (no `/v1/...` path tail; guidellm appends it). */
  apiBaseUrl: z.string(),
  model: z.string(),
  datasetName: BenchmarkDatasetSchema,
  state: BenchmarkStateSchema,
  progress: z.number().nullable(),
  metricsSummary: BenchmarkMetricsSummarySchema.nullable(),
  createdAt: z.string(), // ISO 8601
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type BenchmarkRunSummary = z.infer<typeof BenchmarkRunSummarySchema>;

export const BenchmarkRunSchema = BenchmarkRunSummarySchema.extend({
  description: z.string().nullable(),
  datasetInputTokens: z.number().int().nullable(),
  datasetOutputTokens: z.number().int().nullable(),
  datasetSeed: z.number().int().nullable(),
  requestRate: z.number().int(),
  totalRequests: z.number().int(),
  stateMessage: z.string().nullable(),
  jobName: z.string().nullable(),
  rawMetrics: z.unknown().nullable(),
  logs: z.string().nullable(),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;

export const ListBenchmarksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  state: BenchmarkStateSchema.optional(),
  profile: BenchmarkProfileSchema.optional(),
  search: z.string().optional(),
});
export type ListBenchmarksQuery = z.infer<typeof ListBenchmarksQuerySchema>;

export const ListBenchmarksResponseSchema = z.object({
  items: z.array(BenchmarkRunSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListBenchmarksResponse = z.infer<typeof ListBenchmarksResponseSchema>;

// ============================================================
// Internal callback schemas (runner pod → API)
// ============================================================

export const BenchmarkStateCallbackSchema = z.object({
  state: BenchmarkStateSchema,
  stateMessage: z.string().max(2048).optional(),
  progress: z.number().min(0).max(1).optional(),
});
export type BenchmarkStateCallback = z.infer<typeof BenchmarkStateCallbackSchema>;

export const BenchmarkMetricsCallbackSchema = z.object({
  metricsSummary: BenchmarkMetricsSummarySchema,
  rawMetrics: z.unknown(),
  logs: z.string().optional(),
});
export type BenchmarkMetricsCallback = z.infer<typeof BenchmarkMetricsCallbackSchema>;
