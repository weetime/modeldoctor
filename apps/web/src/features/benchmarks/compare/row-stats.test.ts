import { describe, expect, it } from "vitest";
import { isOutlier, OUTLIER_REL, OUTLIER_Z, rowStats } from "./row-stats";

describe("rowStats", () => {
  it("returns null below the minimum sample count", () => {
    expect(rowStats([])).toBeNull();
    expect(rowStats([1, 2])).toBeNull();
    expect(rowStats([1, null])).toBeNull();
  });

  it("ignores null / non-finite values", () => {
    const s = rowStats([10, null, 20, 30]);
    expect(s).not.toBeNull();
    expect(s?.n).toBe(3);
    expect(s?.mean).toBe(20);
  });

  it("computes mean + population std", () => {
    const s = rowStats([2, 4, 6]);
    expect(s?.mean).toBe(4);
    // population variance = ((2-4)^2 + 0 + (6-4)^2)/3 = 8/3
    expect(s?.std).toBeCloseTo(Math.sqrt(8 / 3), 6);
  });
});

describe("isOutlier", () => {
  it("flags a value that is far in BOTH spread and magnitude", () => {
    // TTFT p99 row from the screenshot: one huge value, rest clustered.
    const values = [4571, 1973, 442, 413, 1448, 317, 318, 463];
    const s = rowStats(values);
    if (!s) throw new Error("expected stats");
    expect(isOutlier(4571, s)).toBe(true); // ~2.4σ and +269%
    expect(isOutlier(442, s)).toBe(false);
  });

  it("does NOT flag a tight cluster even when z-score is high", () => {
    // ITL mean row: +15% is ~2.5σ but only 15% off — below the relative floor.
    const values = [29.9, 27.1, 24.9, 25.1, 25.3, 25.0, 24.8, 24.9];
    const s = rowStats(values);
    if (!s) throw new Error("expected stats");
    expect(isOutlier(29.9, s)).toBe(false);
  });

  it("never flags when std is 0 (all equal)", () => {
    const s = rowStats([5, 5, 5]);
    if (!s) throw new Error("expected stats");
    expect(isOutlier(5, s)).toBe(false);
  });

  it("requires both gates: high relative dev but low z does not flag", () => {
    // Two values far apart → the far one is +50% but only ~1σ (n=3 spread is wide).
    const s = rowStats([100, 150, 200]);
    if (!s) throw new Error("expected stats");
    // 200 is +33% over mean 150; z = 50/40.8 ≈ 1.22 < OUTLIER_Z → not an outlier.
    expect(OUTLIER_Z).toBe(2);
    expect(OUTLIER_REL).toBe(0.25);
    expect(isOutlier(200, s)).toBe(false);
  });
});
