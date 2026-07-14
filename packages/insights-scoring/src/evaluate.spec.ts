import type { Finding } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { compositeScore, evaluateSeverity, scenarioScore } from "./evaluate.js";

const f = (severity: Finding["severity"], weight: number): Finding => ({
  checkId: "x",
  scenario: "inference",
  axis: "responsiveness",
  severity,
  value: 1,
  threshold: { warn: 0, crit: 0 },
  weight,
  recommendation: "",
  contributingRunIds: [],
});

describe("evaluateSeverity", () => {
  it("lower_is_better crosses warn/crit", () => {
    expect(evaluateSeverity(5, { warn: 10, crit: 20 }, "lower_is_better")).toBe("good");
    expect(evaluateSeverity(15, { warn: 10, crit: 20 }, "lower_is_better")).toBe("warn");
    expect(evaluateSeverity(25, { warn: 10, crit: 20 }, "lower_is_better")).toBe("crit");
    expect(evaluateSeverity(null, { warn: 10, crit: 20 }, "lower_is_better")).toBe("no_data");
  });
});
describe("scenarioScore", () => {
  it("weights good=1 warn=.5 crit=0 → 0-100", () => {
    expect(scenarioScore([f("good", 1), f("crit", 1)])).toBe(50);
    expect(scenarioScore([f("no_data", 1)])).toBeNull();
  });
});
describe("compositeScore", () => {
  it("averages present sub-scores", () => {
    expect(compositeScore({ inference: 80, capacity: 60, gateway: null } as never)).toBe(70);
  });
});
