import { type FigureRefId, prefixCacheAnnotationSchema } from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

export interface PrefixCacheSummary {
  hitRatePct: number;
  topPodSharePct: number;
}

/** One run's two metric blobs — summaryMetrics (tool report) carries
 * throughput/latency; serverMetrics carries the prefix-cache annotation. */
export interface RunMetricBlobs {
  summaryMetrics: unknown;
  serverMetrics?: unknown;
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

  return {
    throughput: readMetricSafe("requestsPerSec", summary),
    errorRate: readMetricSafe("errorRate", summary),
    ttft:
      ttftP50 === null && ttftP90 === null && ttftP99 === null
        ? null
        : { p50: ttftP50, p90: ttftP90, p99: ttftP99 },
    e2e:
      e2eP50 === null && e2eP90 === null && e2eP99 === null
        ? null
        : { p50: e2eP50, p90: e2eP90, p99: e2eP99 },
  };
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
  if (perRun.every((s) => s.e2e !== null)) out.add("stage-bars-e2e-p95");
  // Prefix-cache figures: require EVERY run to carry the annotation so the
  // bar chart is complete across stages (mixing some-with / some-without
  // would render misleading gaps).
  const pc = runs.map((r) => readPrefixCache(r.serverMetrics));
  if (pc.every((p) => p !== null)) {
    out.add("stage-bars-prefix-cache-hit");
    out.add("stage-bars-top-pod-share");
  }
  // compare-grid only needs any of throughput/err/ttft/e2e — always available
  // when there's at least one summary; degrades cell-by-cell.
  out.add("compare-grid");
  return out;
}
