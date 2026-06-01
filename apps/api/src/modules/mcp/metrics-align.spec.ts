import { describe, expect, it } from "vitest";
import { alignBenchmarkMetrics, flattenNumeric } from "./metrics-align.js";

describe("flattenNumeric", () => {
  it("flattens nested numeric leaves to dot paths, ignoring non-numbers", () => {
    expect(flattenNumeric({ e2e: { p95: 1200, label: "x" }, tps: 30 })).toEqual({
      "e2e.p95": 1200,
      tps: 30,
    });
  });
  it("returns {} for null/non-object", () => {
    expect(flattenNumeric(null)).toEqual({});
    expect(flattenNumeric(42)).toEqual({});
  });
  it("skips arrays instead of producing index-keyed paths", () => {
    expect(flattenNumeric({ latencies: [1, 2, 3], p95: 100 })).toEqual({ p95: 100 });
  });
});

describe("alignBenchmarkMetrics", () => {
  it("aligns shared + disjoint metric keys across benchmarks", () => {
    const out = alignBenchmarkMetrics([
      { id: "b1", name: "A", summaryMetrics: { "e2e.p95": 100, tps: 30 } },
      { id: "b2", name: "B", summaryMetrics: { "e2e.p95": 120, errRate: 0.01 } },
    ]);
    expect(out.benchmarks).toEqual([
      { id: "b1", name: "A" },
      { id: "b2", name: "B" },
    ]);
    const p95 = out.rows.find((r) => r.metric === "e2e.p95");
    expect(p95?.values).toEqual([100, 120]);
    const err = out.rows.find((r) => r.metric === "errRate");
    expect(err?.values).toEqual([null, 0.01]);
  });
});
