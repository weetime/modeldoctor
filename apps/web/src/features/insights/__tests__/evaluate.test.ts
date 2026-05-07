import type { Finding, RadarAxisId } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { axisValue, compositeScore, evaluateSeverity, scenarioScore } from "../evaluate";

describe("evaluateSeverity", () => {
  it("returns no_data when value is null", () => {
    expect(evaluateSeverity(null, { warn: 100, crit: 200 }, "lower_is_better")).toBe("no_data");
  });

  it("lower_is_better: value < warn → good", () => {
    expect(evaluateSeverity(50, { warn: 100, crit: 200 }, "lower_is_better")).toBe("good");
  });

  it("lower_is_better: warn ≤ value < crit → warn", () => {
    expect(evaluateSeverity(150, { warn: 100, crit: 200 }, "lower_is_better")).toBe("warn");
    expect(evaluateSeverity(100, { warn: 100, crit: 200 }, "lower_is_better")).toBe("warn");
  });

  it("lower_is_better: value ≥ crit → crit", () => {
    expect(evaluateSeverity(200, { warn: 100, crit: 200 }, "lower_is_better")).toBe("crit");
    expect(evaluateSeverity(500, { warn: 100, crit: 200 }, "lower_is_better")).toBe("crit");
  });

  it("higher_is_better: value > warn → good", () => {
    expect(evaluateSeverity(50, { warn: 20, crit: 10 }, "higher_is_better")).toBe("good");
  });

  it("higher_is_better: crit < value ≤ warn → warn", () => {
    expect(evaluateSeverity(15, { warn: 20, crit: 10 }, "higher_is_better")).toBe("warn");
    expect(evaluateSeverity(20, { warn: 20, crit: 10 }, "higher_is_better")).toBe("warn");
  });

  it("higher_is_better: value ≤ crit → crit", () => {
    expect(evaluateSeverity(10, { warn: 20, crit: 10 }, "higher_is_better")).toBe("crit");
    expect(evaluateSeverity(5, { warn: 20, crit: 10 }, "higher_is_better")).toBe("crit");
  });
});

describe("scenarioScore", () => {
  function f(severity: Finding["severity"], weight: number): Finding {
    return {
      checkId: "x",
      scenario: "inference",
      axis: "responsiveness",
      severity,
      value: 0,
      threshold: { warn: 0, crit: 0 },
      weight,
      recommendation: "",
      contributingRunIds: [],
    };
  }

  it("returns null when all findings are no_data", () => {
    expect(scenarioScore([f("no_data", 1), f("no_data", 1)])).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(scenarioScore([])).toBeNull();
  });

  it("100 when all good", () => {
    expect(scenarioScore([f("good", 1), f("good", 1)])).toBe(100);
  });

  it("0 when all crit", () => {
    expect(scenarioScore([f("crit", 1), f("crit", 1)])).toBe(0);
  });

  it("50 when all warn", () => {
    expect(scenarioScore([f("warn", 1), f("warn", 1)])).toBe(50);
  });

  it("weighted average rounded", () => {
    // good*1 + crit*3 = 1.0/4 weight → 25
    expect(scenarioScore([f("good", 1), f("crit", 3)])).toBe(25);
  });

  it("skips no_data findings", () => {
    expect(scenarioScore([f("good", 1), f("no_data", 100)])).toBe(100);
  });
});

describe("compositeScore", () => {
  it("returns null when all scenarios are null", () => {
    expect(compositeScore({ inference: null, capacity: null, gateway: null })).toBeNull();
  });

  it("equal-weight average over present scenarios, rounded", () => {
    expect(compositeScore({ inference: 90, capacity: 70, gateway: 80 })).toBe(80);
  });

  it("skips null scenarios", () => {
    expect(compositeScore({ inference: 90, capacity: null, gateway: 70 })).toBe(80);
  });
});

describe("axisValue", () => {
  function f(axis: RadarAxisId, severity: Finding["severity"], weight: number): Finding {
    return {
      checkId: "x",
      scenario: "inference",
      axis,
      severity,
      value: 0,
      threshold: { warn: 0, crit: 0 },
      weight,
      recommendation: "",
      contributingRunIds: [],
    };
  }

  it("returns null when no findings on axis", () => {
    expect(axisValue("responsiveness", [f("smoothness", "good", 1)])).toBeNull();
  });

  it("returns 1.0 when all axis findings are good", () => {
    expect(
      axisValue("responsiveness", [f("responsiveness", "good", 1), f("responsiveness", "good", 2)]),
    ).toBe(1.0);
  });

  it("returns 0 when all axis findings are crit", () => {
    expect(axisValue("responsiveness", [f("responsiveness", "crit", 1)])).toBe(0);
  });

  it("ignores no_data on axis", () => {
    expect(
      axisValue("responsiveness", [
        f("responsiveness", "good", 1),
        f("responsiveness", "no_data", 100),
      ]),
    ).toBe(1.0);
  });
});
