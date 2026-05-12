import { z } from "zod";

// ── Params ────────────────────────────────────────────────────────────
//
// Workload anchored to the 2026-05-10 / 2026-05-11 reports in
// theriseunion/repots: a multi-turn dialog stress that forces prefix-cache
// evictions so different KV cache backends (LMCache / YRCache / vanilla)
// produce comparable QPS / TTFT / Prefix Cache Savings deltas.
//
// Bounds rationale:
//   - numSessions max 2000 — beyond that the deterministic prompt set
//     generation in kv_cache_stress.py thrashes Python memory (~2 KB per
//     session × N) without adding signal.
//   - turns max 16 — vLLM `max-model-len` typically 16-32k tokens, deeper
//     turns blow past that for a 2K-token system prompt.
//   - concurrency max 256 — vLLM `max-num-seqs` default 128-256; going
//     higher is queue-bound, not informative.
//   - durationSec min 30 — Prom counter delta is noisy below ~30s and the
//     warmup window dominates. min 60 recommended in production.
//   - durationSec max 7200 — 2h ceiling matches Phase 3's
//     BENCHMARK_DEFAULT_MAX_DURATION_SECONDS default; longer runs should
//     be split.
export const kvCacheStressParamsSchema = z.object({
  numSessions: z.number().int().min(1).max(2000).default(200),
  turns: z.number().int().min(1).max(16).default(4),
  concurrency: z.number().int().min(1).max(256).default(25),
  maxTokens: z.number().int().min(1).max(2048).default(50),
  durationSec: z.number().int().min(30).max(7200).default(600),
  systemPromptSeed: z.string().min(1).max(64).default("scn"),
});
export type KvCacheStressParams = z.infer<typeof kvCacheStressParamsSchema>;

export const kvCacheStressParamDefaults: Partial<KvCacheStressParams> = {
  numSessions: 200,
  turns: 4,
  concurrency: 25,
  maxTokens: 50,
  durationSec: 600,
  systemPromptSeed: "scn",
};

// ── Report ────────────────────────────────────────────────────────────

const latencyTriple = z.object({
  p50: z.number().nonnegative(),
  p90: z.number().nonnegative(),
  p99: z.number().nonnegative(),
});

// Optional block — populated only when connection.prometheusUrl was set
// AND the snapshot succeeded. Missing fields signal "couldn't compute".
const promBlock = z
  .object({
    hbmHitRatePct: z.number().min(0).max(100).optional(),
    prefixCacheSavingsPct: z.number().min(0).max(100).optional(),
    promptTokensTotalDelta: z.number().int().nonnegative().optional(),
    generationTokensTotalDelta: z.number().int().nonnegative().optional(),
  })
  .partial();

// Backend-specific counters surface as a flat record so we can show
// `lmcache:num_retrieve_requests_total` or `yrcache_num_retrieve_requests_total`
// without the adapter needing to know which is which.
//
// `nameGuess` is a heuristic the runner emits based on which counter family
// it saw in /metrics. "unknown" means neither lmcache:* nor yrcache_* showed
// up, which usually means the backend isn't actually wired in.
const backendBlock = z.object({
  nameGuess: z.enum(["lmcache", "yrcache", "unknown"]),
  counters: z.record(z.union([z.number(), z.string()])),
});

export const kvCacheStressReportSchema = z.object({
  qps: z.number().nonnegative(),
  outputTps: z.number().nonnegative(),
  requestsOk: z.number().int().nonnegative(),
  requestsErr: z.number().int().nonnegative(),
  errRatePct: z.number().min(0).max(100),
  ttftMs: latencyTriple,
  e2eMs: latencyTriple,
  prom: promBlock,
  backend: backendBlock,
});
export type KvCacheStressReport = z.infer<typeof kvCacheStressReportSchema>;
