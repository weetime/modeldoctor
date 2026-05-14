import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
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
