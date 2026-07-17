import type { MetricKind } from "../core/metric-extractor.js";

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const dist = (data: Record<string, unknown>, key: string, field: string): number | null => {
  const d = data[key] as Record<string, unknown> | undefined;
  return fin(d?.[field]);
};

export function vegetaReadMetric(kind: MetricKind, data: Record<string, unknown>): number | null {
  switch (kind) {
    // vegeta is generic HTTP — no token-level instrumentation.
    case "ttft.p50":
    case "ttft.p90":
    case "ttft.p95":
    case "ttft.p99":
    case "itl.p50":
    case "itl.p95":
    case "outputTokensPerSec":
      return null;
    case "e2e.p50":
      return dist(data, "latencies", "p50");
    case "e2e.p90":
      return dist(data, "latencies", "p90");
    case "e2e.p95":
      return dist(data, "latencies", "p95");
    case "e2e.p99":
      return dist(data, "latencies", "p99");
    case "errorRate": {
      // `data.success` is a 0-100 percentage in vegeta's normalized schema.
      const success = fin(data.success);
      return success === null ? null : 1 - success / 100;
    }
    case "requestsPerSec": {
      const r = data.requests as { throughput?: number } | undefined;
      return fin(r?.throughput);
    }
    case "tailRatio": {
      const p50 = dist(data, "latencies", "p50");
      const p99 = dist(data, "latencies", "p99");
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
