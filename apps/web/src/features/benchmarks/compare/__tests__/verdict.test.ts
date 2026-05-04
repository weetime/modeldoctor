import { describe, expect, it } from "vitest";
import {
  VERDICT_THRESHOLDS,
  verdictForErrorRate,
  verdictForLatency,
  verdictForThroughput,
} from "../verdict";

describe("verdictForLatency", () => {
  it("regressed when current is +10% or more", () => {
    expect(verdictForLatency(100, 110)).toBe("regressed");
    expect(verdictForLatency(100, 200)).toBe("regressed");
  });

  it("improved when current is -10% or more", () => {
    expect(verdictForLatency(100, 90)).toBe("improved");
    expect(verdictForLatency(100, 50)).toBe("improved");
  });

  it("unchanged when delta is inside the threshold band", () => {
    expect(verdictForLatency(100, 105)).toBe("unchanged");
    expect(verdictForLatency(100, 95)).toBe("unchanged");
    expect(verdictForLatency(100, 100)).toBe("unchanged");
  });

  it("unchanged when baseline is 0 (avoid divide by zero)", () => {
    expect(verdictForLatency(0, 0)).toBe("unchanged");
    expect(verdictForLatency(0, 50)).toBe("unchanged");
  });
});

describe("verdictForErrorRate", () => {
  it("regressed when current is +0.5pp or more", () => {
    expect(verdictForErrorRate(0, 0.005)).toBe("regressed");
    expect(verdictForErrorRate(0.01, 0.02)).toBe("regressed");
  });

  it("improved when current is -0.5pp or more", () => {
    expect(verdictForErrorRate(0.02, 0.01)).toBe("improved");
    expect(verdictForErrorRate(0.005, 0)).toBe("improved");
  });

  it("unchanged when delta is inside ±0.5pp band", () => {
    expect(verdictForErrorRate(0.01, 0.011)).toBe("unchanged");
    expect(verdictForErrorRate(0.01, 0.009)).toBe("unchanged");
    expect(verdictForErrorRate(0, 0)).toBe("unchanged");
  });
});

describe("verdictForThroughput", () => {
  it("regressed when current drops by 5% or more", () => {
    expect(verdictForThroughput(100, 95)).toBe("regressed");
    expect(verdictForThroughput(100, 50)).toBe("regressed");
  });

  it("improved when current rises by 5% or more", () => {
    expect(verdictForThroughput(100, 105)).toBe("improved");
    expect(verdictForThroughput(100, 200)).toBe("improved");
  });

  it("unchanged when delta is inside ±5% band", () => {
    expect(verdictForThroughput(100, 102)).toBe("unchanged");
    expect(verdictForThroughput(100, 98)).toBe("unchanged");
  });

  it("unchanged when baseline is 0", () => {
    expect(verdictForThroughput(0, 50)).toBe("unchanged");
  });
});

describe("VERDICT_THRESHOLDS exports the three constants", () => {
  it("matches spec values", () => {
    expect(VERDICT_THRESHOLDS.latencyPct).toBe(0.1);
    expect(VERDICT_THRESHOLDS.errorRatePp).toBe(0.005);
    expect(VERDICT_THRESHOLDS.throughputPct).toBe(0.05);
  });
});
