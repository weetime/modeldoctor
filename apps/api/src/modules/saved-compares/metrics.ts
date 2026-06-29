import {
  engineMetricsAnnotationSchema,
  type FigureRefId,
  prefixCacheAnnotationSchema,
} from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters";

export function readP95Latency(m: unknown): number | null {
  return readMetricSafe("e2e.p95", m as { tool?: unknown; data?: unknown } | null);
}

export function readErrorRate(m: unknown): number | null {
  return readMetricSafe("errorRate", m as { tool?: unknown; data?: unknown } | null);
}

export function readThroughput(m: unknown): number | null {
  return readMetricSafe("requestsPerSec", m as { tool?: unknown; data?: unknown } | null);
}

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  // Inter-token latency (TPOT). ITL only exposes p50/p95 across tools.
  itl: { p50: number | null; p95: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

/**
 * Build a compact metrics snapshot for AI compare narratives.
 *
 * All field reads delegate to `readMetricSafe`. The `ttft` and `e2e`
 * sub-objects are null when the tool doesn't carry that distribution at
 * all (vegeta has no TTFT) — detected by checking whether any of p50/p90/p99
 * resolves to a number. Now that `MetricKind` includes the p50/p90 buckets,
 * no per-tool field-path table is needed.
 */
export function summarizeForPrompt(m: unknown): PromptMetricsSummary {
  const summary = m as { tool?: unknown; data?: unknown } | null;
  const ttftP50 = readMetricSafe("ttft.p50", summary);
  const ttftP90 = readMetricSafe("ttft.p90", summary);
  const ttftP99 = readMetricSafe("ttft.p99", summary);
  const e2eP50 = readMetricSafe("e2e.p50", summary);
  const e2eP90 = readMetricSafe("e2e.p90", summary);
  const e2eP99 = readMetricSafe("e2e.p99", summary);
  const itlP50 = readMetricSafe("itl.p50", summary);
  const itlP95 = readMetricSafe("itl.p95", summary);

  return {
    throughput: readMetricSafe("requestsPerSec", summary),
    errorRate: readMetricSafe("errorRate", summary),
    ttft:
      ttftP50 === null && ttftP90 === null && ttftP99 === null
        ? null
        : { p50: ttftP50, p90: ttftP90, p99: ttftP99 },
    itl: itlP50 === null && itlP95 === null ? null : { p50: itlP50, p95: itlP95 },
    e2e:
      e2eP50 === null && e2eP90 === null && e2eP99 === null
        ? null
        : { p50: e2eP50, p90: e2eP90, p99: e2eP99 },
  };
}

export interface PrefixCacheSummary {
  hitRatePct: number;
  topPodSharePct: number;
}

/** Read serverMetrics.prefixCache (hit rate + top-pod share). Mirrors the
 * client-side `client-metrics.ts#readPrefixCache`. Null when absent/malformed. */
export function readPrefixCache(serverMetrics: unknown): PrefixCacheSummary | null {
  const parsed = prefixCacheAnnotationSchema.safeParse(
    (serverMetrics as { prefixCache?: unknown } | null)?.prefixCache,
  );
  if (!parsed.success) return null;
  return { hitRatePct: parsed.data.hitRatePct, topPodSharePct: parsed.data.topPodSharePct };
}

export interface PodDatum {
  pod: string;
  queries: number;
  hits: number;
}

/** Read serverMetrics.prefixCache.perPod (per-pod query/hit counts). Null when
 * the annotation is absent/malformed; [] when present but empty. */
export function readPodDistribution(serverMetrics: unknown): PodDatum[] | null {
  const parsed = prefixCacheAnnotationSchema.safeParse(
    (serverMetrics as { prefixCache?: unknown } | null)?.prefixCache,
  );
  if (!parsed.success) return null;
  const pods = (parsed.data as { perPod?: PodDatum[] }).perPod;
  return Array.isArray(pods) ? pods : [];
}

export interface CapacityPoint {
  concurrency: number;
  rps: number;
  e2eP95Ms: number;
}

/** Read guidellm capacityCurve from a run's summaryMetrics ({tool,data}).
 * Mirrors the client-side `client-metrics.ts#readCapacityCurve`. */
export interface EngineMetricValue {
  avg: number | null;
  peak: number | null;
  unit: string;
  /** Fraction (0..1) of the window at/above the saturation threshold, when the
   * metric defines one (e.g. KV cache ≥ 90%). Null/absent otherwise. */
  satFrac?: number | null;
}

/** Read one durable engine-metric scalar from serverMetrics.engineMetrics.
 * Mirrors the client's `client-metrics.ts#readEngineMetric`. */
export function readEngineMetric(serverMetrics: unknown, key: string): EngineMetricValue | null {
  const parsed = engineMetricsAnnotationSchema.safeParse(
    (serverMetrics as { engineMetrics?: unknown } | null)?.engineMetrics,
  );
  if (!parsed.success) return null;
  const m = parsed.data.metrics.find((x) => x.key === key);
  return m ? { avg: m.avg, peak: m.peak, unit: m.unit, satFrac: m.satFrac ?? null } : null;
}

/** refId → which engine metric + scalar to plot. Mirrors the client constant. */
export const ENGINE_BAR_FIGURES: Record<
  "stage-bars-kv-cache" | "stage-bars-preemption" | "stage-bars-queue",
  { metricKey: string; pick: "avg" | "peak" }
> = {
  "stage-bars-kv-cache": { metricKey: "kv_cache_usage", pick: "peak" },
  "stage-bars-preemption": { metricKey: "preemption_rate", pick: "avg" },
  "stage-bars-queue": { metricKey: "request_queue_time", pick: "peak" },
};

export function readCapacityCurve(summaryMetrics: unknown): CapacityPoint[] | null {
  const m = summaryMetrics as { data?: { capacityCurve?: CapacityPoint[] } } | null;
  const c = m?.data?.capacityCurve;
  return Array.isArray(c) && c.length > 0 ? c : null;
}

/** One run's two metric blobs. summaryMetrics = tool report (throughput/latency);
 * serverMetrics = prefix-cache annotation. */
export interface RunMetricBlobs {
  summaryMetrics: unknown;
  serverMetrics?: unknown;
  /** True when the run carries pre-computed latency CDF samples (guidellm/vegeta). */
  hasLatencyCdf?: boolean;
}

/**
 * Server-side mirror of `apps/web/src/features/benchmarks/compare/client-metrics.ts#availableFigureRefIds`.
 * Returns the figure `refId`s that can render against the given runs.
 * The prompt sends this set to the LLM so it doesn't pick a refId for which
 * the data is not there (e.g. asking for ttft from vegeta gateway runs).
 */
export function availableFigureRefIds(runs: RunMetricBlobs[]): Set<FigureRefId> {
  const out = new Set<FigureRefId>();
  if (runs.length === 0) return out;
  const perRun = runs.map((r) => summarizeForPrompt(r.summaryMetrics));
  if (perRun.some((s) => s.throughput !== null)) out.add("stage-bars-throughput");
  if (perRun.some((s) => s.errorRate !== null)) out.add("stage-bars-error-rate");
  if (perRun.every((s) => s.ttft !== null)) out.add("stage-bars-ttft-p95");
  if (perRun.every((s) => s.itl !== null)) out.add("stage-bars-tpot-p95");
  if (perRun.every((s) => s.e2e !== null)) out.add("stage-bars-e2e-p95");
  // cold-warm-delta: available whenever ≥2 runs carry throughput or ttft data.
  if (perRun.filter((s) => s.throughput !== null || s.ttft !== null).length >= 2) {
    out.add("cold-warm-delta");
  }
  // Prefix-cache figures need EVERY run to carry the annotation (complete bars).
  const pc = runs.map((r) => readPrefixCache(r.serverMetrics));
  if (pc.every((p) => p !== null)) {
    out.add("stage-bars-prefix-cache-hit");
    out.add("stage-bars-top-pod-share");
    // Pod-distribution figures: additionally require every run to carry a
    // non-empty perPod array (lb-strategy runs only).
    const pods = runs.map((r) => readPodDistribution(r.serverMetrics));
    if (pods.every((p) => p !== null && p.length > 0)) {
      out.add("pod-traffic-distribution");
      out.add("pod-hit-rate");
    }
  }
  // Engine-metrics figures need EVERY run to carry that durable scalar.
  for (const [refId, spec] of Object.entries(ENGINE_BAR_FIGURES)) {
    const present = runs.every((r) => {
      const m = readEngineMetric(r.serverMetrics, spec.metricKey);
      return m !== null && m[spec.pick] !== null;
    });
    if (present) out.add(refId as FigureRefId);
  }
  if (runs.some((r) => readCapacityCurve(r.summaryMetrics) !== null)) {
    out.add("throughput-vs-concurrency");
  }
  if (runs.length >= 2 && runs.every((r) => r.hasLatencyCdf)) {
    out.add("latency-distribution");
  }
  out.add("compare-grid");
  return out;
}
