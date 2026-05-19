import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBarChart } from "./StageBarChart";

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
