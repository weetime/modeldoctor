import { describe, expect, it } from "vitest";
import { evalscopeParamsSchema, evalscopeReportSchema } from "./schema.js";

describe("evalscopeParamsSchema", () => {
  it("accepts the 2026-05-12 Task 4 high-pressure config", () => {
    const parsed = evalscopeParamsSchema.parse({
      parallel: 16,
      number: 128,
      dataset: "longalpaca",
      minPromptLength: 11000,
      maxPromptLength: 13000,
      minTokens: 300,
      maxTokens: 400,
      apiPath: "/v1/chat/completions",
      stream: true,
      seed: 42,
    });
    expect(parsed.parallel).toBe(16);
    expect(parsed.dataset).toBe("longalpaca");
  });

  it("rejects minPromptLength > maxPromptLength", () => {
    expect(() =>
      evalscopeParamsSchema.parse({
        parallel: 8,
        number: 64,
        dataset: "longalpaca",
        minPromptLength: 9000,
        maxPromptLength: 8000,
        minTokens: 100,
        maxTokens: 200,
        apiPath: "/v1/chat/completions",
        stream: true,
      }),
    ).toThrow(/minPromptLength/);
  });

  it("rejects minTokens > maxTokens", () => {
    expect(() =>
      evalscopeParamsSchema.parse({
        parallel: 8,
        number: 64,
        dataset: "longalpaca",
        minPromptLength: 8000,
        maxPromptLength: 9000,
        minTokens: 400,
        maxTokens: 200,
        apiPath: "/v1/chat/completions",
        stream: true,
      }),
    ).toThrow(/minTokens/);
  });

  it("applies sensible defaults when only required overrides are provided", () => {
    const parsed = evalscopeParamsSchema.parse({});
    expect(parsed.dataset).toBe("longalpaca");
    expect(parsed.apiPath).toBe("/v1/chat/completions");
    expect(parsed.stream).toBe(true);
  });
});

describe("evalscopeReportSchema", () => {
  it("accepts a minimal report shape", () => {
    const r = evalscopeReportSchema.parse({
      throughput: { requestsPerSec: 8.1, outputTokensPerSec: 1200, totalTokensPerSec: 1500 },
      ttft: { mean: 800, p50: 700, p90: 1200, p95: 1500, p99: 2000 },
      e2eLatency: { mean: 4000, p50: 3500, p90: 5500, p95: 6500, p99: 8000 },
      itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
      requests: { total: 128, success: 128, error: 0, errorRate: 0 },
    });
    expect(r.requests.success).toBe(128);
    expect(r.prefixCacheStats).toBeUndefined();
  });

  it("accepts optional prefixCacheStats", () => {
    const r = evalscopeReportSchema.parse({
      throughput: { requestsPerSec: 8.1, outputTokensPerSec: 1200, totalTokensPerSec: 1500 },
      ttft: { mean: 800, p50: 700, p90: 1200, p95: 1500, p99: 2000 },
      e2eLatency: { mean: 4000, p50: 3500, p90: 5500, p95: 6500, p99: 8000 },
      itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
      requests: { total: 128, success: 128, error: 0, errorRate: 0 },
      prefixCacheStats: { hitRate: 0.85, savings: 0.6 },
    });
    expect(r.prefixCacheStats?.hitRate).toBe(0.85);
  });
});
