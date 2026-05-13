import { z } from "zod";

// Anchored to the 2026-05-12 yrcache-vs-lmcache report methodology
// (6 task × 2 round cold/warm). Defaults match Task 1 (8K prompt · parallel 8).
//
// `seed` is the lever that makes cold/warm A/B reproducible: rerunning
// the SAME benchmark (with `--seed`) produces an identical prompt sequence
// from evalscope's dataset sampler, so R2 is genuinely measuring cache hits
// against the same workload R1 cold-loaded.
export const evalscopeParamsSchema = z
  .object({
    parallel: z.number().int().min(1).max(256).default(8),
    number: z.number().int().min(1).max(10000).default(64),
    dataset: z.enum(["longalpaca", "openqa", "random"]).default("longalpaca"),
    minPromptLength: z.number().int().min(1).max(32000).default(8000),
    maxPromptLength: z.number().int().min(1).max(32000).default(9000),
    minTokens: z.number().int().min(1).max(4096).default(160),
    maxTokens: z.number().int().min(1).max(4096).default(200),
    apiPath: z
      .enum(["/v1/chat/completions", "/v1/completions"])
      .default("/v1/chat/completions"),
    stream: z.boolean().default(true),
    seed: z.number().int().optional(),
  })
  .refine((p) => p.minPromptLength <= p.maxPromptLength, {
    message: "minPromptLength must be <= maxPromptLength",
    path: ["minPromptLength"],
  })
  .refine((p) => p.minTokens <= p.maxTokens, {
    message: "minTokens must be <= maxTokens",
    path: ["minTokens"],
  });

export type EvalscopeParams = z.infer<typeof evalscopeParamsSchema>;

export const evalscopeParamDefaults: Partial<EvalscopeParams> = {
  parallel: 8,
  number: 64,
  dataset: "longalpaca",
  minPromptLength: 8000,
  maxPromptLength: 9000,
  minTokens: 160,
  maxTokens: 200,
  apiPath: "/v1/chat/completions",
  stream: true,
};

const dist = z.object({
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

export const evalscopeReportSchema = z.object({
  throughput: z.object({
    requestsPerSec: z.number().nonnegative(),
    outputTokensPerSec: z.number().nonnegative(),
    totalTokensPerSec: z.number().nonnegative(),
  }),
  ttft: dist,
  e2eLatency: dist,
  itl: dist,
  requests: z.object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
  }),
  // evalscope-only: KV cache hit rate surfaced when the backend (vLLM,
  // LMCache, YRCache) emits cached-token counters. evalscope reports a
  // single "KV Cache Hit Rate (%)" field (`AVERAGE_CACHED_PERCENT`); we
  // normalize to a 0-1 ratio.
  prefixCacheStats: z
    .object({
      hitRate: z.number().min(0).max(1),
    })
    .optional(),
});

export type EvalscopeReport = z.infer<typeof evalscopeReportSchema>;
