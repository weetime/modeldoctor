import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LatencyCDF } from "./LatencyCDF";

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));

function readOption(): {
  series: Array<{
    name: string;
    type: string;
    step: string;
    data: Array<[number, number]>;
    lineStyle?: { color?: string };
    itemStyle?: { color?: string };
  }>;
  legend: { data: string[] };
} {
  return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
}

describe("<LatencyCDF>", () => {
  it("renders one step-line series per Run", () => {
    render(
      <LatencyCDF
        ariaLabel="cdf"
        series={[
          { runId: "a", runLabel: "A", samples: [10, 20] },
          { runId: "b", runLabel: "B", samples: [30, 40] },
        ]}
      />,
    );
    const opt = readOption();
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].type).toBe("line");
    expect(opt.series[0].step).toBe("end");
  });

  it("computes CDF from samples: sorted ascending, final y = 1", () => {
    render(<LatencyCDF ariaLabel="cdf" series={[{ runId: "a", samples: [30, 10, 20] }]} />);
    const data = readOption().series[0].data;
    expect(data.map((p) => p[0])).toEqual([10, 20, 30]);
    expect(data[data.length - 1][1]).toBeCloseTo(1, 5);
  });

  it("uses pre-computed cdf when provided, ignoring samples", () => {
    render(
      <LatencyCDF
        ariaLabel="cdf"
        series={[
          {
            runId: "a",
            cdf: [
              [5, 0.5],
              [10, 1],
            ],
          },
        ]}
      />,
    );
    expect(readOption().series[0].data).toEqual([
      [5, 0.5],
      [10, 1],
    ]);
  });

  it("applies colorMap to series colors", () => {
    render(
      <LatencyCDF
        ariaLabel="cdf"
        series={[{ runId: "a", samples: [1, 2] }]}
        colorMap={{ a: "#00ff00" }}
      />,
    );
    const opt = readOption();
    expect(opt.series[0].lineStyle?.color).toBe("#00ff00");
    expect(opt.series[0].itemStyle?.color).toBe("#00ff00");
  });

  it("uses runLabel in legend when provided, runId otherwise", () => {
    render(
      <LatencyCDF
        ariaLabel="cdf"
        series={[
          { runId: "a", runLabel: "First", samples: [1] },
          { runId: "b", samples: [2] },
        ]}
      />,
    );
    expect(readOption().legend.data).toEqual(["First", "b"]);
  });

  it("renders empty state when no samples and no cdf", () => {
    render(<LatencyCDF ariaLabel="cdf" series={[{ runId: "a" }]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<LatencyCDF ariaLabel="cdf" series={[]} loading />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });
});
