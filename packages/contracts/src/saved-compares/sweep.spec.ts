import { describe, expect, it } from "vitest";
import { aggregateSweep, median, type SweepRunInput } from "./sweep.js";

describe("median", () => {
  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });
  it("odd count → middle", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("even count → average of two middles", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("ignores non-finite", () => {
    expect(median([1, Number.NaN, 5])).toBe(3);
  });
});

describe("aggregateSweep", () => {
  const run = (seriesKey: string, x: number, outTps: number, kvAvg?: number): SweepRunInput => ({
    seriesKey,
    seriesLabel: seriesKey === "c-v" ? "vLLM" : "MindIE",
    x,
    metrics: { outTps, ...(kvAvg !== undefined ? { kvAvg } : {}) },
  });

  it("groups by series then x, medians repeats per cell", () => {
    const out = aggregateSweep([
      run("c-v", 8, 100),
      run("c-v", 8, 110),
      run("c-v", 8, 120), // median 110
      run("c-v", 16, 200),
      run("c-m", 8, 90),
    ]);
    expect(out.map((s) => s.seriesKey)).toEqual(["c-v", "c-m"]); // first-seen order
    const v = out[0];
    expect(v.points.map((p) => p.x)).toEqual([8, 16]); // sorted asc
    expect(v.points[0].values.outTps).toBe(110);
    expect(v.points[0].n).toBe(3);
    expect(v.points[1].values.outTps).toBe(200);
    expect(out[1].points[0].values.outTps).toBe(90);
  });

  it("sorts points ascending regardless of input order", () => {
    const out = aggregateSweep([run("c-v", 128, 1), run("c-v", 8, 2), run("c-v", 32, 3)]);
    expect(out[0].points.map((p) => p.x)).toEqual([8, 32, 128]);
  });

  it("medians each metric independently; null when a metric is absent", () => {
    const out = aggregateSweep([run("c-v", 8, 100, 40), run("c-v", 8, 200)]);
    const p = out[0].points[0];
    expect(p.values.outTps).toBe(150); // both present → median
    expect(p.values.kvAvg).toBe(40); // only one had kv → that value
    expect(p.values.ttftP50).toBeNull(); // none had it
  });
});
