import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBarChartsSection } from "./StageBarChartsSection";

const guidellmMetrics = (qps: number, errPct: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p50: 100, p90: 200, p99: 500 },
    e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
    requestsPerSecond: { mean: qps },
    requests: { total: 1000, error: Math.round((errPct / 100) * 1000) },
  },
});

describe("StageBarChartsSection", () => {
  it("renders 4 chart panels for guidellm runs", () => {
    render(
      <StageBarChartsSection
        runs={[
          {
            id: "a",
            stageLabel: "A",
            tool: "guidellm",
            summaryMetrics: guidellmMetrics(3, 0),
          },
          {
            id: "b",
            stageLabel: "B",
            tool: "guidellm",
            summaryMetrics: guidellmMetrics(3.5, 0.5),
          },
        ]}
      />,
    );
    expect(screen.getByText(/QPS/)).toBeInTheDocument();
    expect(screen.getByText(/TTFT/i)).toBeInTheDocument();
    expect(screen.getByText(/e2e/i)).toBeInTheDocument();

    type Opt = {
      xAxis?: { data?: string[] };
      series?: Array<{ name?: string; data?: unknown[] }>;
    };
    const opts = screen
      .getAllByTestId("echart")
      .map((el) => JSON.parse(el.dataset.option ?? "{}") as Opt);
    expect(opts).toHaveLength(4);

    // QPS / error panels: x = run, bars carry per-run identity colors.
    const qps = opts[0];
    expect(qps.xAxis?.data).toEqual(["A", "B"]);
    const qpsBars = qps.series?.[0]?.data as Array<{ itemStyle?: { color?: string } }>;
    expect(qpsBars[0]?.itemStyle?.color).toBeTruthy();
    expect(qpsBars[0]?.itemStyle?.color).not.toBe(qpsBars[1]?.itemStyle?.color);

    // Percentile panels: pivoted — x = percentile, one series per run.
    const ttft = opts[2];
    expect(ttft.xAxis?.data).toEqual(["p50", "p90", "p99"]);
    expect(ttft.series?.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("matches run colors across QPS and percentile panels", () => {
    render(
      <StageBarChartsSection
        runs={[
          { id: "a", stageLabel: "A", tool: "guidellm", summaryMetrics: guidellmMetrics(3, 0) },
          { id: "b", stageLabel: "B", tool: "guidellm", summaryMetrics: guidellmMetrics(4, 1) },
        ]}
      />,
    );
    type Opt = {
      series?: Array<{
        name?: string;
        itemStyle?: { color?: string };
        data?: Array<{ itemStyle?: { color?: string } }>;
      }>;
    };
    const opts = screen
      .getAllByTestId("echart")
      .map((el) => JSON.parse(el.dataset.option ?? "{}") as Opt);
    const qpsBarColorA = opts[0].series?.[0]?.data?.[0]?.itemStyle?.color;
    const ttftSeriesA = opts[2].series?.find((s) => s.name === "A");
    expect(qpsBarColorA).toBeTruthy();
    expect(ttftSeriesA?.itemStyle?.color).toBe(qpsBarColorA);
  });
});
