type MetricsBlob = { tool?: string; data?: Record<string, any> } | null | undefined;

function fromDist(m: MetricsBlob, key: string, field: string): number | null {
  const v = m?.data?.[key]?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function extractMetric(m: MetricsBlob, checkId: string): number | null {
  if (!m?.tool || !m?.data) return null;
  switch (checkId) {
    case "inference.ttft.p95.ms":
      if (m.tool === "guidellm") return fromDist(m, "ttft", "p95");
      if (m.tool === "genai-perf") return fromDist(m, "timeToFirstToken", "p95");
      return null;
    case "inference.ttft.p99.ms":
      if (m.tool === "guidellm") return fromDist(m, "ttft", "p99");
      if (m.tool === "genai-perf") return fromDist(m, "timeToFirstToken", "p99");
      return null;
    case "inference.itl.p95.ms":
      if (m.tool === "guidellm") return fromDist(m, "itl", "p95");
      return null;
    case "inference.e2e.p95.ms":
      if (m.tool === "guidellm") return fromDist(m, "e2eLatency", "p95");
      if (m.tool === "vegeta") return fromDist(m, "latencies", "p95");
      if (m.tool === "genai-perf") return fromDist(m, "requestLatency", "p95");
      return null;
    case "inference.e2e.p99.ms":
      if (m.tool === "guidellm") return fromDist(m, "e2eLatency", "p99");
      if (m.tool === "vegeta") return fromDist(m, "latencies", "p99");
      if (m.tool === "genai-perf") return fromDist(m, "requestLatency", "p99");
      return null;
    case "inference.error_rate":
    case "capacity.error_rate":
    case "gateway.error_rate":
      if (m.tool === "guidellm") {
        const r = m.data.requests as { total?: number; error?: number } | undefined;
        const t = r?.total;
        const e = r?.error;
        if (typeof t !== "number" || typeof e !== "number" || t === 0) return null;
        return e / t;
      }
      if (m.tool === "vegeta") {
        const s = m.data.success;
        return typeof s === "number" ? 1 - s / 100 : null;
      }
      return null;
    case "inference.throughput.req_per_s":
    case "capacity.max_qps":
    case "gateway.throughput.req_per_s": {
      if (m.tool === "guidellm") return m.data.requestsPerSecond?.mean ?? null;
      if (m.tool === "vegeta") return m.data.requests?.throughput ?? null;
      if (m.tool === "genai-perf") return m.data.requestThroughput?.avg ?? null;
      return null;
    }
    case "capacity.tail_ratio":
    case "gateway.tail_ratio": {
      let p50: number | null = null;
      let p99: number | null = null;
      if (m.tool === "guidellm") {
        p50 = m.data.e2eLatency?.p50 ?? null;
        p99 = m.data.e2eLatency?.p99 ?? null;
      }
      if (m.tool === "vegeta") {
        p50 = m.data.latencies?.p50 ?? null;
        p99 = m.data.latencies?.p99 ?? null;
      }
      if (m.tool === "genai-perf") {
        p50 = m.data.requestLatency?.p50 ?? null;
        p99 = m.data.requestLatency?.p99 ?? null;
      }
      if (typeof p50 !== "number" || typeof p99 !== "number" || p50 <= 0) return null;
      return p99 / p50;
    }
  }
  return null;
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
