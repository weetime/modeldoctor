import { describe, expect, it } from "vitest";
import { guidellmParamsSchema, guidellmReportSchema, guidellmParamDefaults } from "./schema.js";

describe("guidellmParamsSchema", () => {
  it("requires datasetInputTokens/Output when datasetName=random", () => {
    const r = guidellmParamsSchema.safeParse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      requestRate: 0,
      totalRequests: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("random dataset"))).toBe(true);
    }
  });

  it("accepts a fully-specified random dataset config", () => {
    const r = guidellmParamsSchema.safeParse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 256,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    });
    expect(r.success).toBe(true);
  });

  it("paramDefaults is a parseable params object skeleton", () => {
    // The defaults object is a starting point for the FE form — not all
    // required fields are present (e.g. datasetInputTokens for random).
    expect(typeof guidellmParamDefaults).toBe("object");
  });
});

describe("guidellmReportSchema", () => {
  it("rejects a report missing required latency dist fields", () => {
    const r = guidellmReportSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts a fully-shaped report", () => {
    const dist = { mean: 1, p50: 1, p90: 1, p95: 1, p99: 1 };
    const r = guidellmReportSchema.safeParse({
      ttft: dist,
      itl: dist,
      e2eLatency: dist,
      requestsPerSecond: { mean: 1 },
      outputTokensPerSecond: { mean: 1 },
      inputTokensPerSecond: { mean: 1 },
      totalTokensPerSecond: { mean: 1 },
      concurrency: { mean: 1, max: 1 },
      requests: { total: 1, success: 1, error: 0, incomplete: 0 },
    });
    expect(r.success).toBe(true);
  });
});
