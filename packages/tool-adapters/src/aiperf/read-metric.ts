import type { MetricKind } from "../core/metric-extractor.js";

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const dist = (data: Record<string, unknown>, key: string, field: string): number | null => {
  const d = data[key] as Record<string, unknown> | undefined;
  return fin(d?.[field]);
};

export function aiperfReadMetric(kind: MetricKind, data: Record<string, unknown>): number | null {
  switch (kind) {
    case "ttft.p50":
      return dist(data, "ttft", "p50");
    case "ttft.p90":
      return dist(data, "ttft", "p90");
    case "ttft.p95":
      return dist(data, "ttft", "p95");
    case "ttft.p99":
      return dist(data, "ttft", "p99");
    case "itl.p50":
      return dist(data, "itl", "p50");
    case "itl.p95":
      return dist(data, "itl", "p95");
    case "e2e.p50":
      return dist(data, "e2eLatency", "p50");
    case "e2e.p90":
      return dist(data, "e2eLatency", "p90");
    case "e2e.p95":
      return dist(data, "e2eLatency", "p95");
    case "e2e.p99":
      return dist(data, "e2eLatency", "p99");
    case "errorRate": {
      // aiperf's normalized schema already exposes errorRate as 0-1.
      const r = data.requests as { errorRate?: number } | undefined;
      return fin(r?.errorRate);
    }
    case "requestsPerSec": {
      const t = data.throughput as { requestsPerSec?: number } | undefined;
      return fin(t?.requestsPerSec);
    }
    case "outputTokensPerSec": {
      const t = data.throughput as { outputTokensPerSec?: number } | undefined;
      return fin(t?.outputTokensPerSec);
    }
    case "tailRatio": {
      const p50 = dist(data, "e2eLatency", "p50");
      const p99 = dist(data, "e2eLatency", "p99");
      return p50 === null || p99 === null || p50 === 0 ? null : p99 / p50;
    }
    // Omni-only kinds — 本工具不产出。
    case "realtimeCeiling":
    case "audioTtfpC1.mean":
    case "audioTtfpPeak.p50":
    case "audioTtfpPeak.p99":
    case "audioRtfPeak.mean":
    case "audioRtfPeak.p50":
    case "audioRtfPeak.p99":
    case "voiceTax.ms":
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}
