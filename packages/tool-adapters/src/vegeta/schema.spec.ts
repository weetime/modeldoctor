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

  it("paramDefaults is a parseable starter", () => {
    expect(typeof vegetaParamDefaults).toBe("object");
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
});
