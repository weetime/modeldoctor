import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QPSTimeseries } from "./QPSTimeseries";

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));

function readOption(): {
  series: Array<{
    name: string;
    type: string;
    data: Array<[number, number]>;
    lineStyle?: { color?: string };
  }>;
  legend: { data: string[] };
  xAxis: { type: string };
} {
  return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
}

describe("<QPSTimeseries>", () => {
  it("renders one line series per Run on a time x-axis", () => {
    render(
      <QPSTimeseries
        ariaLabel="qps"
        series={[
          {
            runId: "a",
            runLabel: "A",
            points: [
              [0, 10],
              [1, 12],
            ],
          },
          {
            runId: "b",
            runLabel: "B",
            points: [
              [0, 20],
              [1, 22],
            ],
          },
        ]}
      />,
    );
    const opt = readOption();
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].type).toBe("line");
    expect(opt.xAxis.type).toBe("time");
  });

  it("uses runLabel in legend when provided, runId otherwise", () => {
    render(
      <QPSTimeseries
        ariaLabel="qps"
        series={[
          { runId: "a", runLabel: "First", points: [[0, 1]] },
          { runId: "b", points: [[0, 1]] },
        ]}
      />,
    );
    expect(readOption().legend.data).toEqual(["First", "b"]);
  });

  it("applies colorMap to series colors", () => {
    render(
      <QPSTimeseries
        ariaLabel="qps"
        series={[{ runId: "a", points: [[0, 1]] }]}
        colorMap={{ a: "#ff0000" }}
      />,
    );
    expect(readOption().series[0].lineStyle?.color).toBe("#ff0000");
  });

  it("renders empty state when series has no points", () => {
    render(<QPSTimeseries ariaLabel="qps" series={[{ runId: "a", points: [] }]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<QPSTimeseries ariaLabel="qps" series={[]} loading />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });
});
