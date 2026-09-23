import { DEFAULT_REGRESSION_THRESHOLDS } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { detectRegression, nextScheduleAt } from "./regression.js";

function guidellm(tps: number, ttftP95: number, itlP95: number) {
  return {
    tool: "guidellm",
    data: {
      outputTokensPerSecond: { mean: tps },
      ttft: { mean: 0, p50: 0, p90: 0, p95: ttftP95, p99: 0 },
      itl: { mean: 0, p50: 0, p90: 0, p95: itlP95, p99: 0 },
    },
  };
}

describe("detectRegression", () => {
  const t = DEFAULT_REGRESSION_THRESHOLDS;

  it("passes when within thresholds", () => {
    const r = detectRegression({
      baseline: guidellm(1000, 100, 20),
      candidate: guidellm(950, 110, 22),
      thresholds: t,
    });
    expect(r.regressed).toBe(false);
    expect(r.metrics.find((m) => m.metric === "outputTokensPerSec")?.changePct).toBeCloseTo(-5);
  });

  it("flags throughput drop > 10%", () => {
    const r = detectRegression({
      baseline: guidellm(1000, 100, 20),
      candidate: guidellm(880, 100, 20),
      thresholds: t,
    });
    expect(r.regressed).toBe(true);
    expect(r.metrics.find((m) => m.metric === "outputTokensPerSec")?.exceeded).toBe(true);
  });

  it("flags ttft p95 rise > 15%", () => {
    const r = detectRegression({
      baseline: guidellm(1000, 100, 20),
      candidate: guidellm(1000, 116, 20),
      thresholds: t,
    });
    expect(r.regressed).toBe(true);
  });

  it("exactly at threshold is not exceeded", () => {
    const r = detectRegression({
      baseline: guidellm(1000, 100, 20),
      candidate: guidellm(900, 115, 23),
      thresholds: t,
    });
    expect(r.regressed).toBe(false);
  });

  it("missing metric is reported but never exceeded", () => {
    const r = detectRegression({
      baseline: { tool: "guidellm", data: {} },
      candidate: guidellm(1, 1, 1),
      thresholds: t,
    });
    expect(r.regressed).toBe(false);
    expect(r.metrics.every((m) => m.changePct === null)).toBe(true);
  });
});

describe("nextScheduleAt", () => {
  const from = new Date("2026-09-22T00:00:00Z");
  it("off -> null", () => expect(nextScheduleAt("off", from)).toBeNull());
  it("daily -> +24h", () =>
    expect(nextScheduleAt("daily", from)?.toISOString()).toBe("2026-09-23T00:00:00.000Z"));
  it("weekly -> +7d", () =>
    expect(nextScheduleAt("weekly", from)?.toISOString()).toBe("2026-09-29T00:00:00.000Z"));
});
