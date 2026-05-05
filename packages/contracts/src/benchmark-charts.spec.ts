import { describe, expect, it } from "vitest";
import { benchmarkChartsResponseSchema } from "./benchmark.js";

describe("benchmarkChartsResponseSchema", () => {
  it("accepts both fields populated", () => {
    const ok = benchmarkChartsResponseSchema.safeParse({
      latencyCdf: { samples: [10, 20, 30] },
      ttftHistogram: {
        buckets: [
          { lower: 0, upper: 10, count: 2 },
          { lower: 10, upper: 20, count: 5 },
        ],
      },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts both fields null (degraded shape)", () => {
    const ok = benchmarkChartsResponseSchema.safeParse({
      latencyCdf: null,
      ttftHistogram: null,
    });
    expect(ok.success).toBe(true);
  });

  it("accepts ttftHistogram null while latencyCdf populated (vegeta shape)", () => {
    const ok = benchmarkChartsResponseSchema.safeParse({
      latencyCdf: { samples: [1, 2, 3] },
      ttftHistogram: null,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects negative bucket counts", () => {
    const bad = benchmarkChartsResponseSchema.safeParse({
      latencyCdf: null,
      ttftHistogram: { buckets: [{ lower: 0, upper: 1, count: -1 }] },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects samples that are not numbers", () => {
    const bad = benchmarkChartsResponseSchema.safeParse({
      latencyCdf: { samples: ["10" as unknown as number] },
      ttftHistogram: null,
    });
    expect(bad.success).toBe(false);
  });
});
