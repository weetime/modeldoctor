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
