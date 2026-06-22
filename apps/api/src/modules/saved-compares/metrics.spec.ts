import { describe, expect, it } from "vitest";
import {
  availableFigureRefIds,
  readErrorRate,
  readP95Latency,
  readPodDistribution,
  readThroughput,
  summarizeForPrompt,
} from "./metrics.js";

const withPods = {
  prefixCache: {
    hitRatePct: 50,
    topPodSharePct: 60,
    perPod: [
      { pod: "p1", queries: 600, hits: 300 },
      { pod: "p2", queries: 400, hits: 100 },
    ],
    metricTag: "v1",
  },
};

it("reads per-pod distribution", () => {
  expect(readPodDistribution(withPods)).toHaveLength(2);
});

it("offers pod figures when data supports", () => {
  const set = availableFigureRefIds([
    { summaryMetrics: null, serverMetrics: withPods },
    { summaryMetrics: null, serverMetrics: withPods },
  ]);
  expect(set.has("pod-traffic-distribution")).toBe(true);
  expect(set.has("pod-hit-rate")).toBe(true);
});

describe("metrics readers", () => {
  it("reads guidellm p95 latency from e2eLatency dist", () => {
    const m = { tool: "guidellm", data: { e2eLatency: { p95: 1234 } } };
    expect(readP95Latency(m)).toBe(1234);
  });

  it("reads vegeta error rate as 1 - success/100", () => {
    const m = { tool: "vegeta", data: { success: 91.3 } };
    const r = readErrorRate(m);
    if (r === null) throw new Error("readErrorRate should not return null");
    expect(r).toBeCloseTo(0.087, 4);
  });

  it("returns null when summary metrics missing", () => {
    expect(readP95Latency(null)).toBeNull();
    expect(readErrorRate({ tool: "guidellm" })).toBeNull();
    expect(readThroughput({ tool: "unknown", data: {} })).toBeNull();
  });

  it("summarizeForPrompt picks per-tool key fields", () => {
    const m = {
      tool: "guidellm",
      data: {
        ttft: { p50: 100, p90: 200, p99: 500 },
        e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
        requestsPerSecond: { mean: 3.75 },
        requests: { total: 1000, error: 0 },
      },
    };
    const out = summarizeForPrompt(m);
    expect(out).toMatchObject({
      throughput: 3.75,
      errorRate: 0,
      ttft: { p50: 100, p90: 200, p99: 500 },
      e2e: { p50: 800, p90: 1500, p99: 3000 },
    });
  });
});
