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

export function readP95Latency(m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data) return null;
  switch (t.tool) {
    case "guidellm":
      return fromDist(t.data, "e2eLatency", "p95");
    case "vegeta":
      return fromDist(t.data, "latencies", "p95");
    default:
      return null;
  }
}

export function readErrorRate(m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data) return null;
  switch (t.tool) {
    case "guidellm": {
      const r = t.data.requests as { total?: number; error?: number } | undefined;
      const total = asFiniteNumber(r?.total);
      const error = asFiniteNumber(r?.error);
      if (total === null || error === null || total === 0) return null;
      return error / total;
    }
    case "vegeta": {
      const s = asFiniteNumber(t.data.success);
      return s === null ? null : 1 - s / 100;
    }
    default:
      return null;
  }
}

export function readThroughput(m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data) return null;
  switch (t.tool) {
    case "guidellm":
      return asFiniteNumber((t.data.requestsPerSecond as { mean?: number } | undefined)?.mean);
    case "vegeta":
      return asFiniteNumber((t.data.requests as { throughput?: number } | undefined)?.throughput);
    default:
      return null;
  }
}

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

export function summarizeForPrompt(m: unknown): PromptMetricsSummary {
  const t = asTagged(m);
  const tool = t?.tool;
  const ttftKey = tool === "guidellm" ? "ttft" : null;
  const e2eKey = tool === "guidellm" ? "e2eLatency" : tool === "vegeta" ? "latencies" : null;

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
