import { describe, expect, it } from "vitest";
import {
  benchmarkSchema,
  listBenchmarksQuerySchema,
  prefixCacheAnnotationSchema,
  reportMetaSchema,
  reportResultSchema,
  reportStorageKeys,
} from "./benchmark.js";

describe("prefixCacheAnnotationSchema", () => {
  it("parses a prefix-cache annotation", () => {
    const a = prefixCacheAnnotationSchema.parse({
      hitRatePct: 96.6,
      topPodSharePct: 100,
      perPod: [{ pod: "infer-abc-0", queries: 300, hits: 290 }],
      metricTag: "v1",
    });
    expect(a.hitRatePct).toBeCloseTo(96.6);
    expect(a.perPod).toHaveLength(1);
  });

  it("rejects an out-of-range hit rate", () => {
    expect(() =>
      prefixCacheAnnotationSchema.parse({
        hitRatePct: 120,
        topPodSharePct: 100,
        perPod: [],
        metricTag: "v1",
      }),
    ).toThrow();
  });
});

describe("benchmarkSchema (baselineFor wiring)", () => {
  it("accepts baselineFor as null", () => {
    const r = benchmarkSchema.parse({ ...minimalBenchmark(), baselineFor: null });
    expect(r.baselineFor).toBeNull();
  });

  it("accepts baselineFor as a BaselineSummary", () => {
    const r = benchmarkSchema.parse({
      ...minimalBenchmark(),
      baselineFor: { id: "b_1", name: "anchor", createdAt: "2026-05-02T00:00:00.000Z" },
    });
    expect(r.baselineFor?.id).toBe("b_1");
  });

  it("rejects baselineFor with extra fields shaped wrong", () => {
    expect(() =>
      benchmarkSchema.parse({ ...minimalBenchmark(), baselineFor: { id: 123 } as unknown }),
    ).toThrow();
  });
});

describe("listBenchmarksQuerySchema (baseline filters)", () => {
  it("accepts isBaseline boolean", () => {
    const out = listBenchmarksQuerySchema.parse({ isBaseline: true });
    expect(out.isBaseline).toBe(true);
  });

  it("accepts referencesBaseline boolean", () => {
    const out = listBenchmarksQuerySchema.parse({ referencesBaseline: true });
    expect(out.referencesBaseline).toBe(true);
  });

  it("coerces string 'true' / 'false' (URL-encoded) to boolean", () => {
    const out = listBenchmarksQuerySchema.parse({ isBaseline: "true" });
    expect(out.isBaseline).toBe(true);
    const out2 = listBenchmarksQuerySchema.parse({ referencesBaseline: "false" });
    expect(out2.referencesBaseline).toBe(false);
  });
});

describe("reportStorageKeys", () => {
  it("produces stable keys for a runId", () => {
    const k = reportStorageKeys("run-abc");
    expect(k.meta).toBe("run-abc/meta.json");
    expect(k.result).toBe("run-abc/result.json");
    expect(k.stdout).toBe("run-abc/stdout.log");
    expect(k.stderr).toBe("run-abc/stderr.log");
    expect(k.file("report.json")).toBe("run-abc/files/report.json");
  });
});

describe("reportMetaSchema", () => {
  it("accepts a valid meta payload", () => {
    expect(
      reportMetaSchema.parse({
        toolVersion: "guidellm 0.2.1",
        startTimeIso: "2026-05-25T00:00:00.000Z",
      }),
    ).toBeTruthy();
  });
  it("rejects missing startTimeIso", () => {
    expect(() => reportMetaSchema.parse({ toolVersion: "x" })).toThrow();
  });
});

describe("reportResultSchema", () => {
  it("accepts a valid result payload", () => {
    expect(
      reportResultSchema.parse({
        exitCode: 0,
        finishTimeIso: "2026-05-25T01:00:00.000Z",
        files: { "report-json": "files/report.json" },
      }),
    ).toBeTruthy();
  });
});

function minimalBenchmark() {
  return {
    id: "bm1",
    userId: "u1",
    connectionId: null,
    connection: null,
    scenario: "inference" as const,
    tool: "guidellm" as const,
    toolVersion: null,
    driverKind: "local" as const,
    name: "test-benchmark",
    label: null,
    description: null,
    status: "completed" as const,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-05-02T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null as null | { id: string; name: string; createdAt: string },
  };
}
