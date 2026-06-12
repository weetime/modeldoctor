import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deltaAnnotation, StageBarChart } from "./StageBarChart";

describe("<StageBarChart>", () => {
  it("renders one ECharts series per input series with categorical-x stages", () => {
    render(
      <StageBarChart
        title="QPS"
        data={[
          { stage: "A", qps: 3.0 },
          { stage: "B", qps: 3.5 },
        ]}
        series={[{ key: "qps", label: "QPS", color: "#3498db" }]}
        height={200}
      />,
    );
    expect(screen.getByText("QPS")).toBeInTheDocument();
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ data?: number[]; name?: string }>;
      xAxis?: { type?: string; data?: string[] };
    };
    expect(opt.xAxis?.type).toBe("category");
    expect(opt.xAxis?.data).toEqual(["A", "B"]);
    expect(opt.series?.length).toBe(1);
    expect(opt.series?.[0]?.name).toBe("QPS");
    expect(opt.series?.[0]?.data).toEqual([3.0, 3.5]);
  });

  it("renders multiple series side-by-side per stage", () => {
    render(
      <StageBarChart
        title="TTFT percentiles"
        data={[
          { stage: "A", p50: 100, p95: 250 },
          { stage: "B", p50: 120, p95: 300 },
        ]}
        series={[
          { key: "p50", label: "p50", color: "#3498db" },
          { key: "p95", label: "p95", color: "#e74c3c" },
        ]}
        height={200}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ data?: number[]; name?: string }>;
    };
    expect(opt.series?.length).toBe(2);
    expect(opt.series?.[0]?.data).toEqual([100, 120]);
    expect(opt.series?.[1]?.data).toEqual([250, 300]);
  });

  it("applies per-bar identity colors on single-series charts", () => {
    render(
      <StageBarChart
        title="QPS"
        data={[
          { stage: "A", qps: 3.0 },
          { stage: "B", qps: 3.5 },
        ]}
        series={[{ key: "qps", label: "QPS", color: "#3498db" }]}
        barColors={["#111111", "#222222"]}
        height={200}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ data?: Array<{ value: number; itemStyle?: { color?: string } }> }>;
    };
    expect(opt.series?.[0]?.data?.[0]).toEqual({ value: 3.0, itemStyle: { color: "#111111" } });
    expect(opt.series?.[0]?.data?.[1]).toEqual({ value: 3.5, itemStyle: { color: "#222222" } });
  });

  it("ignores barColors on multi-series charts", () => {
    render(
      <StageBarChart
        title="TTFT"
        data={[{ stage: "p50", a: 100, b: 120 }]}
        series={[
          { key: "a", label: "A", color: "#111111" },
          { key: "b", label: "B", color: "#222222" },
        ]}
        barColors={["#333333"]}
        height={200}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ data?: number[] }>;
    };
    expect(opt.series?.[0]?.data).toEqual([100]);
    expect(opt.series?.[1]?.data).toEqual([120]);
  });

  it("renders run-pivoted layout with baselineSeriesKey without markLine", () => {
    render(
      <StageBarChart
        title="TTFT percentiles"
        data={[
          { stage: "p50", a: 100, b: 120 },
          { stage: "p99", a: 500, b: 450 },
        ]}
        series={[
          { key: "a", label: "Run A", color: "#111111", higherIsBetter: false },
          { key: "b", label: "Run B", color: "#222222", higherIsBetter: false },
        ]}
        baselineSeriesKey="a"
        height={200}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ name?: string; data?: number[]; markLine?: unknown }>;
      xAxis?: { data?: string[] };
    };
    expect(opt.xAxis?.data).toEqual(["p50", "p99"]);
    expect(opt.series?.map((s) => s.name)).toEqual(["Run A", "Run B"]);
    expect(opt.series?.every((s) => s.markLine === undefined)).toBe(true);
  });

  it("renders empty placeholder when data is empty", () => {
    render(
      <StageBarChart
        title="QPS"
        data={[]}
        series={[{ key: "qps", label: "QPS", color: "#3498db" }]}
        height={200}
      />,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});

describe("deltaAnnotation", () => {
  it("returns empty string without a comparable baseline", () => {
    expect(deltaAnnotation(100, null, false)).toBe("");
    expect(deltaAnnotation(100, 0, false)).toBe("");
  });

  it("marks ~equal values with ≈", () => {
    expect(deltaAnnotation(100.2, 100, false)).toBe("\n{base|≈}");
  });

  it("colors by direction-aware better/worse", () => {
    // latency (lower is better): +50% is worse
    expect(deltaAnnotation(150, 100, false)).toBe("\n{down|↑50%}");
    // throughput (higher is better): +50% is better
    expect(deltaAnnotation(150, 100, true)).toBe("\n{up|↑50%}");
    expect(deltaAnnotation(50, 100, false)).toBe("\n{up|↓50%}");
  });
});
