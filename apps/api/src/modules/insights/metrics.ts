import { type MetricKind, type ToolName, byTool } from "@modeldoctor/tool-adapters";

type MetricsBlob = { tool?: string; data?: Record<string, any> } | null | undefined;

/**
 * Check-id (used by ComparisonService.ALL_CHECK_IDS) → adapter MetricKind.
 * Multiple scenario-prefixed check ids can collapse to the same MetricKind —
 * e.g. inference / capacity / gateway error_rate all read the same field.
 * Anything not in this map (yet) returns null.
 */
const CHECK_ID_TO_METRIC_KIND: Record<string, MetricKind> = {
  "inference.ttft.p95.ms": "ttft.p95",
  "inference.ttft.p99.ms": "ttft.p99",
  "inference.itl.p95.ms": "itl.p95",
  "inference.e2e.p95.ms": "e2e.p95",
  "inference.e2e.p99.ms": "e2e.p99",
  "inference.error_rate": "errorRate",
  "capacity.error_rate": "errorRate",
  "gateway.error_rate": "errorRate",
  "inference.throughput.req_per_s": "requestsPerSec",
  "capacity.max_qps": "requestsPerSec",
  "gateway.throughput.req_per_s": "requestsPerSec",
  "capacity.tail_ratio": "tailRatio",
  "gateway.tail_ratio": "tailRatio",
};

export function extractMetric(m: MetricsBlob, checkId: string): number | null {
  if (!m?.tool || !m?.data) return null;
  const kind = CHECK_ID_TO_METRIC_KIND[checkId];
  if (!kind) return null;
  try {
    return byTool(m.tool as ToolName).readMetric(kind, m.data);
  } catch {
    // byTool throws on unknown tool names; tolerate stale rows whose tool
    // is no longer registered (e.g. a Run from a deleted-tool migration).
    return null;
  }
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor((p / 100) * s.length)));
  return s[idx];
}
