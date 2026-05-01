import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TTFTHistogram } from "./TTFTHistogram";

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));

function readOption(): {
  xAxis: { data: string[] };
  series: Array<{
    name: string;
    type: string;
    data: number[];
    itemStyle?: { color?: string };
  }>;
  legend: { data: string[] };
} {
  return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
}

describe("<TTFTHistogram>", () => {
  it("renders one bar series per Run", () => {
    render(
      <TTFTHistogram
        ariaLabel="hist"
        series={[
          {
            runId: "a",
            runLabel: "A",
            buckets: [{ lower: 0, upper: 100, count: 5 }],
          },
          {
            runId: "b",
            runLabel: "B",
            buckets: [{ lower: 0, upper: 100, count: 7 }],
          },
        ]}
      />,
    );
    const opt = readOption();
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].type).toBe("bar");
  });

  it("aligns bucket boundaries across Runs and zero-fills missing bins", () => {
    render(
      <TTFTHistogram
        ariaLabel="hist"
        series={[
          {
            runId: "a",
            buckets: [
              { lower: 0, upper: 100, count: 5 },
              { lower: 100, upper: 200, count: 3 },
            ],
          },
          {
            runId: "b",
            buckets: [
              { lower: 100, upper: 200, count: 8 },
              { lower: 200, upper: 300, count: 2 },
            ],
          },
        ]}
      />,
    );
    const opt = readOption();
    expect(opt.xAxis.data).toEqual(["[0, 100)", "[100, 200)", "[200, 300)"]);
    expect(opt.series[0].data).toEqual([5, 3, 0]);
    expect(opt.series[1].data).toEqual([0, 8, 2]);
  });

  it("applies colorMap to series itemStyle.color", () => {
    render(
      <TTFTHistogram
        ariaLabel="hist"
        series={[{ runId: "a", buckets: [{ lower: 0, upper: 1, count: 1 }] }]}
        colorMap={{ a: "#0000ff" }}
      />,
    );
    expect(readOption().series[0].itemStyle?.color).toBe("#0000ff");
  });

  it("uses runLabel in legend when provided, runId otherwise", () => {
    render(
      <TTFTHistogram
        ariaLabel="hist"
        series={[
          { runId: "a", runLabel: "First", buckets: [{ lower: 0, upper: 1, count: 1 }] },
          { runId: "b", buckets: [{ lower: 0, upper: 1, count: 1 }] },
        ]}
      />,
    );
    expect(readOption().legend.data).toEqual(["First", "b"]);
  });

  it("renders empty state when all buckets are empty", () => {
    render(<TTFTHistogram ariaLabel="hist" series={[{ runId: "a", buckets: [] }]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<TTFTHistogram ariaLabel="hist" series={[]} loading />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });
});
