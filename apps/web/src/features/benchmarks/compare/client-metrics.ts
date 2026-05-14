type Tagged = { tool?: string; data?: Record<string, unknown> };

function asTagged(m: unknown): Tagged | null {
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

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

/**
 * Client-side mirror of `apps/api/src/modules/saved-compares/metrics.ts#summarizeForPrompt`.
 * Used by `StageBarChartsSection` to derive chart datasets from raw `summaryMetrics`
 * blobs without round-tripping through the server. Keep in sync with the server reader
 * — both sides must agree on tool-specific dist key mapping.
 */
export function summarizeForPrompt(m: unknown): PromptMetricsSummary {
  const t = asTagged(m);
  const tool = t?.tool;
  const ttftKey = tool === "guidellm" ? "ttft" : null;
  const e2eKey = tool === "guidellm" ? "e2eLatency" : tool === "vegeta" ? "latencies" : null;

  const throughput = !t?.data
    ? null
    : tool === "guidellm"
      ? asFiniteNumber((t.data.requestsPerSecond as { mean?: number } | undefined)?.mean)
      : tool === "vegeta"
        ? asFiniteNumber((t.data.requests as { throughput?: number } | undefined)?.throughput)
        : null;

  let errorRate: number | null = null;
  if (t?.data) {
    if (tool === "guidellm") {
      const r = t.data.requests as { total?: number; error?: number } | undefined;
      const total = asFiniteNumber(r?.total);
      const err = asFiniteNumber(r?.error);
      errorRate = total !== null && total > 0 && err !== null ? err / total : null;
    } else if (tool === "vegeta") {
      const s = asFiniteNumber(t.data.success);
      errorRate = s === null ? null : 1 - s / 100;
    }
  }

  return {
    throughput,
    errorRate,
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
