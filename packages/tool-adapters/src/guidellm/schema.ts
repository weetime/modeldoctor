import { z } from "zod";

export const guidellmParamsSchema = z
  .object({
    profile: z.enum([
      "throughput",
      "latency",
      "long_context",
      "generation_heavy",
      "sharegpt",
      "custom",
    ]),
    apiType: z.enum(["chat", "completion"]),
    datasetName: z.enum(["random", "sharegpt"]),
    datasetInputTokens: z.number().int().positive().optional(),
    datasetOutputTokens: z.number().int().positive().optional(),
    datasetSeed: z.number().int().optional(),
    requestRate: z.number().int().min(0).default(0),
    totalRequests: z.number().int().min(1).max(100_000).default(1000),
    maxDurationSeconds: z.number().int().positive().default(1800),
    maxConcurrency: z.number().int().positive().default(100),
    processor: z.string().optional(),
    validateBackend: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.datasetName === "random" && (!d.datasetInputTokens || !d.datasetOutputTokens)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "random dataset requires datasetInputTokens and datasetOutputTokens",
      });
    }
  });
export type GuidellmParams = z.infer<typeof guidellmParamsSchema>;

const dist = z.object({
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

export const guidellmReportSchema = z.object({
  ttft: dist,
  itl: dist,
  e2eLatency: dist,
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
export type GuidellmReport = z.infer<typeof guidellmReportSchema>;

// Skeleton for FE form prefill. NOT fully valid (datasetInputTokens is
// required for random dataset). Frontend layer fills the gaps from user
// input before submit.
export const guidellmParamDefaults: Partial<GuidellmParams> = {
  profile: "throughput",
  apiType: "chat",
  datasetName: "random",
  requestRate: 0,
  totalRequests: 1000,
  maxDurationSeconds: 1800,
  maxConcurrency: 100,
  validateBackend: true,
};
