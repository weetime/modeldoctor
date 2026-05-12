import { describe, expect, it } from "vitest";
import { aggregateMetrics, computeDelta } from "../sample-aggregation.js";

const r = (passA: boolean, passB?: boolean) => ({
  resultA: { call: {}, judge: { passed: passA } },
  resultB: passB == null ? null : { call: {}, judge: { passed: passB } },
});

describe("computeDelta", () => {
  it.each([
    [true, true, "BOTH_PASS"],
    [false, false, "BOTH_FAIL"],
    [true, false, "REGRESSION"],
    [false, true, "IMPROVEMENT"],
  ])("A=%s B=%s → %s", (a, b, expected) => {
    expect(computeDelta({ passed: a }, { passed: b })).toBe(expected);
  });
  it("null B → NA", () => {
    expect(computeDelta({ passed: true }, null)).toBe("NA");
  });
});

describe("aggregateMetrics", () => {
  it("computes dual-endpoint counts", () => {
    const rows = [r(true, true), r(true, false), r(false, true), r(false, false), r(true, true)];
    const m = aggregateMetrics(rows, 10);
    expect(m).toMatchObject({
      passRateA: 0.6,
      passRateB: 0.6,
      regressionCount: 1,
      improvementCount: 1,
      bothPassCount: 2,
      bothFailCount: 1,
      judgeCallCount: 10,
    });
  });
  it("single endpoint mode hides B fields", () => {
    const rows = [r(true), r(false)];
    const m = aggregateMetrics(rows, 2);
    expect(m.passRateB).toBeUndefined();
    expect(m.regressionCount).toBeUndefined();
  });
});
