import { describe, expect, it } from "vitest";
import {
  BenchmarkApiTypeSchema,
  BenchmarkDatasetSchema,
  BenchmarkMetricsCallbackSchema,
  BenchmarkMetricsSummarySchema,
  BenchmarkProfileSchema,
  BenchmarkRunSchema,
  BenchmarkRunSummarySchema,
  BenchmarkStateCallbackSchema,
  BenchmarkStateSchema,
  CreateBenchmarkRequestSchema,
  ListBenchmarksQuerySchema,
  ListBenchmarksResponseSchema,
} from "./benchmark.js";

describe("benchmark contracts", () => {
  describe("enums", () => {
    it("BenchmarkApiTypeSchema accepts only chat/completion", () => {
      expect(BenchmarkApiTypeSchema.parse("chat")).toBe("chat");
      expect(BenchmarkApiTypeSchema.parse("completion")).toBe("completion");
      expect(() => BenchmarkApiTypeSchema.parse("embeddings")).toThrow();
    });

    it("BenchmarkProfileSchema includes all 5 named profiles plus custom", () => {
      for (const p of [
        "throughput",
        "latency",
        "long_context",
        "generation_heavy",
        "sharegpt",
        "custom",
      ]) {
        expect(BenchmarkProfileSchema.parse(p)).toBe(p);
      }
      expect(() => BenchmarkProfileSchema.parse("unknown")).toThrow();
    });

    it("BenchmarkDatasetSchema accepts random and sharegpt", () => {
      expect(BenchmarkDatasetSchema.parse("random")).toBe("random");
      expect(BenchmarkDatasetSchema.parse("sharegpt")).toBe("sharegpt");
      expect(() => BenchmarkDatasetSchema.parse("custom-set")).toThrow();
    });

    it("BenchmarkStateSchema includes the full lifecycle", () => {
      for (const s of ["pending", "submitted", "running", "completed", "failed", "canceled"]) {
        expect(BenchmarkStateSchema.parse(s)).toBe(s);
      }
      expect(() => BenchmarkStateSchema.parse("unknown")).toThrow();
    });
  });

  describe("CreateBenchmarkRequestSchema", () => {
    const valid = {
      connectionId: "conn_test_id",
      name: "throughput-baseline",
      profile: "throughput" as const,
      apiType: "chat" as const,
      datasetName: "random" as const,
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    };

    it("accepts a complete random-dataset request", () => {
      expect(() => CreateBenchmarkRequestSchema.parse(valid)).not.toThrow();
    });

    it("requires datasetInputTokens when datasetName is 'random'", () => {
      const { datasetInputTokens: _, ...rest } = valid;
      const result = CreateBenchmarkRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "datasetInputTokens")).toBe(true);
      }
    });

    it("requires datasetOutputTokens when datasetName is 'random'", () => {
      const { datasetOutputTokens: _, ...rest } = valid;
      const result = CreateBenchmarkRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "datasetOutputTokens")).toBe(true);
      }
    });

    it("rejects empty name", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, name: "" })).toThrow();
    });

    it("rejects name longer than 128 chars", () => {
      expect(() =>
        CreateBenchmarkRequestSchema.parse({ ...valid, name: "x".repeat(129) }),
      ).toThrow();
    });

    it("rejects negative requestRate", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, requestRate: -1 })).toThrow();
    });

    it("rejects totalRequests > 100000", () => {
      expect(() =>
        CreateBenchmarkRequestSchema.parse({ ...valid, totalRequests: 100_001 }),
      ).toThrow();
    });

    it("allows requestRate=0 (unlimited)", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, requestRate: 0 })).not.toThrow();
    });
  });

  describe("BenchmarkMetricsSummarySchema", () => {
    const validMetrics = {
      ttft: { mean: 120, p50: 110, p95: 200, p99: 320 },
      itl: { mean: 25, p50: 22, p95: 50, p99: 80 },
      e2eLatency: { mean: 1800, p50: 1700, p95: 2500, p99: 3200 },
      requestsPerSecond: { mean: 12.4 },
      outputTokensPerSecond: { mean: 1580 },
      inputTokensPerSecond: { mean: 12700 },
      totalTokensPerSecond: { mean: 14280 },
      concurrency: { mean: 8.2, max: 12 },
      requests: { total: 1000, success: 998, error: 1, incomplete: 1 },
    };

    it("accepts a fully-populated metrics summary", () => {
      expect(() => BenchmarkMetricsSummarySchema.parse(validMetrics)).not.toThrow();
    });

    it("rejects a missing ttft.p99", () => {
      const broken = { ...validMetrics, ttft: { mean: 120, p50: 110, p95: 200 } };
      expect(() => BenchmarkMetricsSummarySchema.parse(broken)).toThrow();
    });
  });

  describe("BenchmarkRunSummarySchema and BenchmarkRunSchema", () => {
    const summary = {
      id: "ckxxx",
      userId: "uxxx",
      connectionId: "conn-1",
      name: "run-1",
      profile: "throughput" as const,
      apiType: "chat" as const,
      apiBaseUrl: "http://vllm:8000",
      model: "facebook/opt-125m",
      datasetName: "random" as const,
      state: "completed" as const,
      progress: 1,
      metricsSummary: null,
      createdAt: "2026-04-25T00:00:00.000Z",
      startedAt: "2026-04-25T00:00:01.000Z",
      completedAt: "2026-04-25T00:05:00.000Z",
    };

    it("BenchmarkRunSummarySchema accepts a minimal completed summary", () => {
      expect(() => BenchmarkRunSummarySchema.parse(summary)).not.toThrow();
    });

    it("BenchmarkRunSchema requires the full set of fields", () => {
      const full = {
        ...summary,
        description: null,
        datasetInputTokens: 1024,
        datasetOutputTokens: 128,
        datasetSeed: null,
        requestRate: 0,
        totalRequests: 1000,
        stateMessage: null,
        jobName: "benchmark-ckxxx",
        rawMetrics: null,
        logs: null,
      };
      expect(() => BenchmarkRunSchema.parse(full)).not.toThrow();
    });
  });

  describe("ListBenchmarksQuerySchema", () => {
    it("applies the default limit", () => {
      const q = ListBenchmarksQuerySchema.parse({});
      expect(q.limit).toBe(20);
    });

    it("coerces limit from a string", () => {
      const q = ListBenchmarksQuerySchema.parse({ limit: "50" });
      expect(q.limit).toBe(50);
    });

    it("rejects limit > 100", () => {
      expect(() => ListBenchmarksQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it("accepts a state filter", () => {
      const q = ListBenchmarksQuerySchema.parse({ state: "running" });
      expect(q.state).toBe("running");
    });

    it("rejects an unknown state filter", () => {
      expect(() => ListBenchmarksQuerySchema.parse({ state: "weird" })).toThrow();
    });
  });

  describe("ListBenchmarksResponseSchema", () => {
    it("accepts an empty list with null cursor", () => {
      expect(() =>
        ListBenchmarksResponseSchema.parse({ items: [], nextCursor: null }),
      ).not.toThrow();
    });
  });

  describe("internal callback schemas", () => {
    it("BenchmarkStateCallbackSchema accepts running with no extras", () => {
      const cb = BenchmarkStateCallbackSchema.parse({ state: "running" });
      expect(cb.state).toBe("running");
    });

    it("BenchmarkStateCallbackSchema rejects progress > 1", () => {
      expect(() =>
        BenchmarkStateCallbackSchema.parse({ state: "running", progress: 1.5 }),
      ).toThrow();
    });

    it("BenchmarkMetricsCallbackSchema requires metricsSummary", () => {
      expect(() => BenchmarkMetricsCallbackSchema.parse({ rawMetrics: {} })).toThrow();
    });
  });
});
