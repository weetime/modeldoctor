import { describe, expect, it } from "vitest";
import { insightsMatrixResponseSchema } from "./matrix.js";

describe("matrix schema", () => {
  it("parses a minimal valid payload", () => {
    const r = insightsMatrixResponseSchema.parse({
      aggregate: "scenario",
      range: "30d",
      generatedAt: new Date(0).toISOString(),
      dimensions: [{ key: "inference", label: "Inference", count: 3 }],
      endpoints: [
        {
          id: "c1",
          name: "n",
          model: "m",
          baseUrl: "http://x",
          category: "chat",
          serverKind: "vllm",
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
      ],
    });
    expect(r.cells[0].band).toBe("usable");
  });
});
