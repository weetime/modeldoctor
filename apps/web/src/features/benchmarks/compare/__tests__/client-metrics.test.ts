import { describe, expect, it } from "vitest";
import { availableFigureRefIds, readPrefixCache } from "../client-metrics";

const summary = {
  tool: "aiperf",
  data: {
    ttft: { mean: 1, p50: 1, p90: 2, p95: 3, p99: 4 },
    e2eLatency: { mean: 1, p50: 1, p90: 2, p95: 3, p99: 4 },
    throughput: { requestsPerSec: 2.5 },
    requests: { total: 100, success: 100, error: 0, errorRate: 0 },
  },
};

const withPrefixCache = (hit: number, share: number) => ({
  prefixCache: {
    hitRatePct: hit,
    topPodSharePct: share,
    perPod: [{ pod: "p0", queries: 100, hits: hit }],
    metricTag: "v1" as const,
  },
});

describe("readPrefixCache", () => {
  it("parses a valid annotation", () => {
    expect(readPrefixCache(withPrefixCache(57.6, 18.9))).toEqual({
      hitRatePct: 57.6,
      topPodSharePct: 18.9,
    });
  });
  it("degrades to null for absent / malformed serverMetrics", () => {
    expect(readPrefixCache(null)).toBeNull();
    expect(readPrefixCache({})).toBeNull();
    expect(readPrefixCache({ prefixCache: { hitRatePct: "nope" } })).toBeNull();
  });
});

describe("availableFigureRefIds — prefix-cache figures", () => {
  it("adds prefix-cache refIds only when EVERY run carries the annotation", () => {
    const all = availableFigureRefIds([
      { summaryMetrics: summary, serverMetrics: withPrefixCache(30, 19) },
      { summaryMetrics: summary, serverMetrics: withPrefixCache(58, 19) },
    ]);
    expect(all.has("stage-bars-prefix-cache-hit")).toBe(true);
    expect(all.has("stage-bars-top-pod-share")).toBe(true);
  });

  it("omits prefix-cache refIds when any run lacks the annotation", () => {
    const mixed = availableFigureRefIds([
      { summaryMetrics: summary, serverMetrics: withPrefixCache(30, 19) },
      { summaryMetrics: summary, serverMetrics: null },
    ]);
    expect(mixed.has("stage-bars-prefix-cache-hit")).toBe(false);
    expect(mixed.has("stage-bars-top-pod-share")).toBe(false);
    // non-prefix-cache figures still resolve from summaryMetrics
    expect(mixed.has("stage-bars-throughput")).toBe(true);
    expect(mixed.has("stage-bars-ttft-p95")).toBe(true);
  });
});
