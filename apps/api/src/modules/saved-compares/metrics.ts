import type { FigureRefId } from "@modeldoctor/contracts";
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
 * Server-side mirror of `apps/web/src/features/benchmarks/compare/client-metrics.ts#availableFigureRefIds`.
 * Returns the figure `refId`s that can render against the given summaries.
 * The prompt sends this set to the LLM so it doesn't pick a refId for which
 * the data is not there (e.g. asking for ttft from vegeta gateway runs).
 */
export function availableFigureRefIds(summaries: unknown[]): Set<FigureRefId> {
  const out = new Set<FigureRefId>();
  if (summaries.length === 0) return out;
  const perRun = summaries.map((m) => summarizeForPrompt(m));
  if (perRun.some((s) => s.throughput !== null)) out.add("stage-bars-throughput");
  if (perRun.some((s) => s.errorRate !== null)) out.add("stage-bars-error-rate");
  if (perRun.every((s) => s.ttft !== null)) out.add("stage-bars-ttft-p95");
  if (perRun.every((s) => s.e2e !== null)) out.add("stage-bars-e2e-p95");
  out.add("compare-grid");
  return out;
}
