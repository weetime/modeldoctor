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
    // Full 5-value enum here so that capacity scenario's z.literal("sweep")
    // constraint can merge cleanly. The inference scenario narrows to
    // {constant, poisson, throughput, synchronous} server-side.
    rateType: z.enum(["constant", "poisson", "throughput", "synchronous", "sweep"]),
    requestRate: z.number().min(0).default(0),
    totalRequests: z.number().int().min(1).max(100_000).default(1000),
    maxDurationSeconds: z.number().int().positive().default(1800),
    maxConcurrency: z.number().int().positive().default(100),
    processor: z.string().min(1).optional(),
    validateBackend: z.boolean().default(false),
  })
  .superRefine((d, ctx) => {
    if (d.datasetName === "random") {
      if (!d.datasetInputTokens) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datasetInputTokens"],
          message: "random dataset requires datasetInputTokens",
        });
      }
      if (!d.datasetOutputTokens) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datasetOutputTokens"],
          message: "random dataset requires datasetOutputTokens",
        });
      }
    }
  });
export type GuidellmParams = z.infer<typeof guidellmParamsSchema>;

/** Tuple of accepted rateType values, exposed for UI dropdowns to derive
 *  options without duplicating the enum literal. Single source of truth:
 *  adding a new rateType value requires updating only schema.ts. */
export const guidellmRateTypes = guidellmParamsSchema._def.schema.shape.rateType
  .options as readonly GuidellmParams["rateType"][];

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
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    incomplete: z.number().int().nonnegative(),
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
  rateType: "constant",
  requestRate: 0,
  totalRequests: 1000,
  maxDurationSeconds: 1800,
  maxConcurrency: 100,
  validateBackend: false,
};
