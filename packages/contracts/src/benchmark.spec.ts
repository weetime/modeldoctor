import { describe, expect, it } from "vitest";
import { benchmarkSchema, listBenchmarksQuerySchema } from "./benchmark.js";

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
