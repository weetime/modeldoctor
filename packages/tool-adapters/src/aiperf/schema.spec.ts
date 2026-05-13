import { describe, expect, it } from "vitest";
import { aiperfParamsSchema, aiperfReportSchema } from "./schema.js";

describe("aiperfParamsSchema", () => {
  it("accepts a typical baseline config", () => {
    const parsed = aiperfParamsSchema.parse({
      concurrency: 8,
      requestCount: 100,
      inputTokensMean: 1024,
      inputTokensStddev: 128,
      outputTokensMean: 256,
      outputTokensStddev: 64,
      endpointType: "chat",
      streaming: true,
      dataset: "synthetic",
      seed: 42,
    });
    expect(parsed.endpointType).toBe("chat");
    expect(parsed.dataset).toBe("synthetic");
  });

  it("applies sensible defaults when only required overrides are provided", () => {
    const parsed = aiperfParamsSchema.parse({});
    expect(parsed.endpointType).toBe("chat");
    expect(parsed.streaming).toBe(true);
    expect(parsed.dataset).toBe("synthetic");
    expect(parsed.concurrency).toBe(8);
  });

  it("rejects inputTokensMean=0 (must be positive)", () => {
    expect(() => aiperfParamsSchema.parse({ inputTokensMean: 0 })).toThrow();
  });

  it("rejects outputTokensMean above 4096", () => {
    expect(() => aiperfParamsSchema.parse({ outputTokensMean: 4097 })).toThrow();
  });

  it("rejects unknown endpoint types", () => {
    expect(() => aiperfParamsSchema.parse({ endpointType: "embeddings" })).toThrow();
  });

  it("rejects unknown public datasets", () => {
    expect(() => aiperfParamsSchema.parse({ dataset: "longalpaca" })).toThrow();
  });
});

describe("aiperfReportSchema", () => {
  it("accepts the general-perf-three-piece shape (throughput + ttft/e2e/itl + requests)", () => {
    const r = aiperfReportSchema.parse({
      throughput: { requestsPerSec: 5, outputTokensPerSec: 800, totalTokensPerSec: 1000 },
      ttft: { mean: 600, p50: 500, p90: 800, p95: 950, p99: 1200 },
      e2eLatency: { mean: 3000, p50: 2500, p90: 4500, p95: 5500, p99: 7000 },
      itl: { mean: 25, p50: 24, p90: 30, p95: 35, p99: 45 },
      requests: { total: 100, success: 100, error: 0, errorRate: 0 },
    });
    expect(r.requests.success).toBe(100);
    expect(r.throughput.outputTokensPerSec).toBe(800);
  });

  it("rejects errorRate > 1", () => {
    expect(() =>
      aiperfReportSchema.parse({
        throughput: { requestsPerSec: 5, outputTokensPerSec: 800, totalTokensPerSec: 1000 },
        ttft: { mean: 600, p50: 500, p90: 800, p95: 950, p99: 1200 },
        e2eLatency: { mean: 3000, p50: 2500, p90: 4500, p95: 5500, p99: 7000 },
        itl: { mean: 25, p50: 24, p90: 30, p95: 35, p99: 45 },
        requests: { total: 100, success: 100, error: 0, errorRate: 1.5 },
      }),
    ).toThrow();
  });
});
