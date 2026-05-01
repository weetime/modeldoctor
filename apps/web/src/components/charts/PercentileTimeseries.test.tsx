import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PercentileTimeseries } from "./PercentileTimeseries";

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));

function readOption(): {
  series: Array<{
    name: string;
    type: string;
    data: unknown[];
    lineStyle?: { color?: string; opacity?: number };
    itemStyle?: { color?: string; opacity?: number };
  }>;
  legend: { data: string[] };
} {
  return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
}

describe("<PercentileTimeseries>", () => {
  it("renders one line series per (run × percentile)", () => {
    render(
      <PercentileTimeseries
        ariaLabel="pt"
        series={[
          {
            runId: "a",
            percentiles: {
              p50: [[0, 1]],
              p95: [[0, 2]],
            },
          },
        ]}
      />,
    );
    const opt = readOption();
    expect(opt.series).toHaveLength(2);
    expect(opt.series.every((s) => s.type === "line")).toBe(true);
  });

  it("uses bare percentile names in legend when single-Run", () => {
    render(
      <PercentileTimeseries
        ariaLabel="pt"
        series={[{ runId: "a", percentiles: { p50: [[0, 1]], p95: [[0, 2]] } }]}
      />,
    );
    expect(readOption().legend.data).toEqual(["p50", "p95"]);
  });

  it("uses 'runLabel · pXX' names in legend when multi-Run", () => {
    render(
      <PercentileTimeseries
        ariaLabel="pt"
        series={[
          { runId: "a", runLabel: "Run A", percentiles: { p50: [[0, 1]] } },
          { runId: "b", runLabel: "Run B", percentiles: { p50: [[0, 2]] } },
        ]}
      />,
    );
    expect(readOption().legend.data).toEqual(["Run A · p50", "Run B · p50"]);
  });

  it("applies colorMap[runId] as line color, varies opacity per percentile", () => {
    render(
      <PercentileTimeseries
        ariaLabel="pt"
        series={[
          {
            runId: "a",
            percentiles: { p50: [[0, 1]], p90: [[0, 1]], p95: [[0, 1]], p99: [[0, 1]] },
          },
        ]}
        colorMap={{ a: "#ff0000" }}
      />,
    );
    const opt = readOption();
    expect(opt.series.map((s) => s.lineStyle?.color)).toEqual([
      "#ff0000",
      "#ff0000",
      "#ff0000",
      "#ff0000",
    ]);
    expect(opt.series.map((s) => s.lineStyle?.opacity)).toEqual([1, 0.8, 0.6, 0.45]);
  });

  it("renders empty state when all percentiles are absent", () => {
    render(<PercentileTimeseries ariaLabel="pt" series={[{ runId: "a", percentiles: {} }]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<PercentileTimeseries ariaLabel="pt" series={[]} loading />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("propagates ariaLabel", () => {
    render(<PercentileTimeseries ariaLabel="my-pt" series={[]} />);
    expect(screen.getByLabelText("my-pt")).toBeInTheDocument();
  });
});
