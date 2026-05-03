import { describe, expect, it } from "vitest";
import { guidellmParamDefaults, guidellmParamsSchema, guidellmReportSchema } from "./schema.js";

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

  // I2: processor min(1)
  it("rejects empty processor string", () => {
    const r = guidellmParamsSchema.safeParse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 256,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
      processor: "",
    });
    expect(r.success).toBe(false);
  });

  // I3: requestRate float support
  it("accepts fractional requestRate (0.5)", () => {
    const r = guidellmParamsSchema.safeParse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 256,
      datasetOutputTokens: 128,
      requestRate: 0.5,
      totalRequests: 1000,
    });
    expect(r.success).toBe(true);
  });

  // I4: superRefine path on missing datasetInputTokens
  it("attaches error path [datasetInputTokens] when missing for random dataset", () => {
    const r = guidellmParamsSchema.safeParse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("datasetInputTokens");
    }
  });

  // I4: superRefine path on missing datasetOutputTokens
  it("attaches error path [datasetOutputTokens] when missing for random dataset", () => {
    const r = guidellmParamsSchema.safeParse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 256,
      requestRate: 0,
      totalRequests: 1000,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("datasetOutputTokens");
    }
  });

  // M3: paramDefaults real roundtrip test
  it("paramDefaults merges with required gaps to produce a parseable config", () => {
    const merged = {
      ...guidellmParamDefaults,
      datasetInputTokens: 256,
      datasetOutputTokens: 128,
    };
    const r = guidellmParamsSchema.safeParse(merged);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.profile).toBe("throughput");
      expect(r.data.requestRate).toBe(0);
      expect(r.data.totalRequests).toBe(1000);
      expect(r.data.validateBackend).toBe(false);
    }
  });

  it("defaults validateBackend to false", () => {
    const result = guidellmParamsSchema.parse({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 128,
      datasetOutputTokens: 64,
    });
    expect(result.validateBackend).toBe(false);
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

  // gemini Item 1: requests counts nonnegative
  it("rejects requests.total = -1", () => {
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
      requests: { total: -1, success: 1, error: 0, incomplete: 0 },
    });
    expect(r.success).toBe(false);
  });
});
