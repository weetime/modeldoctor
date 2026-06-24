import {
  engineMetricsAnnotationSchema,
  type FigureRefId,
  prefixCacheAnnotationSchema,
} from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  // Inter-token latency (TPOT). ITL only exposes p50/p95 across tools.
  itl: { p50: number | null; p95: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

export interface PrefixCacheSummary {
  hitRatePct: number;
  topPodSharePct: number;
}

export interface CapacityPoint {
  concurrency: number;
  rps: number;
  e2eP95Ms: number;
}

/** Read guidellm capacityCurve from a run's summaryMetrics ({tool,data}).
 * Keep in sync with server mirror `apps/api/src/modules/saved-compares/metrics.ts#readCapacityCurve`. */
export function readCapacityCurve(summaryMetrics: unknown): CapacityPoint[] | null {
  const m = summaryMetrics as { data?: { capacityCurve?: CapacityPoint[] } } | null;
  const c = m?.data?.capacityCurve;
  return Array.isArray(c) && c.length > 0 ? c : null;
}

/** One run's two metric blobs — summaryMetrics (tool report) carries
 * throughput/latency; serverMetrics carries the prefix-cache annotation. */
export interface RunMetricBlobs {
  summaryMetrics: unknown;
  serverMetrics?: unknown;
  /** True when the run carries pre-computed latency CDF samples (guidellm/vegeta). */
  hasLatencyCdf?: boolean;
}

/**
 * Read the prefix-cache annotation from a run's `serverMetrics` blob (stored
 * at `serverMetrics.prefixCache` on completion of a lb-strategy
 * run). Returns null when absent or malformed — non-prefix-cache runs and
 * runs whose Prometheus snapshot found no data both degrade to null.
 */
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

export interface EngineMetricValue {
  avg: number | null;
  peak: number | null;
  unit: string;
}

/** Read one durable engine-metric scalar (avg + peak) from a run's
 * `serverMetrics.engineMetrics` snapshot. Null when absent/malformed or the
 * key wasn't captured. Mirrors the server's `metrics.ts#readEngineMetric`. */
export function readEngineMetric(serverMetrics: unknown, key: string): EngineMetricValue | null {
  const parsed = engineMetricsAnnotationSchema.safeParse(
    (serverMetrics as { engineMetrics?: unknown } | null)?.engineMetrics,
  );
  if (!parsed.success) return null;
  const m = parsed.data.metrics.find((x) => x.key === key);
  return m ? { avg: m.avg, peak: m.peak, unit: m.unit } : null;
}

/** The three engine-only cross-run bar figures: refId → which manifest metric +
 * which scalar to plot (peak for saturation gauges, avg for rates). ttft /
 * prefix-cache already have dedicated figures, so they are NOT duplicated here. */
export const ENGINE_BAR_FIGURES: Record<
  "stage-bars-kv-cache" | "stage-bars-preemption" | "stage-bars-queue",
  { metricKey: string; pick: "avg" | "peak" }
> = {
  "stage-bars-kv-cache": { metricKey: "kv_cache_usage", pick: "peak" },
  "stage-bars-preemption": { metricKey: "preemption_rate", pick: "avg" },
  "stage-bars-queue": { metricKey: "request_queue_time", pick: "peak" },
};

/**
 * Client-side mirror of `apps/api/src/modules/saved-compares/metrics.ts#summarizeForPrompt`.
 * Used by `StageBarChartsSection` to derive chart datasets from raw `summaryMetrics`
 * blobs without round-tripping through the server.
 *
 * All per-tool field-path logic lives in each adapter's `readMetric`; this
 * function just picks the right `MetricKind`s and delegates via the FE-safe
 * `readMetricSafe`. The `ttft` / `e2e` sub-objects collapse to null only when
 * every dist bucket is null (e.g. vegeta has no TTFT at all).
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

type MetricKindArg = Parameters<typeof readMetricSafe>[0];

/**
 * Read a latency distribution's percentiles directly from a run's
 * `summaryMetrics`, for the in-app live charts (which pick their own
 * percentiles independent of the AI-prompt `summarizeForPrompt` shape).
 * Returns null when the family carries no data for any requested percentile
 * (e.g. vegeta has no ttft/itl), so the caller can drop the chart.
 */
export function readLatencyPercentiles(
  summaryMetrics: unknown,
  family: "ttft" | "itl" | "e2e",
  percentiles: readonly string[],
): Record<string, number | null> | null {
  const summary = summaryMetrics as { tool?: unknown; data?: unknown } | null;
  const byP: Record<string, number | null> = {};
  let any = false;
  for (const p of percentiles) {
    const v = readMetricSafe(`${family}.${p}` as MetricKindArg, summary);
    byP[p] = v;
    if (v !== null) any = true;
  }
  return any ? byP : null;
}

/**
 * Given a set of per-run `summaryMetrics` blobs, return the set of figure
 * `refId`s that have enough data to render. The LLM and the React renderer
 * both consult this so:
 *   - the prompt can tell the model "don't pick the stage-bars-ttft-p95 refId
 *     because none of the runs carry a ttft distribution"
 *   - the renderer can fall back to a "data unavailable" placeholder if the
 *     LLM picked one anyway (recovery for old narratives, drift, etc.)
 *
 * Keep this in sync with the server's mirror in
 * `apps/api/src/modules/saved-compares/metrics.ts#availableFigureRefIds`.
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
  // Prefix-cache figures: require EVERY run to carry the annotation so the
  // bar chart is complete across stages (mixing some-with / some-without
  // would render misleading gaps).
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
  // Engine-metrics figures (durable serverMetrics.engineMetrics snapshot) —
  // each available only when EVERY run carries that scalar (mixed gaps would
  // render misleading bars). Mirror in the server's availableFigureRefIds.
  for (const [refId, spec] of Object.entries(ENGINE_BAR_FIGURES)) {
    const present = runs.every((r) => {
      const m = readEngineMetric(r.serverMetrics, spec.metricKey);
      return m !== null && m[spec.pick] !== null;
    });
    if (present) out.add(refId as FigureRefId);
  }
  // Capacity-curve figure — keep in sync with server mirror
  // `apps/api/src/modules/saved-compares/metrics.ts#availableFigureRefIds`.
  if (runs.some((r) => readCapacityCurve(r.summaryMetrics) !== null)) {
    out.add("throughput-vs-concurrency");
  }
  if (runs.length >= 2 && runs.every((r) => r.hasLatencyCdf)) {
    out.add("latency-distribution");
  }
  // compare-grid only needs any of throughput/err/ttft/e2e — always available
  // when there's at least one summary; degrades cell-by-cell.
  out.add("compare-grid");
  return out;
}
