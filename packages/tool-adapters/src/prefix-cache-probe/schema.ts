import { z } from "zod";

// ── Params ────────────────────────────────────────────────────────────
// promptSets capped at 5 because the bundled probe script ships 5 fixed
// long-prefix prompts (see apps/benchmark-runner/scripts/prefix_cache_probe.py).
// promBackoffSec must be >= 15 because Prometheus default scrape interval
// is 15s; querying earlier returns a stale snapshot with 0 deltas.
export const prefixCacheProbeParamsSchema = z.object({
  promptSets: z.number().int().min(2).max(5).default(2),
  requestsPerSet: z.number().int().min(5).max(50).default(10),
  maxTokens: z.number().int().min(1).max(50).default(5),
  promBackoffSec: z.number().int().min(15).max(60).default(18),
});
export type PrefixCacheProbeParams = z.infer<typeof prefixCacheProbeParamsSchema>;

export const prefixCacheProbeParamDefaults: Partial<PrefixCacheProbeParams> = {
  promptSets: 2,
  requestsPerSet: 10,
  maxTokens: 5,
  promBackoffSec: 18,
};

// ── Report ────────────────────────────────────────────────────────────
const perPodCounts = z.object({
  pod: z.string(),
  queries: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
});

const promptSetSummary = z.object({
  label: z.string(),
  dominantPod: z.string(),
  dominantPct: z.number().min(0).max(100),
  totalRequests: z.number().int().nonnegative(),
});

export const prefixCacheProbeReportSchema = z.object({
  stickinessPct: z.number().min(0).max(100),
  deterministic: z.boolean(),
  perPod: z.array(perPodCounts),
  promptSets: z.array(promptSetSummary),
});
export type PrefixCacheProbeReport = z.infer<typeof prefixCacheProbeReportSchema>;
