import { availableSweepFigures, type SweepSeries } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { buildSweepRuns, toSweepLineSeries } from "./sweep-data";

describe("buildSweepRuns", () => {
  it("drops runs without an x value or series identity", () => {
    const out = buildSweepRuns([
      { x: 8, series: { key: "c-v", label: "vLLM" }, summaryMetrics: null },
      { x: undefined, series: { key: "c-v", label: "vLLM" }, summaryMetrics: null },
      { x: 16, series: undefined, summaryMetrics: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ seriesKey: "c-v", x: 8 });
  });
});

const series: SweepSeries[] = [
  {
    seriesKey: "c-v",
    seriesLabel: "vLLM",
    points: [
      { x: 8, values: { outTps: 145, ttftP50: 283, ttftP95: 545, kvAvg: 4 }, n: 1 },
      { x: 16, values: { outTps: 280, ttftP50: 803, ttftP95: 1963, kvAvg: 6 }, n: 1 },
    ],
  },
  {
    seriesKey: "c-m",
    seriesLabel: "MindIE",
    points: [
      { x: 8, values: { outTps: 177, ttftP50: 456, ttftP95: 1166, kvAvg: 5 }, n: 1 },
      { x: 16, values: { outTps: 296, ttftP50: 1150, ttftP95: 6245, kvAvg: 8 }, n: 1 },
    ],
  },
];

describe("availableSweepFigures", () => {
  it("offers a figure when ≥2 series each have ≥2 points for the metric", () => {
    const out = availableSweepFigures(series);
    expect(out.has("sweep-throughput")).toBe(true);
    expect(out.has("sweep-ttft")).toBe(true);
    expect(out.has("sweep-kv-cache")).toBe(true);
    // No itl/e2e/queue data → not offered.
    expect(out.has("sweep-itl")).toBe(false);
    expect(out.has("sweep-queue")).toBe(false);
  });

  it("withholds a figure when only one series has the metric", () => {
    const oneSided: SweepSeries[] = [
      series[0],
      { seriesKey: "c-m", seriesLabel: "MindIE", points: [{ x: 8, values: {}, n: 0 }] },
    ];
    expect(availableSweepFigures(oneSided).has("sweep-throughput")).toBe(false);
  });
});

describe("toSweepLineSeries", () => {
  it("maps the primary metric + optional dashed secondary, with per-series color", () => {
    const out = toSweepLineSeries(
      series,
      "ttftP50",
      (k) => (k === "c-v" ? "#blue" : "#green"),
      "ttftP95",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: "vLLM", color: "#blue" });
    expect(out[0].points).toEqual([
      { x: 8, y: 283 },
      { x: 16, y: 803 },
    ]);
    expect(out[0].secondary).toEqual([
      { x: 8, y: 545 },
      { x: 16, y: 1963 },
    ]);
    // Missing metric → null y (no dropped points; the chart filters nulls).
    const noSecondary = toSweepLineSeries(series, "itlP50", () => "#x");
    expect(noSecondary[0].points).toHaveLength(2);
    expect(noSecondary[0].points.every((p) => p.y === null)).toBe(true);
    expect(noSecondary[0].secondary).toBeUndefined();
  });
});
