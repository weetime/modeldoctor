import { describe, expect, it } from "vitest";
import type { MetricKind } from "../core/interface.js";
import { prefixCacheProbeAdapter } from "./index.js";

// prefix-cache-probe is a routing-stickiness diagnostic and carries NONE
// of the load-generator inference metrics. Every MetricKind must return
// null regardless of input.
const allKinds: readonly MetricKind[] = [
  "ttft.p50",
  "ttft.p90",
  "ttft.p95",
  "ttft.p99",
  "itl.p50",
  "itl.p95",
  "e2e.p50",
  "e2e.p90",
  "e2e.p95",
  "e2e.p99",
  "errorRate",
  "requestsPerSec",
  "outputTokensPerSec",
  "tailRatio",
];

describe("prefixCacheProbeAdapter.readMetric", () => {
  it("returns null for every MetricKind (no inference metrics)", () => {
    // Even with a fully populated synthetic payload that resembles other
    // tools' reports, prefix-cache-probe MUST refuse to surface these
    // metrics — its semantics are pod-stickiness, not throughput.
    const fakeFull: Record<string, unknown> = {
      ttft: { p95: 100, p99: 200 },
      itl: { p95: 30 },
      e2eLatency: { p50: 800, p95: 1000, p99: 1500 },
      latencies: { p50: 800, p95: 1000, p99: 1500 },
      requests: { total: 100, error: 5, errorRate: 0.05 },
      requestsPerSecond: { mean: 10 },
      throughput: { requestsPerSec: 10, outputTokensPerSec: 500 },
      success: 95,
    };
    for (const kind of allKinds) {
      expect(prefixCacheProbeAdapter.readMetric(kind, fakeFull)).toBeNull();
      expect(prefixCacheProbeAdapter.readMetric(kind, {})).toBeNull();
    }
  });
});
