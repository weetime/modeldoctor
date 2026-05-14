import type { MetricKind } from "../core/metric-extractor.js";

// prefix-cache-probe is a routing-stickiness diagnostic, NOT a load
// generator. None of the inference-shape MetricKinds apply, but we
// still keep an exhaustive switch so the next MetricKind added causes
// a type error here too (forcing a deliberate decision per tool).
export function prefixCacheProbeReadMetric(
  kind: MetricKind,
  _data: Record<string, unknown>,
): number | null {
  switch (kind) {
    case "ttft.p50":
    case "ttft.p90":
    case "ttft.p95":
    case "ttft.p99":
    case "itl.p50":
    case "itl.p95":
    case "e2e.p50":
    case "e2e.p90":
    case "e2e.p95":
    case "e2e.p99":
    case "errorRate":
    case "requestsPerSec":
    case "outputTokensPerSec":
    case "tailRatio":
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}
