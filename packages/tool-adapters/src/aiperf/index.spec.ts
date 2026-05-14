import { describe, expect, it } from "vitest";
import { aiperfAdapter } from "./index.js";

// Sample mirrors aiperfReportSchema (see ./schema.ts).
// Same shape as evalscope minus prefixCacheStats — they share the
// "inference-three-piece" report shape so FE can render with one grid.
const sample: Record<string, unknown> = {
  throughput: { requestsPerSec: 6.5, outputTokensPerSec: 950, totalTokensPerSec: 1300 },
  ttft: { mean: 120, p50: 100, p90: 180, p95: 220, p99: 320 },
  itl: { mean: 32, p50: 30, p90: 42, p95: 48, p99: 62 },
  e2eLatency: { mean: 1100, p50: 1000, p90: 1500, p95: 1700, p99: 2200 },
  requests: { total: 100, success: 97, error: 3, errorRate: 0.03 },
};

describe("aiperfAdapter.readMetric", () => {
  it("ttft.p95", () => {
    expect(aiperfAdapter.readMetric("ttft.p95", sample)).toBe(220);
  });
  it("ttft.p99", () => {
    expect(aiperfAdapter.readMetric("ttft.p99", sample)).toBe(320);
  });
  it("itl.p95", () => {
    expect(aiperfAdapter.readMetric("itl.p95", sample)).toBe(48);
  });
  it("e2e.p95", () => {
    expect(aiperfAdapter.readMetric("e2e.p95", sample)).toBe(1700);
  });
  it("e2e.p99", () => {
    expect(aiperfAdapter.readMetric("e2e.p99", sample)).toBe(2200);
  });
  it("errorRate (already 0-1)", () => {
    expect(aiperfAdapter.readMetric("errorRate", sample)).toBe(0.03);
  });
  it("requestsPerSec", () => {
    expect(aiperfAdapter.readMetric("requestsPerSec", sample)).toBe(6.5);
  });
  it("outputTokensPerSec", () => {
    expect(aiperfAdapter.readMetric("outputTokensPerSec", sample)).toBe(950);
  });
  it("tailRatio (e2e p99/p50)", () => {
    expect(aiperfAdapter.readMetric("tailRatio", sample)).toBeCloseTo(2200 / 1000, 4);
  });
  it("null on missing data", () => {
    expect(aiperfAdapter.readMetric("ttft.p95", {})).toBeNull();
    expect(aiperfAdapter.readMetric("errorRate", {})).toBeNull();
    expect(aiperfAdapter.readMetric("tailRatio", {})).toBeNull();
  });
});
