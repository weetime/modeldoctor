// apps/web/src/features/insights/matrix-filter.test.ts
import type { InsightsMatrixResponse } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { filterMatrixData } from "./matrix-filter";

const BASE_FIXTURE: InsightsMatrixResponse = {
  aggregate: "scenario",
  range: "30d",
  generatedAt: "2026-07-01T00:00:00Z",
  dimensions: [
    { key: "inference", label: "Inference", count: 2 },
    { key: "tooluse", label: "Tool use", count: 1 },
  ],
  endpoints: [
    {
      id: "c1",
      name: "n1",
      model: "m1",
      baseUrl: "http://x1",
      category: "chat",
      serverKind: "vllm",
    },
    {
      id: "c2",
      name: "n2",
      model: "other",
      baseUrl: "http://x2",
      category: "audio",
      serverKind: "sglang",
    },
  ],
  cells: [
    {
      endpointId: "c1",
      dimKey: "inference",
      runs: 3,
      score: 80,
      band: "usable",
      nativeMetric: { kind: "e2e.p95", value: 1200, unit: "ms" },
    },
    {
      endpointId: "c2",
      dimKey: "inference",
      runs: 2,
      score: 60,
      band: "usable",
      nativeMetric: null,
    },
    {
      endpointId: "c2",
      dimKey: "tooluse",
      runs: 1,
      score: 90,
      band: "recommended",
      nativeMetric: null,
    },
  ],
};

describe("filterMatrixData", () => {
  it("keeps everything and preserves aggregate/range/generatedAt when there is no filter", () => {
    const result = filterMatrixData(BASE_FIXTURE, { q: "", category: null });

    expect(result.endpoints).toHaveLength(2);
    expect(result.cells).toHaveLength(3);
    expect(result.aggregate).toBe(BASE_FIXTURE.aggregate);
    expect(result.range).toBe(BASE_FIXTURE.range);
    expect(result.generatedAt).toBe(BASE_FIXTURE.generatedAt);
  });

  it("filters endpoints by q and drops cells/dims that no longer have a surviving endpoint", () => {
    // "m1" matches only c1 (model "m1"); c2's model is "other" and name is "n2".
    const result = filterMatrixData(BASE_FIXTURE, { q: "m1", category: null });

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].id).toBe("c1");

    // Every surviving cell must reference the surviving endpoint id only.
    expect(result.cells.every((c) => c.endpointId === "c1")).toBe(true);
    // c1 only has an "inference" cell, so the "tooluse" cell (which belonged
    // only to c2) must be gone entirely.
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].dimKey).toBe("inference");

    // "tooluse" dim had zero surviving cells -> dropped. "inference" dim had
    // 2 distinct endpoints originally, now only 1 survives -> count drops to 1.
    expect(result.dimensions.map((d) => d.key)).toEqual(["inference"]);
    expect(result.dimensions[0].count).toBe(1);
  });

  it("filters endpoints by category and recomputes dimension counts", () => {
    // Only c2 is "audio" category.
    const result = filterMatrixData(BASE_FIXTURE, { q: "", category: "audio" });

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].id).toBe("c2");
    expect(result.cells.every((c) => c.endpointId === "c2")).toBe(true);
    expect(result.cells).toHaveLength(2);

    // Both dims still have a surviving cell (c2 has one inference cell and
    // one tooluse cell), but "inference"'s count drops from 2 to 1 since c1
    // no longer survives.
    const byKey = Object.fromEntries(result.dimensions.map((d) => [d.key, d.count]));
    expect(byKey.inference).toBe(1);
    expect(byKey.tooluse).toBe(1);
  });

  it("combines q and category filters", () => {
    const result = filterMatrixData(BASE_FIXTURE, { q: "n2", category: "audio" });

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].id).toBe("c2");
  });

  it("returns no endpoints, cells, or dimensions when nothing matches", () => {
    const result = filterMatrixData(BASE_FIXTURE, { q: "nonexistent-needle", category: null });

    expect(result.endpoints).toHaveLength(0);
    expect(result.cells).toHaveLength(0);
    expect(result.dimensions).toHaveLength(0);
  });
});
