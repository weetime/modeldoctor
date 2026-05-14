import { describe, expect, it } from "vitest";
import { evalscopeAdapter } from "./index.js";

// Sample mirrors evalscopeReportSchema (see ./schema.ts).
const sample: Record<string, unknown> = {
  throughput: { requestsPerSec: 8, outputTokensPerSec: 1200, totalTokensPerSec: 1500 },
  ttft: { mean: 100, p50: 80, p90: 150, p95: 200, p99: 300 },
  itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
  e2eLatency: { mean: 1000, p50: 900, p90: 1400, p95: 1600, p99: 2000 },
  requests: { total: 100, success: 95, error: 5, errorRate: 0.05 },
};

describe("evalscopeAdapter.readMetric", () => {
  it("ttft.p95", () => {
    expect(evalscopeAdapter.readMetric("ttft.p95", sample)).toBe(200);
  });
  it("ttft.p99", () => {
    expect(evalscopeAdapter.readMetric("ttft.p99", sample)).toBe(300);
  });
  it("itl.p95", () => {
    expect(evalscopeAdapter.readMetric("itl.p95", sample)).toBe(45);
  });
  it("e2e.p95", () => {
    expect(evalscopeAdapter.readMetric("e2e.p95", sample)).toBe(1600);
  });
  it("e2e.p99", () => {
    expect(evalscopeAdapter.readMetric("e2e.p99", sample)).toBe(2000);
  });
  it("errorRate (already 0-1)", () => {
    expect(evalscopeAdapter.readMetric("errorRate", sample)).toBe(0.05);
  });
  it("requestsPerSec", () => {
    expect(evalscopeAdapter.readMetric("requestsPerSec", sample)).toBe(8);
  });
  it("outputTokensPerSec", () => {
    expect(evalscopeAdapter.readMetric("outputTokensPerSec", sample)).toBe(1200);
  });
  it("tailRatio (e2e p99/p50)", () => {
    expect(evalscopeAdapter.readMetric("tailRatio", sample)).toBeCloseTo(2000 / 900, 4);
  });
  it("null on missing data", () => {
    expect(evalscopeAdapter.readMetric("ttft.p95", {})).toBeNull();
    expect(evalscopeAdapter.readMetric("requestsPerSec", {})).toBeNull();
    expect(evalscopeAdapter.readMetric("errorRate", {})).toBeNull();
    expect(evalscopeAdapter.readMetric("tailRatio", {})).toBeNull();
  });
});
