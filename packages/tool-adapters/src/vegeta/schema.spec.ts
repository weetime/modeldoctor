import { describe, expect, it } from "vitest";
import { vegetaParamDefaults, vegetaParamsSchema, vegetaReportSchema } from "./schema.js";

describe("vegetaParamsSchema", () => {
  it("rejects rate=0", () => {
    const r = vegetaParamsSchema.safeParse({ apiType: "chat", rate: 0, duration: 30 });
    expect(r.success).toBe(false);
  });

  it("rejects duration > 3600", () => {
    const r = vegetaParamsSchema.safeParse({ apiType: "chat", rate: 10, duration: 3601 });
    expect(r.success).toBe(false);
  });

  it("accepts a typical config", () => {
    const r = vegetaParamsSchema.safeParse({ apiType: "chat", rate: 10, duration: 60 });
    expect(r.success).toBe(true);
  });

  // M3: paramDefaults real roundtrip test
  it("paramDefaults parses cleanly and preserves default values", () => {
    // vegeta defaults are intentionally complete: apiType + rate + duration
    // covers every required field, so no FE-side gap-filling is needed
    // (unlike guidellm random-dataset which still requires datasetInputTokens
    // and datasetOutputTokens). Spread is kept for symmetry with the guidellm
    // spec's roundtrip pattern.
    const merged = { ...vegetaParamDefaults };
    const r = vegetaParamsSchema.safeParse(merged);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.apiType).toBe("chat");
      expect(r.data.rate).toBe(10);
      expect(r.data.duration).toBe(30);
    }
  });
});

describe("vegetaReportSchema", () => {
  it("requires latency distribution", () => {
    const r = vegetaReportSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts a typical vegeta report shape", () => {
    const r = vegetaReportSchema.safeParse({
      requests: { total: 100, rate: 10, throughput: 9.5 },
      duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
      latencies: { min: 1, mean: 5, p50: 4, p90: 9, p95: 12, p99: 18, max: 24 },
      bytesIn: { total: 1024, mean: 10.24 },
      bytesOut: { total: 512, mean: 5.12 },
      success: 100,
      statusCodes: { "200": 100 },
      errors: [],
    });
    expect(r.success).toBe(true);
  });

  // gemini Item 2: requests nonnegative
  it("rejects requests.rate = -1", () => {
    const r = vegetaReportSchema.safeParse({
      requests: { total: 100, rate: -1, throughput: 9.5 },
      duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
      latencies: { min: 1, mean: 5, p50: 4, p90: 9, p95: 12, p99: 18, max: 24 },
      bytesIn: { total: 1024, mean: 10.24 },
      bytesOut: { total: 512, mean: 5.12 },
      success: 100,
      statusCodes: { "200": 100 },
      errors: [],
    });
    expect(r.success).toBe(false);
  });

  // gemini Item 3: success bounded percent
  it("rejects success = -1 (below 0)", () => {
    const r = vegetaReportSchema.safeParse({
      requests: { total: 100, rate: 10, throughput: 9.5 },
      duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
      latencies: { min: 1, mean: 5, p50: 4, p90: 9, p95: 12, p99: 18, max: 24 },
      bytesIn: { total: 1024, mean: 10.24 },
      bytesOut: { total: 512, mean: 5.12 },
      success: -1,
      statusCodes: { "200": 100 },
      errors: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects success = 101 (above 100)", () => {
    const r = vegetaReportSchema.safeParse({
      requests: { total: 100, rate: 10, throughput: 9.5 },
      duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
      latencies: { min: 1, mean: 5, p50: 4, p90: 9, p95: 12, p99: 18, max: 24 },
      bytesIn: { total: 1024, mean: 10.24 },
      bytesOut: { total: 512, mean: 5.12 },
      success: 101,
      statusCodes: { "200": 100 },
      errors: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts success = 0 (boundary)", () => {
    const r = vegetaReportSchema.safeParse({
      requests: { total: 100, rate: 10, throughput: 9.5 },
      duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
      latencies: { min: 1, mean: 5, p50: 4, p90: 9, p95: 12, p99: 18, max: 24 },
      bytesIn: { total: 1024, mean: 10.24 },
      bytesOut: { total: 512, mean: 5.12 },
      success: 0,
      statusCodes: { "200": 100 },
      errors: [],
    });
    expect(r.success).toBe(true);
  });

  it("accepts success = 100 (boundary)", () => {
    const r = vegetaReportSchema.safeParse({
      requests: { total: 100, rate: 10, throughput: 9.5 },
      duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
      latencies: { min: 1, mean: 5, p50: 4, p90: 9, p95: 12, p99: 18, max: 24 },
      bytesIn: { total: 1024, mean: 10.24 },
      bytesOut: { total: 512, mean: 5.12 },
      success: 100,
      statusCodes: { "200": 100 },
      errors: [],
    });
    expect(r.success).toBe(true);
  });
});
