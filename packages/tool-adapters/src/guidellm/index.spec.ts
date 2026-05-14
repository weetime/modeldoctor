import { describe, expect, it } from "vitest";
import { guidellmAdapter } from "./index.js";

// Sample mirrors guidellmReportSchema (see ./schema.ts). Each distribution
// (ttft/itl/e2eLatency) carries mean/p50/p90/p95/p99 in milliseconds.
const sample: Record<string, unknown> = {
  ttft: { mean: 100, p50: 80, p90: 150, p95: 200, p99: 300 },
  itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
  e2eLatency: { mean: 1000, p50: 900, p90: 1400, p95: 1600, p99: 2000 },
  requestsPerSecond: { mean: 8 },
  outputTokensPerSecond: { mean: 1200 },
  inputTokensPerSecond: { mean: 800 },
  totalTokensPerSecond: { mean: 2000 },
  concurrency: { mean: 5, max: 8 },
  requests: { total: 100, success: 95, error: 5, incomplete: 0 },
};

describe("guidellmAdapter.readMetric", () => {
  it("ttft.p50", () => {
    expect(guidellmAdapter.readMetric("ttft.p50", sample)).toBe(80);
  });
  it("ttft.p90", () => {
    expect(guidellmAdapter.readMetric("ttft.p90", sample)).toBe(150);
  });
  it("ttft.p95", () => {
    expect(guidellmAdapter.readMetric("ttft.p95", sample)).toBe(200);
  });
  it("ttft.p99", () => {
    expect(guidellmAdapter.readMetric("ttft.p99", sample)).toBe(300);
  });
  it("itl.p50", () => {
    expect(guidellmAdapter.readMetric("itl.p50", sample)).toBe(28);
  });
  it("itl.p95", () => {
    expect(guidellmAdapter.readMetric("itl.p95", sample)).toBe(45);
  });
  it("e2e.p50", () => {
    expect(guidellmAdapter.readMetric("e2e.p50", sample)).toBe(900);
  });
  it("e2e.p90", () => {
    expect(guidellmAdapter.readMetric("e2e.p90", sample)).toBe(1400);
  });
  it("e2e.p95", () => {
    expect(guidellmAdapter.readMetric("e2e.p95", sample)).toBe(1600);
  });
  it("e2e.p99", () => {
    expect(guidellmAdapter.readMetric("e2e.p99", sample)).toBe(2000);
  });
  it("errorRate (computed from requests.error / requests.total)", () => {
    expect(guidellmAdapter.readMetric("errorRate", sample)).toBeCloseTo(0.05);
  });
  it("requestsPerSec", () => {
    expect(guidellmAdapter.readMetric("requestsPerSec", sample)).toBe(8);
  });
  it("outputTokensPerSec", () => {
    expect(guidellmAdapter.readMetric("outputTokensPerSec", sample)).toBe(1200);
  });
  it("tailRatio (e2e p99/p50)", () => {
    expect(guidellmAdapter.readMetric("tailRatio", sample)).toBeCloseTo(2000 / 900, 4);
  });
  it("null on missing data", () => {
    expect(guidellmAdapter.readMetric("ttft.p95", {})).toBeNull();
    expect(guidellmAdapter.readMetric("e2e.p99", {})).toBeNull();
    expect(guidellmAdapter.readMetric("requestsPerSec", {})).toBeNull();
  });
  it("errorRate returns null when requests.total is zero", () => {
    expect(
      guidellmAdapter.readMetric("errorRate", {
        requests: { total: 0, error: 0, success: 0, incomplete: 0 },
      }),
    ).toBeNull();
  });
});
