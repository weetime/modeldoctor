import { type MetricKind, type ToolName, byTool } from "@modeldoctor/tool-adapters";

type Tagged = { tool?: string; data?: Record<string, unknown> };

export function asTagged(m: unknown): Tagged | null {
  if (!m || typeof m !== "object") return null;
  const t = m as Tagged;
  return t.data ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fromDist(data: Record<string, unknown>, key: string, field: string): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  return asFiniteNumber(dist?.[field]);
}

function readByKind(kind: MetricKind, m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data || typeof t.tool !== "string") return null;
  try {
    return byTool(t.tool as ToolName).readMetric(kind, t.data);
  } catch {
    // byTool throws on unknown tool names; tolerate stale rows whose tool
    // is no longer registered (e.g. a Run from a deleted-tool migration).
    return null;
  }
}

export function readP95Latency(m: unknown): number | null {
  return readByKind("e2e.p95", m);
}

export function readErrorRate(m: unknown): number | null {
  return readByKind("errorRate", m);
}

export function readThroughput(m: unknown): number | null {
  return readByKind("requestsPerSec", m);
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
 * The scalar readers (throughput, errorRate) delegate to `adapter.readMetric`.
 * The p50/p90/p99 dist buckets need a per-tool field-path lookup because the
 * shared `MetricKind` enum exposes only p95/p99 percentiles — adding p50/p90
 * is a future Task 5 extension. Until then, the tool→dist-key resolution lives
 * inline; the table is intentionally tiny so future tool additions are obvious.
 */
const TTFT_DIST_KEY: Partial<Record<ToolName, string>> = {
  guidellm: "ttft",
  evalscope: "ttft",
  aiperf: "ttft",
  // vegeta is single-shot HTTP; no TTFT.
};
const E2E_DIST_KEY: Partial<Record<ToolName, string>> = {
  guidellm: "e2eLatency",
  evalscope: "e2eLatency",
  aiperf: "e2eLatency",
  vegeta: "latencies",
};

export function summarizeForPrompt(m: unknown): PromptMetricsSummary {
  const t = asTagged(m);
  const tool = t?.tool as ToolName | undefined;
  const ttftKey = tool ? TTFT_DIST_KEY[tool] : undefined;
  const e2eKey = tool ? E2E_DIST_KEY[tool] : undefined;

  return {
    throughput: readThroughput(m),
    errorRate: readErrorRate(m),
    ttft:
      t?.data && ttftKey
        ? {
            p50: fromDist(t.data, ttftKey, "p50"),
            p90: fromDist(t.data, ttftKey, "p90"),
            p99: fromDist(t.data, ttftKey, "p99"),
          }
        : null,
    e2e:
      t?.data && e2eKey
        ? {
            p50: fromDist(t.data, e2eKey, "p50"),
            p90: fromDist(t.data, e2eKey, "p90"),
            p99: fromDist(t.data, e2eKey, "p99"),
          }
        : null,
  };
}
