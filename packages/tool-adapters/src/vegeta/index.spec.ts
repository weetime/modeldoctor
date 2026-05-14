import { describe, expect, it } from "vitest";
import { vegetaAdapter } from "./index.js";

// Sample mirrors vegetaReportSchema (see ./schema.ts). All latencies in ms.
// `success` is a 0-100 percent (vegeta CLI semantics), NOT a 0-1 ratio.
const sample: Record<string, unknown> = {
  requests: { total: 300, rate: 10, throughput: 9.8 },
  duration: { totalSeconds: 30, attackSeconds: 30, waitSeconds: 0 },
  latencies: { min: 50, mean: 200, p50: 180, p90: 350, p95: 400, p99: 800, max: 1200 },
  bytesIn: { total: 0, mean: 0 },
  bytesOut: { total: 0, mean: 0 },
  success: 98, // 98% success → errorRate 0.02
  statusCodes: { "200": 294, "500": 6 },
  errors: [],
};

describe("vegetaAdapter.readMetric", () => {
  it("ttft.p95 returns null (vegeta has no token semantics)", () => {
    expect(vegetaAdapter.readMetric("ttft.p95", sample)).toBeNull();
  });
  it("ttft.p99 returns null", () => {
    expect(vegetaAdapter.readMetric("ttft.p99", sample)).toBeNull();
  });
  it("itl.p95 returns null", () => {
    expect(vegetaAdapter.readMetric("itl.p95", sample)).toBeNull();
  });
  it("e2e.p95 (latencies.p95)", () => {
    expect(vegetaAdapter.readMetric("e2e.p95", sample)).toBe(400);
  });
  it("e2e.p99 (latencies.p99)", () => {
    expect(vegetaAdapter.readMetric("e2e.p99", sample)).toBe(800);
  });
  it("errorRate (1 - success/100)", () => {
    expect(vegetaAdapter.readMetric("errorRate", sample)).toBeCloseTo(0.02, 4);
  });
  it("requestsPerSec (requests.throughput)", () => {
    expect(vegetaAdapter.readMetric("requestsPerSec", sample)).toBe(9.8);
  });
  it("outputTokensPerSec returns null", () => {
    expect(vegetaAdapter.readMetric("outputTokensPerSec", sample)).toBeNull();
  });
  it("tailRatio (latencies p99/p50)", () => {
    expect(vegetaAdapter.readMetric("tailRatio", sample)).toBeCloseTo(800 / 180, 4);
  });
  it("null on missing data", () => {
    expect(vegetaAdapter.readMetric("e2e.p95", {})).toBeNull();
    expect(vegetaAdapter.readMetric("errorRate", {})).toBeNull();
    expect(vegetaAdapter.readMetric("requestsPerSec", {})).toBeNull();
  });
});
