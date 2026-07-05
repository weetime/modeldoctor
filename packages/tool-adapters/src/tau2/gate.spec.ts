import { describe, expect, it } from "vitest";
import { computeGate } from "./gate.js";

const base = {
  kind: "agent-tau2", userSimModel: "x", numTrials: 3,
  overall: { pass1: 0.4, passK: 0.3, tasks: 60 },
  perDomain: { airline: { pass1: 0.25, passK: 0.2, tasks: 20 }, retail: { pass1: 0.5, passK: 0.4, tasks: 20 } },
  attribution: {}, highlights: { successSimId: null, successDomain: null, failureSimId: null, failureDomain: null },
} as const;

describe("computeGate", () => {
  it("off → null result", () => {
    expect(computeGate(base as any, { mode: "off" }, null).result).toBeNull();
  });
  it("perDomainFloor FAILS when a domain is below its floor", () => {
    const g = computeGate(base as any, { mode: "perDomainFloor", perDomainFloor: { airline: 0.3 } }, null);
    expect(g.result).toBe("FAILED");
    expect(g.detail).toContain("airline");
  });
  it("perDomainFloor PASSES when all domains meet floor", () => {
    const g = computeGate(base as any, { mode: "perDomainFloor", perDomainFloor: { airline: 0.2, retail: 0.4 } }, null);
    expect(g.result).toBe("PASSED");
  });
  it("baselineRegression FAILED when drop exceeds pp", () => {
    const g = computeGate(base as any, { mode: "baselineRegression", baselineRegressionPp: 5 }, 0.5);
    expect(g.result).toBe("FAILED"); // 0.40 vs 0.50 = -10pp > 5
  });
  it("baselineRegression WARNING within half the threshold", () => {
    const g = computeGate(base as any, { mode: "baselineRegression", baselineRegressionPp: 30 }, 0.5);
    expect(g.result).toBe("WARNING"); // -10pp, within [15,30) → warn
  });
  it("baselineRegression PASSED when no meaningful drop", () => {
    const g = computeGate(base as any, { mode: "baselineRegression", baselineRegressionPp: 30 }, 0.41);
    expect(g.result).toBe("PASSED");
  });
});
