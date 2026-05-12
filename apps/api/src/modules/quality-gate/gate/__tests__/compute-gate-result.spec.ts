import { describe, expect, it } from "vitest";
import { computeGateResult } from "../compute-gate-result.js";

const baseMetrics = {
  passRateA: 0.92,
  passRateB: 0.88,
  judgeAvgA: 4.2,
  judgeAvgB: 3.9,
  regressionCount: 7,
  improvementCount: 3,
  bothPassCount: 35,
  bothFailCount: 5,
  totalErrors: 0,
  judgeCallCount: 50,
};

describe("computeGateResult", () => {
  it("PASSED when all thresholds satisfied (using B side)", () => {
    expect(
      computeGateResult({ ...baseMetrics, passRateB: 0.95, regressionCount: 0, judgeAvgB: 4.5 }, { passRateMin: 0.9, regressionMax: 3, judgeScoreMin: 4 }),
    ).toMatchObject({ result: "PASSED" });
  });
  it("WARNING when within buffer band", () => {
    expect(computeGateResult({ ...baseMetrics, passRateB: 0.89 }, { passRateMin: 0.9 })).toMatchObject({ result: "WARNING" });
  });
  it("FAILED when outside buffer band", () => {
    expect(computeGateResult({ ...baseMetrics, passRateB: 0.84 }, { passRateMin: 0.9 })).toMatchObject({ result: "FAILED" });
  });
  it("ignores B-only thresholds in single-endpoint mode", () => {
    const single = { ...baseMetrics, passRateB: undefined, judgeAvgB: undefined, regressionCount: undefined };
    expect(computeGateResult(single, { passRateMin: 0.9 })).toMatchObject({ result: "PASSED" });
  });
  it("regression buffer band: x1 → warning, x1.5+ → failed", () => {
    expect(computeGateResult({ ...baseMetrics, regressionCount: 4 }, { regressionMax: 3 })).toMatchObject({ result: "WARNING" });
    expect(computeGateResult({ ...baseMetrics, regressionCount: 6 }, { regressionMax: 3 })).toMatchObject({ result: "FAILED" });
  });
  it("judgeScore buffer: 0.5 below → warning, 0.5+ below → failed", () => {
    expect(computeGateResult({ ...baseMetrics, judgeAvgB: 3.8 }, { judgeScoreMin: 4 })).toMatchObject({ result: "WARNING" });
    expect(computeGateResult({ ...baseMetrics, judgeAvgB: 3.4 }, { judgeScoreMin: 4 })).toMatchObject({ result: "FAILED" });
  });
});
